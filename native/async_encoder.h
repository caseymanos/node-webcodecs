#ifndef ASYNC_ENCODER_H
#define ASYNC_ENCODER_H

#include <napi.h>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <atomic>
#include "hw_accel.h"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/frame.h>
#include <libavutil/opt.h>
#include <libavutil/hwcontext.h>
#include <libswscale/swscale.h>
}

// Job to be processed by worker thread
struct EncodeJob {
    AVFrame* frame;
    int64_t timestamp;
    bool forceKeyframe;
    bool isFlush;  // True if this is a flush signal
};

// Result from worker thread back to JS
struct EncodeResult {
    std::vector<uint8_t> data;
    bool isKeyframe;
    int64_t pts;
    int64_t duration;
    std::vector<uint8_t> extradata;
    bool hasExtradata;
    bool isError;
    std::string errorMessage;
    bool isFlushComplete;
};

class VideoEncoderAsync : public Napi::ObjectWrap<VideoEncoderAsync> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    VideoEncoderAsync(const Napi::CallbackInfo& info);
    ~VideoEncoderAsync();

private:
    static Napi::FunctionReference constructor;

    // JavaScript-facing methods
    void Configure(const Napi::CallbackInfo& info);
    void Encode(const Napi::CallbackInfo& info);
    Napi::Value Flush(const Napi::CallbackInfo& info);
    void Reset(const Napi::CallbackInfo& info);
    void Close(const Napi::CallbackInfo& info);

    // Worker thread entry point
    void WorkerThread();

    // Process a single encode job (runs on worker thread)
    void ProcessEncode(EncodeJob& job);
    void ProcessFlush();

    // Helper to configure encoder options
    void configureEncoderOptions(const std::string& encoderName, const std::string& latencyMode);

    // Thread-safe functions for callbacks to JS
    Napi::ThreadSafeFunction tsfnOutput_;
    Napi::ThreadSafeFunction tsfnError_;
    Napi::ThreadSafeFunction tsfnFlush_;

    // Worker thread
    std::thread workerThread_;
    std::atomic<bool> running_{false};
    std::atomic<bool> configured_{false};

    // Job queue with synchronization
    std::queue<EncodeJob> jobQueue_;
    std::mutex queueMutex_;
    std::condition_variable queueCV_;

    // Flush synchronization
    std::mutex flushMutex_;
    std::condition_variable flushCV_;
    std::atomic<bool> flushPending_{false};
    Napi::FunctionReference flushCallback_;

    // FFmpeg context (owned/accessed by worker thread after configure)
    AVCodecContext* codecCtx_;
    const AVCodec* codec_;
    SwsContext* swsCtx_;

    // Hardware acceleration
    HWAccel::Type hwType_;
    AVBufferRef* hwDeviceCtx_;
    AVBufferRef* hwFramesCtx_;
    AVPixelFormat hwInputFormat_;

    // Configuration (set on main thread, read on worker)
    bool avcAnnexB_;
    int width_;
    int height_;
    std::string bitrateMode_;
    std::string codecName_;
    int64_t bitrate_;
    bool alpha_;
    std::string scalabilityMode_;
    int temporalLayers_;
    std::string latencyMode_;
};

#endif // ASYNC_ENCODER_H
