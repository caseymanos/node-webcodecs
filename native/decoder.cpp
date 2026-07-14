#include "decoder.h"
#include "frame.h"

Napi::FunctionReference VideoDecoderNative::constructor;

Napi::Object VideoDecoderNative::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "VideoDecoderNative", {
        InstanceMethod("configure", &VideoDecoderNative::Configure),
        InstanceMethod("decode", &VideoDecoderNative::Decode),
        InstanceMethod("flush", &VideoDecoderNative::Flush),
        InstanceMethod("reset", &VideoDecoderNative::Reset),
        InstanceMethod("close", &VideoDecoderNative::Close),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("VideoDecoderNative", func);
    return exports;
}

VideoDecoderNative::VideoDecoderNative(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<VideoDecoderNative>(info)
    , codecCtx_(nullptr)
    , codec_(nullptr)
    , configured_(false) {

    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 callbacks").ThrowAsJavaScriptException();
        return;
    }

    // Store callbacks directly for synchronous operations
    outputCallback_ = Napi::Persistent(info[0].As<Napi::Function>());
    errorCallback_ = Napi::Persistent(info[1].As<Napi::Function>());
}

VideoDecoderNative::~VideoDecoderNative() {
    if (codecCtx_) {
        avcodec_free_context(&codecCtx_);
    }
}

void VideoDecoderNative::Configure(const Napi::CallbackInfo& info) {
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

    // For AV1, prefer libdav1d (software decoder) over hardware decoder
    // since hardware AV1 decoding may not be available on all platforms
    if (codecName == "av1") {
        codec_ = avcodec_find_decoder_by_name("libdav1d");
        if (!codec_) {
            // Fallback to libaom-av1 software decoder
            codec_ = avcodec_find_decoder_by_name("libaom-av1");
        }
        if (!codec_) {
            // Last resort: try generic AV1 decoder
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

    // Set extradata (AVCC format for H.264)
    if (config.Has("extradata")) {
        Napi::Buffer<uint8_t> extradata = config.Get("extradata").As<Napi::Buffer<uint8_t>>();
        codecCtx_->extradata_size = extradata.Length();
        codecCtx_->extradata = (uint8_t*)av_malloc(extradata.Length() + AV_INPUT_BUFFER_PADDING_SIZE);
        memcpy(codecCtx_->extradata, extradata.Data(), extradata.Length());
        memset(codecCtx_->extradata + extradata.Length(), 0, AV_INPUT_BUFFER_PADDING_SIZE);
    }

    // 0 = auto-detect core count; default of 1 leaves multicore decode on the table
    codecCtx_->thread_count = 0;

    // Open codec
    int ret = avcodec_open2(codecCtx_, codec_, nullptr);
    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        avcodec_free_context(&codecCtx_);
        Napi::Error::New(env, std::string("Failed to open codec: ") + errBuf).ThrowAsJavaScriptException();
        return;
    }

    configured_ = true;
}

void VideoDecoderNative::Decode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!configured_) {
        Napi::Error::New(env, "Decoder not configured").ThrowAsJavaScriptException();
        return;
    }

    Napi::Buffer<uint8_t> data = info[0].As<Napi::Buffer<uint8_t>>();
    bool isKeyframe = info[1].As<Napi::Boolean>().Value();
    int64_t timestamp = info[2].As<Napi::Number>().Int64Value();
    int64_t duration = info[3].As<Napi::Number>().Int64Value();

    // Create packet from data
    AVPacket* packet = av_packet_alloc();
    packet->data = data.Data();
    packet->size = data.Length();
    packet->pts = timestamp;
    packet->dts = timestamp;
    packet->duration = duration;

    if (isKeyframe) {
        packet->flags |= AV_PKT_FLAG_KEY;
    }

    // Send packet to decoder
    int ret = avcodec_send_packet(codecCtx_, packet);
    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        EmitError(env, std::string("Decode error: ") + errBuf);
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
            EmitError(env, std::string("Decode error: ") + errBuf);
            break;
        }

        // Clone frame and emit
        AVFrame* outputFrame = av_frame_clone(frame);
        EmitFrame(env, outputFrame, timestamp, duration);
        av_frame_unref(frame);
    }

    av_frame_free(&frame);
    av_packet_free(&packet);
}

void VideoDecoderNative::EmitFrame(Napi::Env env, AVFrame* frame, int64_t timestamp, int64_t duration) {
    Napi::Object nativeFrame = VideoFrameNative::NewInstance(env, frame);
    outputCallback_.Value().Call({
        nativeFrame,
        Napi::Number::New(env, timestamp),
        Napi::Number::New(env, duration)
    });
}

void VideoDecoderNative::EmitError(Napi::Env env, const std::string& message) {
    errorCallback_.Value().Call({ Napi::String::New(env, message) });
}

Napi::Value VideoDecoderNative::Flush(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Flush decoder by sending NULL packet
    if (configured_ && codecCtx_) {
        avcodec_send_packet(codecCtx_, nullptr);

        AVFrame* frame = av_frame_alloc();
        int ret;
        while ((ret = avcodec_receive_frame(codecCtx_, frame)) >= 0) {
            AVFrame* outputFrame = av_frame_clone(frame);
            EmitFrame(env, outputFrame, frame->pts, NWC_FRAME_DURATION(frame));
            av_frame_unref(frame);
        }
        av_frame_free(&frame);
    }

    // Return promise that resolves when queue is empty
    Napi::Function callback = info[0].As<Napi::Function>();
    callback.Call({ env.Null() });

    return env.Undefined();
}

void VideoDecoderNative::Reset(const Napi::CallbackInfo& info) {
    // Reset codec state
    if (codecCtx_) {
        avcodec_flush_buffers(codecCtx_);
    }
}

void VideoDecoderNative::Close(const Napi::CallbackInfo& info) {
    if (codecCtx_) {
        avcodec_free_context(&codecCtx_);
        codecCtx_ = nullptr;
    }

    configured_ = false;
}
