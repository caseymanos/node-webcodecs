#include "encoder.h"
#include "frame.h"
#include "hw_accel.h"
#include "color.h"
#include "svc.h"

Napi::FunctionReference VideoEncoderNative::constructor;

Napi::Object VideoEncoderNative::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "VideoEncoderNative", {
        InstanceMethod("configure", &VideoEncoderNative::Configure),
        InstanceMethod("encode", &VideoEncoderNative::Encode),
        InstanceMethod("flush", &VideoEncoderNative::Flush),
        InstanceMethod("reset", &VideoEncoderNative::Reset),
        InstanceMethod("close", &VideoEncoderNative::Close),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("VideoEncoderNative", func);
    return exports;
}

VideoEncoderNative::VideoEncoderNative(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<VideoEncoderNative>(info)
    , codecCtx_(nullptr)
    , codec_(nullptr)
    , swsCtx_(nullptr)
    , hwType_(HWAccel::Type::None)
    , hwDeviceCtx_(nullptr)
    , hwFramesCtx_(nullptr)
    , hwInputFormat_(AV_PIX_FMT_NONE)
    , configured_(false)
    , avcAnnexB_(true)
    , width_(0)
    , height_(0)
    , bitrateMode_("variable")
    , codecName_("")
    , bitrate_(2000000)
    , alpha_(false)
    , scalabilityMode_("")
    , temporalLayers_(1) {

    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 callbacks").ThrowAsJavaScriptException();
        return;
    }

    // Store callbacks directly instead of using ThreadSafeFunction for sync operations
    outputCallback_ = Napi::Persistent(info[0].As<Napi::Function>());
    errorCallback_ = Napi::Persistent(info[1].As<Napi::Function>());
}

VideoEncoderNative::~VideoEncoderNative() {
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
}

void VideoEncoderNative::configureEncoderOptions(const std::string& encoderName, const std::string& latencyMode) {
    bool isRealtime = (latencyMode == "realtime");

    // Global realtime optimizations - threading and delay
    if (isRealtime) {
        codecCtx_->thread_count = 1;  // Single thread for lowest latency
        codecCtx_->thread_type = 0;   // Disable threading
        codecCtx_->delay = 0;         // No delay
        codecCtx_->max_b_frames = 0;  // No B-frames for lowest latency
        codecCtx_->refs = 1;          // Single reference frame
    }

    if (encoderName == "libx264") {
        if (isRealtime) {
            av_opt_set(codecCtx_->priv_data, "preset", "ultrafast", 0);
            av_opt_set(codecCtx_->priv_data, "tune", "zerolatency", 0);
            av_opt_set(codecCtx_->priv_data, "rc-lookahead", "0", 0);
            av_opt_set(codecCtx_->priv_data, "sync-lookahead", "0", 0);
            av_opt_set(codecCtx_->priv_data, "intra-refresh", "1", 0);
        } else {
            av_opt_set(codecCtx_->priv_data, "preset", "medium", 0);
        }
    }
    else if (encoderName == "h264_videotoolbox" || encoderName == "hevc_videotoolbox") {
        av_opt_set(codecCtx_->priv_data, "realtime", isRealtime ? "1" : "0", 0);
        av_opt_set(codecCtx_->priv_data, "allow_sw", "1", 0);  // Allow software fallback
    }
    else if (encoderName == "h264_nvenc" || encoderName == "hevc_nvenc") {
        if (isRealtime) {
            av_opt_set(codecCtx_->priv_data, "preset", "p1", 0);  // Fastest
            av_opt_set(codecCtx_->priv_data, "tune", "ll", 0);    // Low latency
            av_opt_set(codecCtx_->priv_data, "zerolatency", "1", 0);
            av_opt_set(codecCtx_->priv_data, "rc-lookahead", "0", 0);
        } else {
            av_opt_set(codecCtx_->priv_data, "preset", "p4", 0);  // Balanced
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
        // VP8/VP9 options
        if (codecCtx_->bit_rate > 0) {
            av_opt_set_int(codecCtx_->priv_data, "crf", 10, 0);
            av_opt_set_int(codecCtx_->priv_data, "b", codecCtx_->bit_rate, 0);
        }
        if (isRealtime) {
            av_opt_set_int(codecCtx_->priv_data, "cpu-used", 8, 0);  // Fastest
            av_opt_set_int(codecCtx_->priv_data, "lag-in-frames", 0, 0);
            av_opt_set(codecCtx_->priv_data, "deadline", "realtime", 0);
        } else {
            av_opt_set_int(codecCtx_->priv_data, "cpu-used", 4, 0);
        }
    }
    else if (encoderName == "libx265") {
        av_opt_set(codecCtx_->priv_data, "preset", isRealtime ? "ultrafast" : "medium", 0);
        if (isRealtime) {
            av_opt_set(codecCtx_->priv_data, "tune", "zerolatency", 0);
        }
    }
    else if (encoderName == "libaom-av1" || encoderName == "libsvtav1") {
        if (isRealtime) {
            av_opt_set_int(codecCtx_->priv_data, "cpu-used", 10, 0);  // Max speed
            av_opt_set_int(codecCtx_->priv_data, "lag-in-frames", 0, 0);
            av_opt_set(codecCtx_->priv_data, "usage", "realtime", 0);
        } else {
            av_opt_set_int(codecCtx_->priv_data, "cpu-used", 6, 0);
        }
    }
}

void VideoEncoderNative::Configure(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "Config must be an object").ThrowAsJavaScriptException();
        return;
    }

    Napi::Object config = info[0].As<Napi::Object>();
    std::string codecName = config.Get("codec").As<Napi::String>().Utf8Value();

    // Required parameters
    width_ = config.Get("width").As<Napi::Number>().Int32Value();
    height_ = config.Get("height").As<Napi::Number>().Int32Value();

    // Parse hardware acceleration preference
    HWAccel::Preference hwPref = HWAccel::Preference::NoPreference;
    if (config.Has("hardwareAcceleration")) {
        std::string pref = config.Get("hardwareAcceleration").As<Napi::String>().Utf8Value();
        hwPref = HWAccel::parsePreference(pref);
    }

    // Select encoder based on preference and availability
    HWAccel::EncoderInfo encInfo = HWAccel::selectEncoder(codecName, hwPref, width_, height_);

    if (!encInfo.codec) {
        // Fall back to direct codec lookup
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

    // Log which encoder was selected (for debugging)
    // printf("[node-webcodecs] Selected encoder: %s (%s)\n",
    //        codec_->name, HWAccel::getTypeName(hwType_));

    codecCtx_ = avcodec_alloc_context3(codec_);
    if (!codecCtx_) {
        Napi::Error::New(env, "Failed to allocate codec context").ThrowAsJavaScriptException();
        return;
    }

    codecCtx_->width = width_;
    codecCtx_->height = height_;

    // Time base - default to 1/1000000 (microseconds)
    codecCtx_->time_base = { 1, 1000000 };

    // Store codec name for later use
    codecName_ = codec_->name;

    // Bitrate
    if (config.Has("bitrate")) {
        bitrate_ = config.Get("bitrate").As<Napi::Number>().Int64Value();
    } else {
        bitrate_ = 2000000;  // 2 Mbps default
    }

    // Bitrate mode: 'constant', 'variable', or 'quantizer'
    if (config.Has("bitrateMode")) {
        bitrateMode_ = config.Get("bitrateMode").As<Napi::String>().Utf8Value();
    } else {
        bitrateMode_ = "variable";
    }

    // Configure rate control based on bitrateMode
    if (bitrateMode_ == "constant") {
        // CBR - Constant Bit Rate
        codecCtx_->bit_rate = bitrate_;
        codecCtx_->rc_min_rate = bitrate_;
        codecCtx_->rc_max_rate = bitrate_;
        codecCtx_->rc_buffer_size = static_cast<int>(bitrate_);  // 1 second buffer

        // Codec-specific CBR settings
        if (codecName_.find("libx264") != std::string::npos) {
            av_opt_set(codecCtx_->priv_data, "nal-hrd", "cbr", 0);
        } else if (codecName_.find("libvpx") != std::string::npos) {
            av_opt_set_int(codecCtx_->priv_data, "minrate", bitrate_, 0);
            av_opt_set_int(codecCtx_->priv_data, "maxrate", bitrate_, 0);
        }
    } else if (bitrateMode_ == "quantizer") {
        // CQP/CRF mode - Constant Quality, ignore bitrate
        codecCtx_->bit_rate = 0;
        codecCtx_->rc_max_rate = 0;

        // Set default quantizer based on codec
        if (codecName_.find("libx264") != std::string::npos ||
            codecName_.find("libx265") != std::string::npos) {
            av_opt_set_int(codecCtx_->priv_data, "crf", 23, 0);  // Default CRF
        } else if (codecName_.find("libvpx") != std::string::npos) {
            av_opt_set_int(codecCtx_->priv_data, "crf", 30, 0);  // Default for VP8/9
            codecCtx_->qmin = 0;
            codecCtx_->qmax = 63;
        } else if (codecName_.find("av1") != std::string::npos) {
            av_opt_set_int(codecCtx_->priv_data, "crf", 30, 0);  // Default for AV1
        }
    } else {
        // VBR (default) - Variable Bit Rate
        codecCtx_->bit_rate = bitrate_;
    }

    // Framerate for GOP calculation
    int fps = 30;
    if (config.Has("framerate")) {
        fps = config.Get("framerate").As<Napi::Number>().Int32Value();
    }
    codecCtx_->gop_size = fps;  // Keyframe every second
    codecCtx_->framerate = { fps, 1 };

    // Max B-frames
    codecCtx_->max_b_frames = 0;  // Disable B-frames for lower latency

    // Parse alpha option
    if (config.Has("alpha") && config.Get("alpha").IsString()) {
        std::string alphaMode = config.Get("alpha").As<Napi::String>().Utf8Value();
        alpha_ = (alphaMode == "keep");
    }

    // Set pixel format based on encoder type and alpha mode
    if (hwType_ != HWAccel::Type::None && hwInputFormat_ != AV_PIX_FMT_NONE) {
        codecCtx_->pix_fmt = hwInputFormat_;
    } else if (alpha_ && (codecName_.find("libvpx") != std::string::npos)) {
        // VP8/VP9 with alpha - use YUVA420P
        codecCtx_->pix_fmt = AV_PIX_FMT_YUVA420P;
    } else {
        codecCtx_->pix_fmt = AV_PIX_FMT_YUV420P;
    }

    // Color space configuration (HDR support)
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

    // Setup hardware device context if needed
    if (hwType_ != HWAccel::Type::None) {
        hwDeviceCtx_ = HWAccel::createHWDeviceContext(hwType_);

        if (hwDeviceCtx_) {
            codecCtx_->hw_device_ctx = av_buffer_ref(hwDeviceCtx_);
        }

        // Setup hardware frames context for VAAPI
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

    // Profile (for H.264)
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

    // AVC format (Annex B vs AVCC)
    if (config.Has("avcFormat")) {
        std::string format = config.Get("avcFormat").As<Napi::String>().Utf8Value();
        avcAnnexB_ = (format == "annexb");
    }

    // Configure encoder-specific options
    std::string latencyMode = "quality";
    if (config.Has("latencyMode")) {
        latencyMode = config.Get("latencyMode").As<Napi::String>().Utf8Value();
    }
    configureEncoderOptions(encoderName, latencyMode);

    // Scalability mode (SVC) for temporal layers
    if (config.Has("scalabilityMode") && config.Get("scalabilityMode").IsString()) {
        std::string svcMode = config.Get("scalabilityMode").As<Napi::String>().Utf8Value();

        if (!isScalabilityModeSupported(svcMode)) {
            Napi::Error::New(env, "Unsupported scalabilityMode: " + svcMode +
                ". Only L1T1, L1T2, L1T3 are currently supported.")
                .ThrowAsJavaScriptException();
            return;
        }

        ScalabilityConfig svcConfig = parseScalabilityMode(svcMode);

        if (svcConfig.temporalLayers > 1) {
            temporalLayers_ = svcConfig.temporalLayers;

            if (encoderName.find("libvpx") != std::string::npos) {
                // VP8/VP9 temporal layer configuration
                av_opt_set(codecCtx_->priv_data, "lag-in-frames", "0", 0);
                av_opt_set(codecCtx_->priv_data, "error-resilient", "1", 0);
                av_opt_set_int(codecCtx_->priv_data, "auto-alt-ref", 0, 0);

                // Build complete ts-parameters string for libvpx
                // Format: ts_number_layers=N:ts_target_bitrate=B1,B2,...:ts_rate_decimator=D1,D2,...
                char tsParams[256];
                int layers = svcConfig.temporalLayers;

                if (layers == 2) {
                    // L1T2: 2 temporal layers
                    // Layer 0: 60% bitrate, show every 2nd frame (decimator=2)
                    // Layer 1: 100% bitrate, show every frame (decimator=1)
                    int br0 = static_cast<int>(bitrate_ * 0.6 / 1000);  // Convert to kbps
                    int br1 = static_cast<int>(bitrate_ / 1000);
                    snprintf(tsParams, sizeof(tsParams),
                        "ts_number_layers=2:ts_target_bitrate=%d,%d:ts_rate_decimator=2,1:ts_periodicity=2:ts_layer_id=0,1",
                        br0, br1);
                } else if (layers == 3) {
                    // L1T3: 3 temporal layers
                    // Layer 0: 25% bitrate, decimator 4
                    // Layer 1: 50% bitrate, decimator 2
                    // Layer 2: 100% bitrate, decimator 1
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
                // AV1 temporal layer configuration
                av_opt_set(codecCtx_->priv_data, "lag-in-frames", "0", 0);

                // Use usage=realtime for SVC
                av_opt_set(codecCtx_->priv_data, "usage", "realtime", 0);
            }
            else if (encoderName.find("libsvtav1") != std::string::npos) {
                // SVT-AV1 temporal layer configuration
                char hierLevels[8];
                snprintf(hierLevels, sizeof(hierLevels), "%d", svcConfig.temporalLayers - 1);
                av_opt_set(codecCtx_->priv_data, "hierarchical-levels", hierLevels, 0);
            }
        }

        scalabilityMode_ = svcMode;
    }

    // Alpha channel configuration for libvpx (VP8/VP9)
    // auto-alt-ref must be disabled for transparency encoding to work
    if (alpha_ && codecName_.find("libvpx") != std::string::npos) {
        av_opt_set_int(codecCtx_->priv_data, "auto-alt-ref", 0, 0);
    }

    // Open codec
    int ret = avcodec_open2(codecCtx_, codec_, nullptr);
    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        avcodec_free_context(&codecCtx_);

        // If HW encoder failed, try software fallback
        if (hwType_ != HWAccel::Type::None && hwPref != HWAccel::Preference::PreferHardware) {
            // Reset and try software
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
                codecCtx_->bit_rate = config.Has("bitrate") ?
                    config.Get("bitrate").As<Napi::Number>().Int64Value() : 2000000;
                codecCtx_->gop_size = fps;
                codecCtx_->framerate = { fps, 1 };
                codecCtx_->max_b_frames = 0;
                codecCtx_->pix_fmt = AV_PIX_FMT_YUV420P;

                configureEncoderOptions(codec_->name, latencyMode);

                ret = avcodec_open2(codecCtx_, codec_, nullptr);
                if (ret < 0) {
                    av_strerror(ret, errBuf, sizeof(errBuf));
                    avcodec_free_context(&codecCtx_);
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
}

void VideoEncoderNative::Encode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!configured_) {
        Napi::Error::New(env, "Encoder not configured").ThrowAsJavaScriptException();
        return;
    }

    // Get native frame from VideoFrameNative
    VideoFrameNative* frameWrapper = Napi::ObjectWrap<VideoFrameNative>::Unwrap(info[0].As<Napi::Object>());
    AVFrame* srcFrame = frameWrapper->GetFrame();

    if (!srcFrame) {
        Napi::Error::New(env, "Invalid frame").ThrowAsJavaScriptException();
        return;
    }

    int64_t timestamp = info[1].As<Napi::Number>().Int64Value();
    bool forceKeyframe = info[2].As<Napi::Boolean>().Value();

    // Determine target pixel format
    AVPixelFormat targetFormat = codecCtx_->pix_fmt;
    if (targetFormat == AV_PIX_FMT_VAAPI || targetFormat == AV_PIX_FMT_NONE) {
        targetFormat = AV_PIX_FMT_YUV420P;
    }

    // Check if input has alpha and we want to preserve it
    bool inputHasAlpha = (srcFrame->format == AV_PIX_FMT_RGBA ||
                          srcFrame->format == AV_PIX_FMT_BGRA ||
                          srcFrame->format == AV_PIX_FMT_YUVA420P);

    // If alpha mode is 'keep' and input has alpha, ensure we use YUVA420P
    if (alpha_ && inputHasAlpha && targetFormat == AV_PIX_FMT_YUV420P) {
        targetFormat = AV_PIX_FMT_YUVA420P;
    }

    // Clone and convert frame
    AVFrame* frame = av_frame_alloc();
    frame->format = targetFormat;
    frame->width = width_;
    frame->height = height_;
    frame->pts = timestamp;

    int ret = av_frame_get_buffer(frame, 0);
    if (ret < 0) {
        av_frame_free(&frame);
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        Napi::Error::New(env, std::string("Failed to allocate frame: ") + errBuf).ThrowAsJavaScriptException();
        return;
    }

    // Convert pixel format if needed
    if (srcFrame->format != targetFormat ||
        srcFrame->width != width_ ||
        srcFrame->height != height_) {

        if (!swsCtx_) {
            swsCtx_ = sws_getContext(
                srcFrame->width, srcFrame->height, (AVPixelFormat)srcFrame->format,
                width_, height_, targetFormat,
                SWS_BILINEAR, nullptr, nullptr, nullptr
            );

            if (!swsCtx_) {
                av_frame_free(&frame);
                Napi::Error::New(env, "Failed to create scaler context").ThrowAsJavaScriptException();
                return;
            }
        }

        sws_scale(swsCtx_,
            srcFrame->data, srcFrame->linesize, 0, srcFrame->height,
            frame->data, frame->linesize
        );
    } else {
        av_frame_copy(frame, srcFrame);
    }

    // Set keyframe flag
    if (forceKeyframe) {
        frame->pict_type = AV_PICTURE_TYPE_I;
    }

    // Send frame to encoder
    ret = avcodec_send_frame(codecCtx_, frame);
    av_frame_free(&frame);

    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        EmitError(env, std::string("Encode error: ") + errBuf);
        return;
    }

    // Receive encoded packets
    AVPacket* packet = av_packet_alloc();
    while (ret >= 0) {
        ret = avcodec_receive_packet(codecCtx_, packet);
        if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
            break;
        } else if (ret < 0) {
            char errBuf[256];
            av_strerror(ret, errBuf, sizeof(errBuf));
            EmitError(env, std::string("Encode error: ") + errBuf);
            break;
        }

        bool isKeyframe = (packet->flags & AV_PKT_FLAG_KEY) != 0;
        EmitChunk(env, packet, isKeyframe);
        av_packet_unref(packet);
    }
    av_packet_free(&packet);
}

void VideoEncoderNative::EmitChunk(Napi::Env env, AVPacket* packet, bool isKeyframe) {
    Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(env, packet->data, packet->size);

    Napi::Value extradataValue = env.Undefined();
    if (isKeyframe && codecCtx_->extradata && codecCtx_->extradata_size > 0) {
        extradataValue = Napi::Buffer<uint8_t>::Copy(env, codecCtx_->extradata, codecCtx_->extradata_size);
    }

    // Check for alpha side data (VP9 with alpha stores alpha plane here)
    Napi::Value alphaSideDataValue = env.Undefined();
    if (alpha_) {
        size_t sideDataSize = 0;
        const uint8_t* sideData = av_packet_get_side_data(packet,
            AV_PKT_DATA_MATROSKA_BLOCKADDITIONAL, &sideDataSize);
        if (sideData && sideDataSize > 0) {
            alphaSideDataValue = Napi::Buffer<uint8_t>::Copy(env, sideData, sideDataSize);
        }
    }

    outputCallback_.Value().Call({
        buffer,
        Napi::Boolean::New(env, isKeyframe),
        Napi::Number::New(env, packet->pts),
        Napi::Number::New(env, packet->duration),
        extradataValue,
        alphaSideDataValue
    });
}

void VideoEncoderNative::EmitError(Napi::Env env, const std::string& message) {
    errorCallback_.Value().Call({ Napi::String::New(env, message) });
}

Napi::Value VideoEncoderNative::Flush(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Flush encoder by sending NULL frame
    if (configured_ && codecCtx_) {
        avcodec_send_frame(codecCtx_, nullptr);

        AVPacket* packet = av_packet_alloc();
        int ret;
        while ((ret = avcodec_receive_packet(codecCtx_, packet)) >= 0) {
            bool isKeyframe = (packet->flags & AV_PKT_FLAG_KEY) != 0;
            EmitChunk(env, packet, isKeyframe);
            av_packet_unref(packet);
        }
        av_packet_free(&packet);
    }

    Napi::Function callback = info[0].As<Napi::Function>();
    callback.Call({ env.Null() });

    return env.Undefined();
}

void VideoEncoderNative::Reset(const Napi::CallbackInfo& info) {
    // Flush codec buffers
    if (codecCtx_) {
        avcodec_flush_buffers(codecCtx_);
    }
}

void VideoEncoderNative::Close(const Napi::CallbackInfo& info) {
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
