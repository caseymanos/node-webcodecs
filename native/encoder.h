#ifndef ENCODER_H
#define ENCODER_H

#include <napi.h>
#include "hw_accel.h"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/frame.h>
#include <libavutil/opt.h>
#include <libavutil/hwcontext.h>
#include <libswscale/swscale.h>
}

class VideoEncoderNative : public Napi::ObjectWrap<VideoEncoderNative> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    VideoEncoderNative(const Napi::CallbackInfo& info);
    ~VideoEncoderNative();

private:
    static Napi::FunctionReference constructor;

    void Configure(const Napi::CallbackInfo& info);
    void Encode(const Napi::CallbackInfo& info);
    Napi::Value Flush(const Napi::CallbackInfo& info);
    void Reset(const Napi::CallbackInfo& info);
    void Close(const Napi::CallbackInfo& info);

    void EmitChunk(Napi::Env env, AVPacket* packet, bool isKeyframe);
    void EmitError(Napi::Env env, const std::string& message);
    void configureEncoderOptions(const std::string& encoderName, const std::string& latencyMode);

    AVCodecContext* codecCtx_;
    const AVCodec* codec_;
    SwsContext* swsCtx_;

    // Hardware acceleration
    HWAccel::Type hwType_;
    AVBufferRef* hwDeviceCtx_;
    AVBufferRef* hwFramesCtx_;
    AVPixelFormat hwInputFormat_;

    Napi::FunctionReference outputCallback_;
    Napi::FunctionReference errorCallback_;

    bool configured_;
    bool avcAnnexB_;
    int width_;
    int height_;

    // Rate control
    std::string bitrateMode_;
    std::string codecName_;
    int64_t bitrate_;

    // Alpha channel support
    bool alpha_;

    // Scalability mode (SVC)
    std::string scalabilityMode_;
    int temporalLayers_;
};

#endif
