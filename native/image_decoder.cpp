#include "image_decoder.h"
#include "frame.h"
#include <map>

Napi::FunctionReference ImageDecoderNative::constructor;

static const std::map<std::string, AVCodecID> mimeToCodec = {
    {"image/jpeg", AV_CODEC_ID_MJPEG},
    {"image/png", AV_CODEC_ID_PNG},
    {"image/webp", AV_CODEC_ID_WEBP},
    {"image/gif", AV_CODEC_ID_GIF},
    {"image/avif", AV_CODEC_ID_AV1},
    {"image/bmp", AV_CODEC_ID_BMP},
    {"image/tiff", AV_CODEC_ID_TIFF},
};

Napi::Object ImageDecoderNative::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "ImageDecoderNative", {
        StaticMethod("isTypeSupported", &ImageDecoderNative::IsTypeSupported),
        InstanceMethod("decode", &ImageDecoderNative::Decode),
        InstanceMethod("reset", &ImageDecoderNative::Reset),
        InstanceMethod("close", &ImageDecoderNative::Close),
        InstanceAccessor("complete", &ImageDecoderNative::GetComplete, nullptr),
        InstanceAccessor("type", &ImageDecoderNative::GetType, nullptr),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("ImageDecoderNative", func);
    return exports;
}

ImageDecoderNative::ImageDecoderNative(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<ImageDecoderNative>(info),
      complete_(false), closed_(false), codecCtx_(nullptr), codec_(nullptr) {

    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Config object required").ThrowAsJavaScriptException();
        return;
    }

    Napi::Object config = info[0].As<Napi::Object>();

    // Get type (MIME)
    if (!config.Has("type")) {
        Napi::TypeError::New(env, "type is required").ThrowAsJavaScriptException();
        return;
    }
    type_ = config.Get("type").As<Napi::String>().Utf8Value();

    // Check if supported
    auto it = mimeToCodec.find(type_);
    if (it == mimeToCodec.end()) {
        Napi::Error::New(env, "Unsupported image type: " + type_).ThrowAsJavaScriptException();
        return;
    }

    // Find decoder
    codec_ = avcodec_find_decoder(it->second);
    if (!codec_) {
        Napi::Error::New(env, "Decoder not found for: " + type_).ThrowAsJavaScriptException();
        return;
    }

    // Get data
    if (config.Has("data")) {
        Napi::Value dataVal = config.Get("data");
        if (dataVal.IsBuffer()) {
            auto buf = dataVal.As<Napi::Buffer<uint8_t>>();
            data_.assign(buf.Data(), buf.Data() + buf.Length());
            complete_ = true;
        } else if (dataVal.IsArrayBuffer()) {
            auto ab = dataVal.As<Napi::ArrayBuffer>();
            data_.assign(static_cast<uint8_t*>(ab.Data()),
                        static_cast<uint8_t*>(ab.Data()) + ab.ByteLength());
            complete_ = true;
        } else if (dataVal.IsTypedArray()) {
            auto ta = dataVal.As<Napi::TypedArray>();
            auto ab = ta.ArrayBuffer();
            size_t offset = ta.ByteOffset();
            size_t length = ta.ByteLength();
            data_.assign(static_cast<uint8_t*>(ab.Data()) + offset,
                        static_cast<uint8_t*>(ab.Data()) + offset + length);
            complete_ = true;
        }
    }
}

ImageDecoderNative::~ImageDecoderNative() {
    if (codecCtx_) {
        avcodec_free_context(&codecCtx_);
    }
}

Napi::Value ImageDecoderNative::IsTypeSupported(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        return Napi::Boolean::New(env, false);
    }
    std::string type = info[0].As<Napi::String>().Utf8Value();

    // Check if we have a mapping for this MIME type
    auto it = mimeToCodec.find(type);
    if (it == mimeToCodec.end()) {
        return Napi::Boolean::New(env, false);
    }

    // Also verify the decoder is available in FFmpeg
    const AVCodec* codec = avcodec_find_decoder(it->second);
    return Napi::Boolean::New(env, codec != nullptr);
}

Napi::Value ImageDecoderNative::Decode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (closed_) {
        Napi::Error::New(env, "ImageDecoder is closed").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (data_.empty()) {
        Napi::Error::New(env, "No image data").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Initialize codec context if not already done
    if (!codecCtx_) {
        codecCtx_ = avcodec_alloc_context3(codec_);
        if (!codecCtx_) {
            Napi::Error::New(env, "Failed to allocate codec context").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        int ret = avcodec_open2(codecCtx_, codec_, nullptr);
        if (ret < 0) {
            char errBuf[256];
            av_strerror(ret, errBuf, sizeof(errBuf));
            avcodec_free_context(&codecCtx_);
            codecCtx_ = nullptr;
            Napi::Error::New(env, std::string("Failed to open image decoder: ") + errBuf).ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    // Create packet
    AVPacket* pkt = av_packet_alloc();
    if (!pkt) {
        Napi::Error::New(env, "Failed to allocate packet").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    pkt->data = data_.data();
    pkt->size = static_cast<int>(data_.size());

    // Send packet
    int ret = avcodec_send_packet(codecCtx_, pkt);
    av_packet_free(&pkt);

    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        Napi::Error::New(env, std::string("Failed to decode image: ") + errBuf).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Receive frame
    AVFrame* frame = av_frame_alloc();
    if (!frame) {
        Napi::Error::New(env, "Failed to allocate frame").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    ret = avcodec_receive_frame(codecCtx_, frame);

    if (ret < 0) {
        av_frame_free(&frame);
        if (ret == AVERROR(EAGAIN)) {
            Napi::Error::New(env, "Need more data to decode").ThrowAsJavaScriptException();
        } else if (ret == AVERROR_EOF) {
            Napi::Error::New(env, "End of file").ThrowAsJavaScriptException();
        } else {
            char errBuf[256];
            av_strerror(ret, errBuf, sizeof(errBuf));
            Napi::Error::New(env, std::string("Failed to receive decoded frame: ") + errBuf).ThrowAsJavaScriptException();
        }
        return env.Undefined();
    }

    // Create result object
    Napi::Object result = Napi::Object::New(env);

    // Create VideoFrameNative from the decoded frame
    Napi::Object frameObj = VideoFrameNative::NewInstance(env, frame);

    result.Set("image", frameObj);
    result.Set("complete", Napi::Boolean::New(env, true));

    return result;
}

void ImageDecoderNative::Reset(const Napi::CallbackInfo& info) {
    if (codecCtx_) {
        avcodec_flush_buffers(codecCtx_);
    }
}

void ImageDecoderNative::Close(const Napi::CallbackInfo& info) {
    closed_ = true;
    if (codecCtx_) {
        avcodec_free_context(&codecCtx_);
        codecCtx_ = nullptr;
    }
    data_.clear();
}

Napi::Value ImageDecoderNative::GetComplete(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), complete_);
}

Napi::Value ImageDecoderNative::GetType(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), type_);
}
