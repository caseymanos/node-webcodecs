#ifndef ASYNC_DECODER_H
#define ASYNC_DECODER_H

#include <napi.h>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <atomic>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/frame.h>
#include <libavutil/imgutils.h>
}

// Job to be processed by worker thread
struct DecodeJob {
    std::vector<uint8_t> data;
    bool isKeyframe;
    int64_t timestamp;
    int64_t duration;
    bool isFlush;
};

// Result from worker thread back to JS
struct DecodeResult {
    AVFrame* frame;  // Ownership transferred to callback
    int64_t timestamp;
    int64_t duration;
    bool isError;
    std::string errorMessage;
    bool isFlushComplete;
};

class VideoDecoderAsync : public Napi::ObjectWrap<VideoDecoderAsync> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    VideoDecoderAsync(const Napi::CallbackInfo& info);
    ~VideoDecoderAsync();

private:
    static Napi::FunctionReference constructor;

    // JavaScript-facing methods
    void Configure(const Napi::CallbackInfo& info);
    void Decode(const Napi::CallbackInfo& info);
    Napi::Value Flush(const Napi::CallbackInfo& info);
    void Reset(const Napi::CallbackInfo& info);
    void Close(const Napi::CallbackInfo& info);

    // Worker thread entry point
    void WorkerThread();

    // Process a single decode job (runs on worker thread)
    void ProcessDecode(DecodeJob& job);
    void ProcessFlush();

    // Thread-safe functions for callbacks to JS
    Napi::ThreadSafeFunction tsfnOutput_;
    Napi::ThreadSafeFunction tsfnError_;
    Napi::ThreadSafeFunction tsfnFlush_;

    // Worker thread
    std::thread workerThread_;
    std::atomic<bool> running_{false};
    std::atomic<bool> configured_{false};

    // Job queue with synchronization
    std::queue<DecodeJob> jobQueue_;
    std::mutex queueMutex_;
    std::condition_variable queueCV_;

    // Flush synchronization
    std::atomic<bool> flushPending_{false};

    // FFmpeg context (owned/accessed by worker thread after configure)
    AVCodecContext* codecCtx_;
    const AVCodec* codec_;
};

#endif // ASYNC_DECODER_H
