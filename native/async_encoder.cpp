#include "async_encoder.h"
#include "frame.h"
#include "color.h"
#include "svc.h"

Napi::FunctionReference VideoEncoderAsync::constructor;

Napi::Object VideoEncoderAsync::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "VideoEncoderAsync", {
        InstanceMethod("configure", &VideoEncoderAsync::Configure),
        InstanceMethod("encode", &VideoEncoderAsync::Encode),
        InstanceMethod("flush", &VideoEncoderAsync::Flush),
        InstanceMethod("reset", &VideoEncoderAsync::Reset),
        InstanceMethod("close", &VideoEncoderAsync::Close),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("VideoEncoderAsync", func);
    return exports;
}

VideoEncoderAsync::VideoEncoderAsync(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<VideoEncoderAsync>(info)
    , codecCtx_(nullptr)
    , codec_(nullptr)
    , swsCtx_(nullptr)
    , hwType_(HWAccel::Type::None)
    , hwDeviceCtx_(nullptr)
    , hwFramesCtx_(nullptr)
    , hwInputFormat_(AV_PIX_FMT_NONE)
    , avcAnnexB_(true)
    , width_(0)
    , height_(0)
    , bitrateMode_("variable")
    , codecName_("")
    , bitrate_(2000000)
    , alpha_(false)
    , scalabilityMode_("")
    , temporalLayers_(1)
    , latencyMode_("quality") {

    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 callbacks").ThrowAsJavaScriptException();
        return;
    }

    // Create thread-safe functions for callbacks
    tsfnOutput_ = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "VideoEncoderAsyncOutput",
        0,  // Unlimited queue
        1   // 1 initial thread
    );

    tsfnError_ = Napi::ThreadSafeFunction::New(
        env,
        info[1].As<Napi::Function>(),
        "VideoEncoderAsyncError",
        0,
        1
    );
}

VideoEncoderAsync::~VideoEncoderAsync() {
    // Signal worker to stop
    running_ = false;
    queueCV_.notify_all();

    // Wait for worker thread to finish
    if (workerThread_.joinable()) {
        workerThread_.join();
    }

    // Clean up FFmpeg resources
    if (swsCtx_) {
        sws_freeContext(swsCtx_);
    }
    if (hwFramesCtx_) {
        av_buffer_unref(&hwFramesCtx_);
    }
    if (hwDeviceCtx_) {
        av_buffer_unref(&hwDeviceCtx_);
    }
    if (codecCtx_) {
        avcodec_free_context(&codecCtx_);
    }

    // Release thread-safe functions
    tsfnOutput_.Release();
    tsfnError_.Release();
    if (tsfnFlush_) {
        tsfnFlush_.Release();
    }
}

void VideoEncoderAsync::configureEncoderOptions(const std::string& encoderName, const std::string& latencyMode) {
    bool isRealtime = (latencyMode == "realtime");

    // Global realtime optimizations
    if (isRealtime) {
        codecCtx_->thread_count = 1;
        codecCtx_->thread_type = 0;
        codecCtx_->delay = 0;
        codecCtx_->max_b_frames = 0;
        codecCtx_->refs = 1;
    }

    if (encoderName == "libx264") {
        if (isRealtime) {
            av_opt_set(codecCtx_->priv_data, "preset", "ultrafast", 0);
            av_opt_set(codecCtx_->priv_data, "tune", "zerolatency", 0);
            av_opt_set(codecCtx_->priv_data, "rc-lookahead", "0", 0);
            av_opt_set(codecCtx_->priv_data, "sync-lookahead", "0", 0);
            av_opt_set(codecCtx_->priv_data, "intra-refresh", "1", 0);
        } else {
            // OPTIMIZATION: Use faster presets for smaller resolutions
            // This maintains quality for large frames while speeding up small ones
            int pixels = width_ * height_;
            const char* preset;
            if (pixels <= 320 * 240) {           // QVGA or smaller
                preset = "ultrafast";
            } else if (pixels <= 640 * 480) {    // VGA or smaller
                preset = "superfast";
            } else if (pixels <= 1280 * 720) {   // 720p or smaller
                preset = "veryfast";
            } else {
                preset = "medium";                // HD and above: quality matters
            }
            av_opt_set(codecCtx_->priv_data, "preset", preset, 0);
        }
    }
    else if (encoderName == "h264_videotoolbox" || encoderName == "hevc_videotoolbox") {
        av_opt_set(codecCtx_->priv_data, "realtime", isRealtime ? "1" : "0", 0);
        av_opt_set(codecCtx_->priv_data, "allow_sw", "1", 0);
    }
    else if (encoderName == "h264_nvenc" || encoderName == "hevc_nvenc") {
        if (isRealtime) {
            av_opt_set(codecCtx_->priv_data, "preset", "p1", 0);
            av_opt_set(codecCtx_->priv_data, "tune", "ll", 0);
            av_opt_set(codecCtx_->priv_data, "zerolatency", "1", 0);
            av_opt_set(codecCtx_->priv_data, "rc-lookahead", "0", 0);
        } else {
            av_opt_set(codecCtx_->priv_data, "preset", "p4", 0);
        }
        av_opt_set(codecCtx_->priv_data, "rc", "cbr", 0);
    }
    else if (encoderName == "h264_qsv" || encoderName == "hevc_qsv") {
        if (isRealtime) {
            av_opt_set(codecCtx_->priv_data, "preset", "veryfast", 0);
            av_opt_set(codecCtx_->priv_data, "low_delay_brc", "1", 0);
            av_opt_set(codecCtx_->priv_data, "look_ahead", "0", 0);
        }
    }
    else if (encoderName == "libvpx" || encoderName == "libvpx-vp9") {
        if (codecCtx_->bit_rate > 0) {
            av_opt_set_int(codecCtx_->priv_data, "crf", 10, 0);
            av_opt_set_int(codecCtx_->priv_data, "b", codecCtx_->bit_rate, 0);
        }
        if (isRealtime) {
            av_opt_set_int(codecCtx_->priv_data, "cpu-used", 8, 0);
            av_opt_set_int(codecCtx_->priv_data, "lag-in-frames", 0, 0);
            av_opt_set(codecCtx_->priv_data, "deadline", "realtime", 0);
        } else {
            av_opt_set_int(codecCtx_->priv_data, "cpu-used", 4, 0);
        }
    }
    else if (encoderName == "libx265") {
        if (isRealtime) {
            av_opt_set(codecCtx_->priv_data, "preset", "ultrafast", 0);
            av_opt_set(codecCtx_->priv_data, "tune", "zerolatency", 0);
        } else {
            // OPTIMIZATION: Use faster presets for smaller resolutions
            int pixels = width_ * height_;
            const char* preset;
            if (pixels <= 640 * 480) {
                preset = "ultrafast";
            } else if (pixels <= 1280 * 720) {
                preset = "veryfast";
            } else {
                preset = "medium";
            }
            av_opt_set(codecCtx_->priv_data, "preset", preset, 0);
        }
    }
    else if (encoderName == "libaom-av1" || encoderName == "libsvtav1") {
        if (isRealtime) {
            av_opt_set_int(codecCtx_->priv_data, "cpu-used", 10, 0);
            av_opt_set_int(codecCtx_->priv_data, "lag-in-frames", 0, 0);
            av_opt_set(codecCtx_->priv_data, "usage", "realtime", 0);
        } else {
            av_opt_set_int(codecCtx_->priv_data, "cpu-used", 6, 0);
        }
    }
}

void VideoEncoderAsync::Configure(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "Config must be an object").ThrowAsJavaScriptException();
        return;
    }

    Napi::Object config = info[0].As<Napi::Object>();
    std::string codecName = config.Get("codec").As<Napi::String>().Utf8Value();

    width_ = config.Get("width").As<Napi::Number>().Int32Value();
    height_ = config.Get("height").As<Napi::Number>().Int32Value();

    // Parse hardware acceleration preference
    HWAccel::Preference hwPref = HWAccel::Preference::NoPreference;
    if (config.Has("hardwareAcceleration")) {
        std::string pref = config.Get("hardwareAcceleration").As<Napi::String>().Utf8Value();
        hwPref = HWAccel::parsePreference(pref);
    }

    // Select encoder
    HWAccel::EncoderInfo encInfo = HWAccel::selectEncoder(codecName, hwPref, width_, height_);

    if (!encInfo.codec) {
        codec_ = avcodec_find_encoder_by_name(codecName.c_str());
        if (!codec_) {
            Napi::Error::New(env, "No suitable encoder found for: " + codecName)
                .ThrowAsJavaScriptException();
            return;
        }
        hwType_ = HWAccel::Type::None;
        hwInputFormat_ = AV_PIX_FMT_YUV420P;
    } else {
        codec_ = encInfo.codec;
        hwType_ = encInfo.hwType;
        hwInputFormat_ = encInfo.inputFormat;
    }

    codecCtx_ = avcodec_alloc_context3(codec_);
    if (!codecCtx_) {
        Napi::Error::New(env, "Failed to allocate codec context").ThrowAsJavaScriptException();
        return;
    }

    codecCtx_->width = width_;
    codecCtx_->height = height_;
    codecCtx_->time_base = { 1, 1000000 };
    codecName_ = codec_->name;

    // Bitrate
    if (config.Has("bitrate")) {
        bitrate_ = config.Get("bitrate").As<Napi::Number>().Int64Value();
    } else {
        bitrate_ = 2000000;
    }

    // Bitrate mode
    if (config.Has("bitrateMode")) {
        bitrateMode_ = config.Get("bitrateMode").As<Napi::String>().Utf8Value();
    } else {
        bitrateMode_ = "variable";
    }

    // Configure rate control
    if (bitrateMode_ == "constant") {
        codecCtx_->bit_rate = bitrate_;
        codecCtx_->rc_min_rate = bitrate_;
        codecCtx_->rc_max_rate = bitrate_;
        codecCtx_->rc_buffer_size = static_cast<int>(bitrate_);

        if (codecName_.find("libx264") != std::string::npos) {
            av_opt_set(codecCtx_->priv_data, "nal-hrd", "cbr", 0);
        } else if (codecName_.find("libvpx") != std::string::npos) {
            av_opt_set_int(codecCtx_->priv_data, "minrate", bitrate_, 0);
            av_opt_set_int(codecCtx_->priv_data, "maxrate", bitrate_, 0);
        }
    } else if (bitrateMode_ == "quantizer") {
        codecCtx_->bit_rate = 0;
        codecCtx_->rc_max_rate = 0;

        if (codecName_.find("libx264") != std::string::npos ||
            codecName_.find("libx265") != std::string::npos) {
            av_opt_set_int(codecCtx_->priv_data, "crf", 23, 0);
        } else if (codecName_.find("libvpx") != std::string::npos) {
            av_opt_set_int(codecCtx_->priv_data, "crf", 30, 0);
            codecCtx_->qmin = 0;
            codecCtx_->qmax = 63;
        } else if (codecName_.find("av1") != std::string::npos) {
            av_opt_set_int(codecCtx_->priv_data, "crf", 30, 0);
        }
    } else {
        codecCtx_->bit_rate = bitrate_;
    }

    // Framerate
    int fps = 30;
    if (config.Has("framerate")) {
        fps = config.Get("framerate").As<Napi::Number>().Int32Value();
    }
    codecCtx_->gop_size = fps;
    codecCtx_->framerate = { fps, 1 };
    codecCtx_->max_b_frames = 0;

    // Alpha
    if (config.Has("alpha") && config.Get("alpha").IsString()) {
        std::string alphaMode = config.Get("alpha").As<Napi::String>().Utf8Value();
        alpha_ = (alphaMode == "keep");
    }

    // Pixel format
    if (hwType_ != HWAccel::Type::None && hwInputFormat_ != AV_PIX_FMT_NONE) {
        codecCtx_->pix_fmt = hwInputFormat_;
    } else if (alpha_ && (codecName_.find("libvpx") != std::string::npos)) {
        codecCtx_->pix_fmt = AV_PIX_FMT_YUVA420P;
    } else {
        codecCtx_->pix_fmt = AV_PIX_FMT_YUV420P;
    }

    // Color space
    if (config.Has("colorSpace") && config.Get("colorSpace").IsObject()) {
        Napi::Object cs = config.Get("colorSpace").As<Napi::Object>();

        if (cs.Has("primaries") && cs.Get("primaries").IsString()) {
            codecCtx_->color_primaries = ColorSpace::parsePrimaries(
                cs.Get("primaries").As<Napi::String>().Utf8Value());
        }
        if (cs.Has("transfer") && cs.Get("transfer").IsString()) {
            codecCtx_->color_trc = ColorSpace::parseTransfer(
                cs.Get("transfer").As<Napi::String>().Utf8Value());
        }
        if (cs.Has("matrix") && cs.Get("matrix").IsString()) {
            codecCtx_->colorspace = ColorSpace::parseMatrix(
                cs.Get("matrix").As<Napi::String>().Utf8Value());
        }
        if (cs.Has("fullRange") && cs.Get("fullRange").IsBoolean()) {
            codecCtx_->color_range = cs.Get("fullRange").As<Napi::Boolean>().Value()
                ? AVCOL_RANGE_JPEG : AVCOL_RANGE_MPEG;
        }
    }

    // Hardware device context
    if (hwType_ != HWAccel::Type::None) {
        hwDeviceCtx_ = HWAccel::createHWDeviceContext(hwType_);
        if (hwDeviceCtx_) {
            codecCtx_->hw_device_ctx = av_buffer_ref(hwDeviceCtx_);
        }

        if (encInfo.requiresHWFrames && hwDeviceCtx_) {
            hwFramesCtx_ = av_hwframe_ctx_alloc(hwDeviceCtx_);
            if (hwFramesCtx_) {
                AVHWFramesContext* framesCtx = (AVHWFramesContext*)hwFramesCtx_->data;
                framesCtx->format = hwInputFormat_;
                framesCtx->sw_format = AV_PIX_FMT_NV12;
                framesCtx->width = width_;
                framesCtx->height = height_;
                framesCtx->initial_pool_size = 20;

                if (av_hwframe_ctx_init(hwFramesCtx_) >= 0) {
                    codecCtx_->hw_frames_ctx = av_buffer_ref(hwFramesCtx_);
                }
            }
        }
    }

    // Profile for H.264
    std::string encoderName = codec_->name;
    if (encoderName == "libx264" && config.Has("profile")) {
        int profile = config.Get("profile").As<Napi::Number>().Int32Value();
        switch (profile) {
            case 66: av_opt_set(codecCtx_->priv_data, "profile", "baseline", 0); break;
            case 77: av_opt_set(codecCtx_->priv_data, "profile", "main", 0); break;
            case 100: av_opt_set(codecCtx_->priv_data, "profile", "high", 0); break;
            default: av_opt_set(codecCtx_->priv_data, "profile", "main", 0); break;
        }
    }

    // AVC format
    if (config.Has("avcFormat")) {
        std::string format = config.Get("avcFormat").As<Napi::String>().Utf8Value();
        avcAnnexB_ = (format == "annexb");
    }

    // Latency mode
    if (config.Has("latencyMode")) {
        latencyMode_ = config.Get("latencyMode").As<Napi::String>().Utf8Value();
    }
    configureEncoderOptions(encoderName, latencyMode_);

    // Scalability mode (SVC)
    if (config.Has("scalabilityMode") && config.Get("scalabilityMode").IsString()) {
        std::string svcMode = config.Get("scalabilityMode").As<Napi::String>().Utf8Value();

        if (!isScalabilityModeSupported(svcMode)) {
            Napi::Error::New(env, "Unsupported scalabilityMode: " + svcMode)
                .ThrowAsJavaScriptException();
            return;
        }

        ScalabilityConfig svcConfig = parseScalabilityMode(svcMode);

        if (svcConfig.temporalLayers > 1) {
            temporalLayers_ = svcConfig.temporalLayers;

            if (encoderName.find("libvpx") != std::string::npos) {
                av_opt_set(codecCtx_->priv_data, "lag-in-frames", "0", 0);
                av_opt_set(codecCtx_->priv_data, "error-resilient", "1", 0);
                av_opt_set_int(codecCtx_->priv_data, "auto-alt-ref", 0, 0);

                char tsParams[256];
                int layers = svcConfig.temporalLayers;

                if (layers == 2) {
                    int br0 = static_cast<int>(bitrate_ * 0.6 / 1000);
                    int br1 = static_cast<int>(bitrate_ / 1000);
                    snprintf(tsParams, sizeof(tsParams),
                        "ts_number_layers=2:ts_target_bitrate=%d,%d:ts_rate_decimator=2,1:ts_periodicity=2:ts_layer_id=0,1",
                        br0, br1);
                } else if (layers == 3) {
                    int br0 = static_cast<int>(bitrate_ * 0.25 / 1000);
                    int br1 = static_cast<int>(bitrate_ * 0.5 / 1000);
                    int br2 = static_cast<int>(bitrate_ / 1000);
                    snprintf(tsParams, sizeof(tsParams),
                        "ts_number_layers=3:ts_target_bitrate=%d,%d,%d:ts_rate_decimator=4,2,1:ts_periodicity=4:ts_layer_id=0,2,1,2",
                        br0, br1, br2);
                }

                av_opt_set(codecCtx_->priv_data, "ts-parameters", tsParams, 0);
            }
            else if (encoderName.find("libaom") != std::string::npos ||
                     encoderName.find("av1") != std::string::npos) {
                av_opt_set(codecCtx_->priv_data, "lag-in-frames", "0", 0);
                av_opt_set(codecCtx_->priv_data, "usage", "realtime", 0);
            }
            else if (encoderName.find("libsvtav1") != std::string::npos) {
                char hierLevels[8];
                snprintf(hierLevels, sizeof(hierLevels), "%d", svcConfig.temporalLayers - 1);
                av_opt_set(codecCtx_->priv_data, "hierarchical-levels", hierLevels, 0);
            }
        }

        scalabilityMode_ = svcMode;
    }

    // Alpha with libvpx
    if (alpha_ && codecName_.find("libvpx") != std::string::npos) {
        av_opt_set_int(codecCtx_->priv_data, "auto-alt-ref", 0, 0);
    }

    // Open codec
    int ret = avcodec_open2(codecCtx_, codec_, nullptr);
    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        avcodec_free_context(&codecCtx_);
        codecCtx_ = nullptr;

        // Try software fallback if HW failed
        if (hwType_ != HWAccel::Type::None && hwPref != HWAccel::Preference::PreferHardware) {
            if (hwDeviceCtx_) {
                av_buffer_unref(&hwDeviceCtx_);
                hwDeviceCtx_ = nullptr;
            }
            if (hwFramesCtx_) {
                av_buffer_unref(&hwFramesCtx_);
                hwFramesCtx_ = nullptr;
            }

            HWAccel::EncoderInfo swInfo = HWAccel::selectEncoder(codecName, HWAccel::Preference::PreferSoftware, width_, height_);
            if (swInfo.codec) {
                codec_ = swInfo.codec;
                hwType_ = HWAccel::Type::None;
                hwInputFormat_ = swInfo.inputFormat;

                codecCtx_ = avcodec_alloc_context3(codec_);
                codecCtx_->width = width_;
                codecCtx_->height = height_;
                codecCtx_->time_base = { 1, 1000000 };
                codecCtx_->bit_rate = bitrate_;
                codecCtx_->gop_size = fps;
                codecCtx_->framerate = { fps, 1 };
                codecCtx_->max_b_frames = 0;
                codecCtx_->pix_fmt = AV_PIX_FMT_YUV420P;

                configureEncoderOptions(codec_->name, latencyMode_);

                ret = avcodec_open2(codecCtx_, codec_, nullptr);
                if (ret < 0) {
                    av_strerror(ret, errBuf, sizeof(errBuf));
                    avcodec_free_context(&codecCtx_);
                    codecCtx_ = nullptr;
                    Napi::Error::New(env, std::string("Failed to open codec: ") + errBuf).ThrowAsJavaScriptException();
                    return;
                }
            } else {
                Napi::Error::New(env, std::string("Failed to open codec: ") + errBuf).ThrowAsJavaScriptException();
                return;
            }
        } else {
            Napi::Error::New(env, std::string("Failed to open codec: ") + errBuf).ThrowAsJavaScriptException();
            return;
        }
    }

    configured_ = true;

    // Start worker thread
    running_ = true;
    workerThread_ = std::thread(&VideoEncoderAsync::WorkerThread, this);
}

void VideoEncoderAsync::WorkerThread() {
    while (running_) {
        EncodeJob job;

        {
            std::unique_lock<std::mutex> lock(queueMutex_);
            queueCV_.wait(lock, [this] {
                return !jobQueue_.empty() || !running_;
            });

            if (!running_ && jobQueue_.empty()) {
                break;
            }

            if (jobQueue_.empty()) {
                continue;
            }

            job = std::move(jobQueue_.front());
            jobQueue_.pop();
        }

        if (job.isFlush) {
            ProcessFlush();
        } else {
            ProcessEncode(job);
        }
    }
}

void VideoEncoderAsync::ProcessEncode(EncodeJob& job) {
    if (!codecCtx_) {
        if (job.frame) {
            av_frame_free(&job.frame);
        }
        return;
    }

    AVFrame* srcFrame = job.frame;

    // Determine target pixel format
    AVPixelFormat targetFormat = codecCtx_->pix_fmt;
    if (targetFormat == AV_PIX_FMT_VAAPI || targetFormat == AV_PIX_FMT_NONE) {
        targetFormat = AV_PIX_FMT_YUV420P;
    }

    // Check for alpha
    bool inputHasAlpha = (srcFrame->format == AV_PIX_FMT_RGBA ||
                          srcFrame->format == AV_PIX_FMT_BGRA ||
                          srcFrame->format == AV_PIX_FMT_YUVA420P);

    if (alpha_ && inputHasAlpha && targetFormat == AV_PIX_FMT_YUV420P) {
        targetFormat = AV_PIX_FMT_YUVA420P;
    }

    // Clone and convert frame
    AVFrame* frame = av_frame_alloc();
    frame->format = targetFormat;
    frame->width = width_;
    frame->height = height_;
    frame->pts = job.timestamp;

    int ret = av_frame_get_buffer(frame, 0);
    if (ret < 0) {
        av_frame_free(&frame);
        av_frame_free(&srcFrame);

        EncodeResult result;
        result.isError = true;
        result.errorMessage = "Failed to allocate frame buffer";

        tsfnError_.BlockingCall(&result, [](Napi::Env env, Napi::Function fn, EncodeResult* res) {
            fn.Call({ Napi::String::New(env, res->errorMessage) });
        });
        return;
    }

    // Convert if needed
    if (srcFrame->format != targetFormat ||
        srcFrame->width != width_ ||
        srcFrame->height != height_) {

        if (!swsCtx_) {
            swsCtx_ = sws_getContext(
                srcFrame->width, srcFrame->height, (AVPixelFormat)srcFrame->format,
                width_, height_, targetFormat,
                SWS_BILINEAR, nullptr, nullptr, nullptr
            );
        }

        if (swsCtx_) {
            sws_scale(swsCtx_,
                srcFrame->data, srcFrame->linesize, 0, srcFrame->height,
                frame->data, frame->linesize
            );
        }
        // Free source frame after conversion
        av_frame_free(&srcFrame);
    } else {
        // OPTIMIZATION: Use av_frame_ref for zero-copy when formats match exactly
        // This just increments the reference count instead of copying data
        av_frame_free(&frame);  // Free the pre-allocated frame
        frame = av_frame_alloc();
        if (!frame) {
            av_frame_free(&srcFrame);
            EncodeResult result;
            result.isError = true;
            result.errorMessage = "Failed to allocate frame for reference";
            tsfnError_.BlockingCall(&result, [](Napi::Env env, Napi::Function fn, EncodeResult* res) {
                fn.Call({ Napi::String::New(env, res->errorMessage) });
            });
            return;
        }
        int ref_ret = av_frame_ref(frame, srcFrame);
        av_frame_free(&srcFrame);  // Free source after reference
        if (ref_ret < 0) {
            av_frame_free(&frame);
            EncodeResult result;
            result.isError = true;
            result.errorMessage = "Failed to reference frame";
            tsfnError_.BlockingCall(&result, [](Napi::Env env, Napi::Function fn, EncodeResult* res) {
                fn.Call({ Napi::String::New(env, res->errorMessage) });
            });
            return;
        }
        frame->pts = job.timestamp;  // Set the timestamp on the referenced frame
    }

    // Set keyframe flag
    if (job.forceKeyframe) {
        frame->pict_type = AV_PICTURE_TYPE_I;
    }

    // Send frame to encoder
    ret = avcodec_send_frame(codecCtx_, frame);
    av_frame_free(&frame);

    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));

        EncodeResult result;
        result.isError = true;
        result.errorMessage = std::string("Encode error: ") + errBuf;

        tsfnError_.BlockingCall(&result, [](Napi::Env env, Napi::Function fn, EncodeResult* res) {
            fn.Call({ Napi::String::New(env, res->errorMessage) });
        });
        return;
    }

    // Receive encoded packets
    AVPacket* packet = av_packet_alloc();
    while (ret >= 0) {
        ret = avcodec_receive_packet(codecCtx_, packet);
        if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
            break;
        } else if (ret < 0) {
            break;
        }

        // Create result
        EncodeResult* result = new EncodeResult();
        result->data.assign(packet->data, packet->data + packet->size);
        result->isKeyframe = (packet->flags & AV_PKT_FLAG_KEY) != 0;
        result->pts = packet->pts;
        result->duration = packet->duration;
        result->isError = false;
        result->isFlushComplete = false;

        // Include extradata for keyframes
        if (result->isKeyframe && codecCtx_->extradata && codecCtx_->extradata_size > 0) {
            result->extradata.assign(codecCtx_->extradata, codecCtx_->extradata + codecCtx_->extradata_size);
            result->hasExtradata = true;
        } else {
            result->hasExtradata = false;
        }

        // Call JS callback
        tsfnOutput_.BlockingCall(result, [](Napi::Env env, Napi::Function fn, EncodeResult* res) {
            Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(
                env, res->data.data(), res->data.size());

            Napi::Value extradataValue = env.Undefined();
            if (res->hasExtradata) {
                extradataValue = Napi::Buffer<uint8_t>::Copy(
                    env, res->extradata.data(), res->extradata.size());
            }

            fn.Call({
                buffer,
                Napi::Boolean::New(env, res->isKeyframe),
                Napi::Number::New(env, static_cast<double>(res->pts)),
                Napi::Number::New(env, static_cast<double>(res->duration)),
                extradataValue,
                env.Undefined()  // alphaSideData (not supported in async yet)
            });

            delete res;
        });

        av_packet_unref(packet);
    }
    av_packet_free(&packet);
}

void VideoEncoderAsync::ProcessFlush() {
    if (!codecCtx_) {
        flushPending_ = false;
        flushCV_.notify_all();
        return;
    }

    // Send NULL frame to flush
    avcodec_send_frame(codecCtx_, nullptr);

    AVPacket* packet = av_packet_alloc();
    int ret;
    while ((ret = avcodec_receive_packet(codecCtx_, packet)) >= 0) {
        EncodeResult* result = new EncodeResult();
        result->data.assign(packet->data, packet->data + packet->size);
        result->isKeyframe = (packet->flags & AV_PKT_FLAG_KEY) != 0;
        result->pts = packet->pts;
        result->duration = packet->duration;
        result->isError = false;
        result->isFlushComplete = false;
        result->hasExtradata = false;

        // Use NonBlockingCall to prevent deadlock in resource-constrained environments
        // (CI, serverless, containers) where the JS event loop may be starved
        tsfnOutput_.NonBlockingCall(result, [](Napi::Env env, Napi::Function fn, EncodeResult* res) {
            Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(
                env, res->data.data(), res->data.size());

            fn.Call({
                buffer,
                Napi::Boolean::New(env, res->isKeyframe),
                Napi::Number::New(env, static_cast<double>(res->pts)),
                Napi::Number::New(env, static_cast<double>(res->duration)),
                env.Undefined(),
                env.Undefined()
            });

            delete res;
        });

        av_packet_unref(packet);
    }
    av_packet_free(&packet);

    // Signal flush complete using NonBlockingCall to prevent deadlock
    if (tsfnFlush_) {
        tsfnFlush_.NonBlockingCall([](Napi::Env env, Napi::Function fn) {
            fn.Call({ env.Null() });
        });
    }

    flushPending_ = false;
    flushCV_.notify_all();
}

void VideoEncoderAsync::Encode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!configured_) {
        Napi::Error::New(env, "Encoder not configured").ThrowAsJavaScriptException();
        return;
    }

    // Get native frame
    VideoFrameNative* frameWrapper = Napi::ObjectWrap<VideoFrameNative>::Unwrap(info[0].As<Napi::Object>());
    AVFrame* srcFrame = frameWrapper->GetFrame();

    if (!srcFrame) {
        Napi::Error::New(env, "Invalid frame").ThrowAsJavaScriptException();
        return;
    }

    int64_t timestamp = info[1].As<Napi::Number>().Int64Value();
    bool forceKeyframe = info[2].As<Napi::Boolean>().Value();

    // Clone frame for async processing
    AVFrame* frameCopy = av_frame_clone(srcFrame);
    if (!frameCopy) {
        Napi::Error::New(env, "Failed to clone frame").ThrowAsJavaScriptException();
        return;
    }

    EncodeJob job{frameCopy, timestamp, forceKeyframe, false};

    {
        std::lock_guard<std::mutex> lock(queueMutex_);
        jobQueue_.push(std::move(job));
    }
    queueCV_.notify_one();
}

Napi::Value VideoEncoderAsync::Flush(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!configured_) {
        Napi::Function callback = info[0].As<Napi::Function>();
        callback.Call({ env.Null() });
        return env.Undefined();
    }

    // Create thread-safe function for flush callback
    Napi::Function callback = info[0].As<Napi::Function>();
    tsfnFlush_ = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "VideoEncoderAsyncFlush",
        0,
        1
    );

    flushPending_ = true;

    // Queue flush job
    EncodeJob job{nullptr, 0, false, true};

    {
        std::lock_guard<std::mutex> lock(queueMutex_);
        jobQueue_.push(std::move(job));
    }
    queueCV_.notify_one();

    return env.Undefined();
}

void VideoEncoderAsync::Reset(const Napi::CallbackInfo& info) {
    // Wait for pending work to complete
    {
        std::unique_lock<std::mutex> lock(queueMutex_);
        // Clear queue
        while (!jobQueue_.empty()) {
            EncodeJob& job = jobQueue_.front();
            if (job.frame) {
                av_frame_free(&job.frame);
            }
            jobQueue_.pop();
        }
    }

    if (codecCtx_) {
        avcodec_flush_buffers(codecCtx_);
    }
}

void VideoEncoderAsync::Close(const Napi::CallbackInfo& info) {
    // Stop worker thread
    running_ = false;
    queueCV_.notify_all();

    if (workerThread_.joinable()) {
        workerThread_.join();
    }

    // Clear queue
    {
        std::lock_guard<std::mutex> lock(queueMutex_);
        while (!jobQueue_.empty()) {
            EncodeJob& job = jobQueue_.front();
            if (job.frame) {
                av_frame_free(&job.frame);
            }
            jobQueue_.pop();
        }
    }

    // Clean up FFmpeg
    if (swsCtx_) {
        sws_freeContext(swsCtx_);
        swsCtx_ = nullptr;
    }

    if (hwFramesCtx_) {
        av_buffer_unref(&hwFramesCtx_);
        hwFramesCtx_ = nullptr;
    }

    if (hwDeviceCtx_) {
        av_buffer_unref(&hwDeviceCtx_);
        hwDeviceCtx_ = nullptr;
    }

    if (codecCtx_) {
        avcodec_free_context(&codecCtx_);
        codecCtx_ = nullptr;
    }

    configured_ = false;
}
