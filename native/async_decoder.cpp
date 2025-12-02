#include "async_decoder.h"
#include "frame.h"

Napi::FunctionReference VideoDecoderAsync::constructor;

Napi::Object VideoDecoderAsync::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "VideoDecoderAsync", {
        InstanceMethod("configure", &VideoDecoderAsync::Configure),
        InstanceMethod("decode", &VideoDecoderAsync::Decode),
        InstanceMethod("flush", &VideoDecoderAsync::Flush),
        InstanceMethod("reset", &VideoDecoderAsync::Reset),
        InstanceMethod("close", &VideoDecoderAsync::Close),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("VideoDecoderAsync", func);
    return exports;
}

VideoDecoderAsync::VideoDecoderAsync(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<VideoDecoderAsync>(info)
    , codecCtx_(nullptr)
    , codec_(nullptr) {

    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 callbacks").ThrowAsJavaScriptException();
        return;
    }

    // Create thread-safe functions for callbacks
    tsfnOutput_ = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "VideoDecoderAsyncOutput",
        0,  // Unlimited queue
        1   // 1 initial thread
    );

    tsfnError_ = Napi::ThreadSafeFunction::New(
        env,
        info[1].As<Napi::Function>(),
        "VideoDecoderAsyncError",
        0,
        1
    );
}

VideoDecoderAsync::~VideoDecoderAsync() {
    // Signal worker to stop
    running_ = false;
    queueCV_.notify_all();

    // Wait for worker thread to finish
    if (workerThread_.joinable()) {
        workerThread_.join();
    }

    // Clean up FFmpeg resources
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

void VideoDecoderAsync::Configure(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "Config must be an object").ThrowAsJavaScriptException();
        return;
    }

    Napi::Object config = info[0].As<Napi::Object>();
    std::string codecName = config.Get("codec").As<Napi::String>().Utf8Value();

    // For H.264 decoding, use the decoder not encoder
    if (codecName == "libx264") {
        codecName = "h264";
    }

    // For AV1, prefer libdav1d
    if (codecName == "av1") {
        codec_ = avcodec_find_decoder_by_name("libdav1d");
        if (!codec_) {
            codec_ = avcodec_find_decoder_by_name("libaom-av1");
        }
        if (!codec_) {
            codec_ = avcodec_find_decoder(AV_CODEC_ID_AV1);
        }
    } else {
        codec_ = avcodec_find_decoder_by_name(codecName.c_str());
    }

    if (!codec_) {
        // Try by codec ID
        if (codecName == "h264") {
            codec_ = avcodec_find_decoder(AV_CODEC_ID_H264);
        } else if (codecName == "vp8") {
            codec_ = avcodec_find_decoder(AV_CODEC_ID_VP8);
        } else if (codecName == "vp9") {
            codec_ = avcodec_find_decoder(AV_CODEC_ID_VP9);
        } else if (codecName == "hevc") {
            codec_ = avcodec_find_decoder(AV_CODEC_ID_HEVC);
        }
    }

    if (!codec_) {
        Napi::Error::New(env, "Codec not found: " + codecName).ThrowAsJavaScriptException();
        return;
    }

    codecCtx_ = avcodec_alloc_context3(codec_);
    if (!codecCtx_) {
        Napi::Error::New(env, "Failed to allocate codec context").ThrowAsJavaScriptException();
        return;
    }

    // Set dimensions if provided
    if (config.Has("width")) {
        codecCtx_->width = config.Get("width").As<Napi::Number>().Int32Value();
    }
    if (config.Has("height")) {
        codecCtx_->height = config.Get("height").As<Napi::Number>().Int32Value();
    }

    // Set extradata
    if (config.Has("extradata")) {
        Napi::Buffer<uint8_t> extradata = config.Get("extradata").As<Napi::Buffer<uint8_t>>();
        codecCtx_->extradata_size = extradata.Length();
        codecCtx_->extradata = (uint8_t*)av_malloc(extradata.Length() + AV_INPUT_BUFFER_PADDING_SIZE);
        memcpy(codecCtx_->extradata, extradata.Data(), extradata.Length());
        memset(codecCtx_->extradata + extradata.Length(), 0, AV_INPUT_BUFFER_PADDING_SIZE);
    }

    // Open codec
    int ret = avcodec_open2(codecCtx_, codec_, nullptr);
    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        avcodec_free_context(&codecCtx_);
        codecCtx_ = nullptr;
        Napi::Error::New(env, std::string("Failed to open codec: ") + errBuf).ThrowAsJavaScriptException();
        return;
    }

    configured_ = true;

    // Start worker thread
    running_ = true;
    workerThread_ = std::thread(&VideoDecoderAsync::WorkerThread, this);
}

void VideoDecoderAsync::WorkerThread() {
    while (running_) {
        DecodeJob job;

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
            ProcessDecode(job);
        }
    }
}

void VideoDecoderAsync::ProcessDecode(DecodeJob& job) {
    if (!codecCtx_) {
        return;
    }

    // Create packet
    AVPacket* packet = av_packet_alloc();
    packet->data = job.data.data();
    packet->size = static_cast<int>(job.data.size());
    packet->pts = job.timestamp;
    packet->dts = job.timestamp;
    packet->duration = job.duration;

    if (job.isKeyframe) {
        packet->flags |= AV_PKT_FLAG_KEY;
    }

    // Send packet to decoder
    int ret = avcodec_send_packet(codecCtx_, packet);
    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));

        DecodeResult result;
        result.frame = nullptr;
        result.isError = true;
        result.errorMessage = std::string("Decode error: ") + errBuf;

        tsfnError_.BlockingCall(&result, [](Napi::Env env, Napi::Function fn, DecodeResult* res) {
            fn.Call({ Napi::String::New(env, res->errorMessage) });
        });

        av_packet_free(&packet);
        return;
    }

    // Receive decoded frames
    AVFrame* frame = av_frame_alloc();
    while (ret >= 0) {
        ret = avcodec_receive_frame(codecCtx_, frame);
        if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
            break;
        } else if (ret < 0) {
            char errBuf[256];
            av_strerror(ret, errBuf, sizeof(errBuf));

            DecodeResult result;
            result.frame = nullptr;
            result.isError = true;
            result.errorMessage = std::string("Decode error: ") + errBuf;

            tsfnError_.BlockingCall(&result, [](Napi::Env env, Napi::Function fn, DecodeResult* res) {
                fn.Call({ Napi::String::New(env, res->errorMessage) });
            });
            break;
        }

        // Clone frame for output
        AVFrame* outputFrame = av_frame_clone(frame);

        DecodeResult* result = new DecodeResult();
        result->frame = outputFrame;
        result->timestamp = job.timestamp;
        result->duration = job.duration;
        result->isError = false;
        result->isFlushComplete = false;

        // Call JS callback
        tsfnOutput_.BlockingCall(result, [](Napi::Env env, Napi::Function fn, DecodeResult* res) {
            Napi::Object nativeFrame = VideoFrameNative::NewInstance(env, res->frame);

            fn.Call({
                nativeFrame,
                Napi::Number::New(env, static_cast<double>(res->timestamp)),
                Napi::Number::New(env, static_cast<double>(res->duration))
            });

            delete res;
        });

        av_frame_unref(frame);
    }

    av_frame_free(&frame);
    av_packet_free(&packet);
}

void VideoDecoderAsync::ProcessFlush() {
    if (!codecCtx_) {
        flushPending_ = false;
        return;
    }

    // Send NULL packet to flush
    avcodec_send_packet(codecCtx_, nullptr);

    AVFrame* frame = av_frame_alloc();
    int ret;
    while ((ret = avcodec_receive_frame(codecCtx_, frame)) >= 0) {
        AVFrame* outputFrame = av_frame_clone(frame);

        DecodeResult* result = new DecodeResult();
        result->frame = outputFrame;
        result->timestamp = frame->pts;
        result->duration = frame->duration;
        result->isError = false;
        result->isFlushComplete = false;

        tsfnOutput_.BlockingCall(result, [](Napi::Env env, Napi::Function fn, DecodeResult* res) {
            Napi::Object nativeFrame = VideoFrameNative::NewInstance(env, res->frame);

            fn.Call({
                nativeFrame,
                Napi::Number::New(env, static_cast<double>(res->timestamp)),
                Napi::Number::New(env, static_cast<double>(res->duration))
            });

            delete res;
        });

        av_frame_unref(frame);
    }
    av_frame_free(&frame);

    // Signal flush complete
    if (tsfnFlush_) {
        tsfnFlush_.BlockingCall([](Napi::Env env, Napi::Function fn) {
            fn.Call({ env.Null() });
        });
    }

    flushPending_ = false;
}

void VideoDecoderAsync::Decode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!configured_) {
        Napi::Error::New(env, "Decoder not configured").ThrowAsJavaScriptException();
        return;
    }

    Napi::Buffer<uint8_t> data = info[0].As<Napi::Buffer<uint8_t>>();
    bool isKeyframe = info[1].As<Napi::Boolean>().Value();
    int64_t timestamp = info[2].As<Napi::Number>().Int64Value();
    int64_t duration = info[3].As<Napi::Number>().Int64Value();

    // Copy data for async processing
    DecodeJob job;
    job.data.assign(data.Data(), data.Data() + data.Length());
    job.isKeyframe = isKeyframe;
    job.timestamp = timestamp;
    job.duration = duration;
    job.isFlush = false;

    {
        std::lock_guard<std::mutex> lock(queueMutex_);
        jobQueue_.push(std::move(job));
    }
    queueCV_.notify_one();
}

Napi::Value VideoDecoderAsync::Flush(const Napi::CallbackInfo& info) {
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
        "VideoDecoderAsyncFlush",
        0,
        1
    );

    flushPending_ = true;

    // Queue flush job
    DecodeJob job;
    job.isFlush = true;

    {
        std::lock_guard<std::mutex> lock(queueMutex_);
        jobQueue_.push(std::move(job));
    }
    queueCV_.notify_one();

    return env.Undefined();
}

void VideoDecoderAsync::Reset(const Napi::CallbackInfo& info) {
    // Clear queue
    {
        std::lock_guard<std::mutex> lock(queueMutex_);
        while (!jobQueue_.empty()) {
            jobQueue_.pop();
        }
    }

    if (codecCtx_) {
        avcodec_flush_buffers(codecCtx_);
    }
}

void VideoDecoderAsync::Close(const Napi::CallbackInfo& info) {
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
            jobQueue_.pop();
        }
    }

    // Clean up FFmpeg
    if (codecCtx_) {
        avcodec_free_context(&codecCtx_);
        codecCtx_ = nullptr;
    }

    configured_ = false;
}
