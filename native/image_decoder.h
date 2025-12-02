#ifndef IMAGE_DECODER_H
#define IMAGE_DECODER_H

#include <napi.h>
#include <vector>
#include <string>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libswscale/swscale.h>
}

class ImageDecoderNative : public Napi::ObjectWrap<ImageDecoderNative> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    ImageDecoderNative(const Napi::CallbackInfo& info);
    ~ImageDecoderNative();

    // Static method
    static Napi::Value IsTypeSupported(const Napi::CallbackInfo& info);

private:
    static Napi::FunctionReference constructor;

    // Instance methods
    Napi::Value Decode(const Napi::CallbackInfo& info);
    void Reset(const Napi::CallbackInfo& info);
    void Close(const Napi::CallbackInfo& info);

    // Properties
    Napi::Value GetComplete(const Napi::CallbackInfo& info);
    Napi::Value GetType(const Napi::CallbackInfo& info);

    std::string type_;
    std::vector<uint8_t> data_;
    bool complete_;
    bool closed_;
    AVCodecContext* codecCtx_;
    const AVCodec* codec_;
};

#endif
