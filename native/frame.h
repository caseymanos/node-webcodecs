#ifndef FRAME_H
#define FRAME_H

#include <napi.h>

extern "C" {
#include <libavutil/frame.h>
#include <libavutil/pixfmt.h>
#include <libavutil/imgutils.h>
#include <libswscale/swscale.h>
#include <libavutil/opt.h>
}

// AVFrame.duration arrived in FFmpeg 6 (lavu 58); older releases use pkt_duration
#if LIBAVUTIL_VERSION_INT < AV_VERSION_INT(58, 2, 100)
#define NWC_FRAME_DURATION(f) ((f)->pkt_duration)
#else
#define NWC_FRAME_DURATION(f) ((f)->duration)
#endif

class VideoFrameNative : public Napi::ObjectWrap<VideoFrameNative> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    static Napi::Object NewInstance(Napi::Env env, AVFrame* frame);
    static Napi::FunctionReference constructor;

    VideoFrameNative(const Napi::CallbackInfo& info);
    ~VideoFrameNative();

    AVFrame* GetFrame() const { return frame_; }
    void SetFrame(AVFrame* frame) { frame_ = frame; }

private:

    Napi::Value AllocationSize(const Napi::CallbackInfo& info);
    Napi::Value CopyTo(const Napi::CallbackInfo& info);
    Napi::Value Clone(const Napi::CallbackInfo& info);
    Napi::Value Scale(const Napi::CallbackInfo& info);
    void Close(const Napi::CallbackInfo& info);

    Napi::Value GetWidth(const Napi::CallbackInfo& info);
    Napi::Value GetHeight(const Napi::CallbackInfo& info);
    Napi::Value GetFormat(const Napi::CallbackInfo& info);

    AVFrame* frame_;
    bool closed_;
    bool ownsFrame_;
};

// Helper functions
AVPixelFormat StringToPixelFormat(const std::string& format);
std::string PixelFormatToString(AVPixelFormat format);

// Factory function for creating VideoFrame from JS
Napi::Value CreateVideoFrame(const Napi::CallbackInfo& info);

#endif
