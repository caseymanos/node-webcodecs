# Worker Thread Pool & API Coverage Improvements Plan

## Overview

This plan addresses three limitations identified in the node-webcodecs implementation:
1. Synchronous work blocking Node.js event loop
2. Missing exotic WebCodecs features (ReadableStream → ImageDecoder)
3. `isConfigSupported` providing only best-effort checks

## Claim Evaluation

### Claim 1: "Work runs synchronously on the Node thread (no dedicated worker thread pool)"

**Status: TRUE**

**Evidence from code analysis:**

1. `native/encoder.cpp:580` - `avcodec_send_frame()` and `avcodec_receive_packet()` are called synchronously in `Encode()`:
   ```cpp
   int ret = avcodec_send_frame(codecCtx_, frame);
   // ... immediately followed by ...
   while ((ret = avcodec_receive_packet(codecCtx_, packet)) >= 0) {
       EmitChunk(env, packet, isKeyframe);
   }
   ```

2. `native/decoder.cpp:158-187` - Same pattern in `Decode()`:
   ```cpp
   int ret = avcodec_send_packet(codecCtx_, packet);
   // ... immediately followed by ...
   while (ret >= 0) {
       ret = avcodec_receive_frame(codecCtx_, frame);
       EmitFrame(env, outputFrame, timestamp, duration);
   }
   ```

3. `native/image_decoder.cpp:159-176` - Synchronous in `Decode()`:
   ```cpp
   int ret = avcodec_send_packet(codecCtx_, pkt);
   // ... then ...
   ret = avcodec_receive_frame(codecCtx_, frame);
   ```

**Impact:**
- Heavy encoding/decoding operations block the main Node.js thread
- Cannot process other JavaScript while encoding 4K video frames
- Backpressure (`encodeQueueSize`) only tracks pending calls, doesn't prevent blocking
- Compare to browser WebCodecs which uses internal thread pools

### Claim 2: "Not every exotic WebCodecs feature is fully supported"

**Status: TRUE**

**Evidence from code analysis:**

1. **ReadableStream into ImageDecoder - NOT IMPLEMENTED**
   - `src/ImageDecoder.ts:72-75` explicitly throws:
     ```typescript
     } else {
       // ReadableStream
       throw new TypeError('ReadableStream not yet supported');
     }
     ```
   - The W3C spec allows `ReadableStream<BufferSource>` for progressive image loading
   - Only `BufferSource` (ArrayBuffer, TypedArray) is supported

2. **ImageTrackList/ImageTrack - NOT IMPLEMENTED**
   - `src/ImageDecoder.ts` lacks `tracks` property
   - W3C spec provides `decoder.tracks.selectedTrack.frameCount` for animated images
   - The README incorrectly shows `decoder.tracks.selectedTrack.frameCount` in example (line 165) but this isn't implemented

3. **completeFramesOnly option - NOT IMPLEMENTED**
   - `ImageDecodeOptions.completeFramesOnly` is typed but ignored
   - Used for progressive JPEG decoding

4. **preferAnimation option - NOT IMPLEMENTED**
   - `ImageDecoderInit.preferAnimation` is typed but ignored
   - Used to select animated vs static image tracks

5. **VideoFrame GPU textures - NOT IMPLEMENTED**
   - No WebGPU/WebGL texture import/export
   - All frames are CPU-based

6. **AudioData format conversion in copyTo() - LIMITED**
   - Basic copy works but advanced format conversion (e.g., f32 → s16) may be incomplete

### Claim 3: "isConfigSupported is 'best effort' based on codec strings and simple checks"

**Status: TRUE**

**Evidence from code analysis:**

1. `src/VideoEncoder.ts:79-84` - Very basic check:
   ```typescript
   static async isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
     const supported = isVideoCodecSupported(config.codec) &&
                       config.width > 0 &&
                       config.height > 0;
     return { supported, config };
   }
   ```

2. `src/codec-registry.ts:145-168` - String parsing only:
   ```typescript
   export function isVideoCodecSupported(codec: string): boolean {
     if (codec.startsWith('avc1.')) {
       return parseAvcCodecString(codec) !== null;  // Only checks format
     }
     // ...
     return codec in VIDEO_CODECS;
   }
   ```

**What's NOT checked:**
- Whether FFmpeg actually has the encoder compiled in
- Whether hardware acceleration is available
- Maximum supported resolution for the codec
- Maximum supported bitrate
- Profile/level compatibility with the encoder
- Color space/bit depth support
- Alpha channel support for specific codecs

**Browser comparison:** Chrome's `isConfigSupported` actually probes hardware capabilities and can report unsupported configurations that node-webcodecs would falsely report as supported.

---

## Current State Analysis

### Already Implemented (Working Well)
- VideoEncoder/VideoDecoder with FFmpeg
- AudioEncoder/AudioDecoder with FFmpeg
- ImageDecoder for JPEG, PNG, WebP, GIF, BMP, TIFF
- Hardware acceleration (VideoToolbox, NVENC, QSV, VAAPI)
- HDR color spaces (BT.2020, PQ, HLG)
- Alpha channel encoding (VP8/VP9)
- Temporal SVC (L1T1, L1T2, L1T3)
- Backpressure signals (encodeQueueSize, dequeue events)
- bitrateMode (constant, variable, quantizer)
- latencyMode (quality, realtime)

### Missing/Limited
1. Worker thread pool for non-blocking operations
2. ReadableStream support for ImageDecoder
3. ImageTrackList for animated images
4. Comprehensive isConfigSupported checks
5. Progressive image decoding

---

## Desired End State

After implementation:

1. **Worker Thread Pool**: Heavy encode/decode operations run on background threads, not blocking the event loop
2. **ReadableStream ImageDecoder**: Support streaming image data progressively
3. **Robust isConfigSupported**: Actually probe FFmpeg/hardware capabilities

### Verification

- Event loop latency tests show no blocking during encoding
- ReadableStream image decoding works for large images
- isConfigSupported returns false for truly unsupported configurations
- All existing tests continue to pass

---

## What We're NOT Doing

- Full WebGPU/WebGL VideoFrame integration (requires native GPU bindings)
- Spatial SVC (S2T1, etc.) - complex and limited FFmpeg support
- Full animated GIF/WebP track enumeration
- Hardware capability probing for every edge case

---

## Implementation Approach

We'll address the three claims in priority order:

1. **High Priority**: Worker thread pool - has the biggest performance impact
2. **Medium Priority**: ReadableStream ImageDecoder - common use case
3. **Medium Priority**: Better isConfigSupported - improves developer experience

---

## Phase 1: Worker Thread Pool for Non-Blocking Operations

### Overview

Implement N-API AsyncWorker or Napi::AsyncProgressWorker to move heavy FFmpeg operations off the main thread.

### Changes Required:

#### 1.1 Create AsyncEncoder Worker Class

**File**: `native/async_encoder.h` (NEW)

```cpp
#pragma once
#include <napi.h>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <atomic>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/frame.h>
#include <libswscale/swscale.h>
}

struct EncodeJob {
    AVFrame* frame;
    int64_t timestamp;
    bool forceKeyframe;
};

struct EncodeResult {
    std::vector<uint8_t> data;
    bool isKeyframe;
    int64_t pts;
    int64_t duration;
    std::vector<uint8_t> extradata;
    std::string error;
};

class VideoEncoderAsync : public Napi::ObjectWrap<VideoEncoderAsync> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    VideoEncoderAsync(const Napi::CallbackInfo& info);
    ~VideoEncoderAsync();

private:
    void Configure(const Napi::CallbackInfo& info);
    void Encode(const Napi::CallbackInfo& info);
    Napi::Value Flush(const Napi::CallbackInfo& info);
    void Reset(const Napi::CallbackInfo& info);
    void Close(const Napi::CallbackInfo& info);

    // Worker thread function
    void WorkerThread();
    void ProcessEncode(EncodeJob& job);

    // Thread-safe callbacks
    Napi::ThreadSafeFunction tsfnOutput_;
    Napi::ThreadSafeFunction tsfnError_;

    // Worker thread
    std::thread workerThread_;
    std::atomic<bool> running_{false};

    // Job queue
    std::queue<EncodeJob> jobQueue_;
    std::mutex queueMutex_;
    std::condition_variable queueCV_;

    // FFmpeg context (owned by worker thread)
    AVCodecContext* codecCtx_;
    const AVCodec* codec_;
    SwsContext* swsCtx_;
    // ... other members
};
```

**File**: `native/async_encoder.cpp` (NEW)

```cpp
#include "async_encoder.h"

void VideoEncoderAsync::WorkerThread() {
    while (running_) {
        EncodeJob job;

        {
            std::unique_lock<std::mutex> lock(queueMutex_);
            queueCV_.wait(lock, [this] {
                return !jobQueue_.empty() || !running_;
            });

            if (!running_ && jobQueue_.empty()) break;

            job = std::move(jobQueue_.front());
            jobQueue_.pop();
        }

        ProcessEncode(job);
    }
}

void VideoEncoderAsync::ProcessEncode(EncodeJob& job) {
    // FFmpeg encoding happens here, on background thread
    int ret = avcodec_send_frame(codecCtx_, job.frame);

    if (ret < 0) {
        EncodeResult result;
        result.error = "Encode error";
        // Use ThreadSafeFunction to call back to JS
        tsfnError_.BlockingCall(&result, [](Napi::Env env, Napi::Function fn, EncodeResult* result) {
            fn.Call({Napi::String::New(env, result->error)});
        });
        return;
    }

    AVPacket* packet = av_packet_alloc();
    while ((ret = avcodec_receive_packet(codecCtx_, packet)) >= 0) {
        EncodeResult result;
        result.data.assign(packet->data, packet->data + packet->size);
        result.isKeyframe = (packet->flags & AV_PKT_FLAG_KEY) != 0;
        result.pts = packet->pts;
        result.duration = packet->duration;

        // Thread-safe callback to JS
        tsfnOutput_.BlockingCall(&result, [](Napi::Env env, Napi::Function fn, EncodeResult* result) {
            Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(
                env, result->data.data(), result->data.size());
            fn.Call({
                buffer,
                Napi::Boolean::New(env, result->isKeyframe),
                Napi::Number::New(env, result->pts),
                Napi::Number::New(env, result->duration)
            });
        });

        av_packet_unref(packet);
    }
    av_packet_free(&packet);

    av_frame_free(&job.frame);
}

void VideoEncoderAsync::Encode(const Napi::CallbackInfo& info) {
    // Quick validation on main thread
    VideoFrameNative* frameWrapper = Napi::ObjectWrap<VideoFrameNative>::Unwrap(
        info[0].As<Napi::Object>());

    // Clone frame for background processing
    AVFrame* frameCopy = av_frame_clone(frameWrapper->GetFrame());

    EncodeJob job{
        frameCopy,
        info[1].As<Napi::Number>().Int64Value(),
        info[2].As<Napi::Boolean>().Value()
    };

    {
        std::lock_guard<std::mutex> lock(queueMutex_);
        jobQueue_.push(std::move(job));
    }
    queueCV_.notify_one();
}
```

#### 1.2 Update TypeScript to Use Async Encoder

**File**: `src/VideoEncoder.ts`
**Changes**: Add option to use async encoder

```typescript
export interface VideoEncoderConfig {
  // ... existing options ...
  useWorkerThread?: boolean;  // New option, default true
}

export class VideoEncoder {
  constructor(init: VideoEncoderInit) {
    // ...
    if (native.VideoEncoderAsync) {
      // Prefer async encoder when available
      this._native = new native.VideoEncoderAsync(
        this._onChunk.bind(this),
        this._onError.bind(this)
      );
      this._isAsync = true;
    } else {
      // Fallback to sync encoder
      this._native = new native.VideoEncoderNative(
        this._onChunk.bind(this),
        this._onError.bind(this)
      );
      this._isAsync = false;
    }
  }
}
```

#### 1.3 Same Pattern for VideoDecoder

**File**: `native/async_decoder.h` (NEW)
**File**: `native/async_decoder.cpp` (NEW)

Similar structure with decode job queue and worker thread.

### Success Criteria:

#### Automated Verification:
- [ ] Build succeeds: `npm run build`
- [ ] All existing unit tests pass: `npm test`
- [ ] New async encoder tests pass
- [ ] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [ ] Event loop latency test: encode 100 4K frames while running setTimeout(cb, 1) - callbacks should fire within 5ms
- [ ] Throughput comparison: async should match or exceed sync performance
- [ ] Memory stability: no leaks during long encoding sessions

**Implementation Note**: After completing this phase, pause for manual testing to verify event loop behavior before proceeding.

---

## Phase 2: ReadableStream Support for ImageDecoder

### Overview

Add support for initializing ImageDecoder with a ReadableStream, enabling progressive loading of large images.

### Changes Required:

#### 2.1 TypeScript Streaming Handler

**File**: `src/ImageDecoder.ts`
**Changes**: Handle ReadableStream input

```typescript
export class ImageDecoder {
  private _streamReader?: ReadableStreamDefaultReader<BufferSource>;
  private _accumulatedData: Uint8Array[] = [];

  constructor(init: ImageDecoderInit) {
    if (!init.data) {
      throw new TypeError('data is required');
    }
    if (!init.type) {
      throw new TypeError('type is required');
    }

    this._type = init.type;
    this._completedPromise = new Promise((resolve, reject) => {
      this._completedResolve = resolve;
      this._completedReject = reject;
    });

    // Handle ReadableStream
    if (isReadableStream(init.data)) {
      this._handleReadableStream(init.data as ReadableStream<BufferSource>);
      return;
    }

    // Handle BufferSource (existing code)
    let dataBuffer: Buffer;
    if (init.data instanceof ArrayBuffer) {
      dataBuffer = Buffer.from(init.data);
    } else if (ArrayBuffer.isView(init.data)) {
      dataBuffer = Buffer.from(
        init.data.buffer,
        init.data.byteOffset,
        init.data.byteLength
      );
    } else {
      throw new TypeError('Invalid data type');
    }

    this._initNative(dataBuffer);
  }

  private async _handleReadableStream(stream: ReadableStream<BufferSource>): Promise<void> {
    this._streamReader = stream.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { done, value } = await this._streamReader.read();

        if (done) break;

        // Convert BufferSource to Uint8Array
        const chunk = value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

        chunks.push(chunk);
      }

      // Concatenate all chunks
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const fullData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        fullData.set(chunk, offset);
        offset += chunk.length;
      }

      this._initNative(Buffer.from(fullData));
      this._complete = true;
      this._completedResolve();
    } catch (error) {
      this._completedReject(error);
    }
  }

  private _initNative(dataBuffer: Buffer): void {
    if (!native || !native.ImageDecoderNative) {
      throw new DOMException('Native addon not available', 'NotSupportedError');
    }

    try {
      this._native = new native.ImageDecoderNative({
        data: dataBuffer,
        type: this._type,
      });
    } catch (e: any) {
      throw new DOMException(
        e.message || 'Failed to create ImageDecoder',
        'NotSupportedError'
      );
    }

    this._complete = this._native.complete;
    if (this._complete) {
      this._completedResolve();
    }
  }
}

function isReadableStream(value: unknown): value is ReadableStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).getReader === 'function'
  );
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Build succeeds: `npm run build`
- [ ] New ReadableStream tests pass
- [ ] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [ ] Decode large JPEG via ReadableStream from file
- [ ] Verify `completed` promise resolves after stream ends
- [ ] Memory usage is reasonable for streaming large images

---

## Phase 3: Improved isConfigSupported

### Overview

Make `isConfigSupported` actually probe FFmpeg and hardware capabilities rather than just parsing codec strings.

### Changes Required:

#### 3.1 Native Capability Probing

**File**: `native/capability_probe.h` (NEW)

```cpp
#pragma once
#include <napi.h>
#include <string>

struct VideoCapabilityResult {
    bool supported;
    bool hardwareAccelerated;
    int maxWidth;
    int maxHeight;
    std::string error;
};

class CapabilityProbe {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);

    // Check if a video config is actually supported
    static Napi::Value ProbeVideoEncoder(const Napi::CallbackInfo& info);
    static Napi::Value ProbeVideoDecoder(const Napi::CallbackInfo& info);
    static Napi::Value ProbeAudioEncoder(const Napi::CallbackInfo& info);
    static Napi::Value ProbeAudioDecoder(const Napi::CallbackInfo& info);

private:
    static VideoCapabilityResult probeEncoder(
        const std::string& codecName,
        int width,
        int height,
        const std::string& hwPref
    );
};
```

**File**: `native/capability_probe.cpp` (NEW)

```cpp
#include "capability_probe.h"
#include "hw_accel.h"

extern "C" {
#include <libavcodec/avcodec.h>
}

VideoCapabilityResult CapabilityProbe::probeEncoder(
    const std::string& codecName,
    int width,
    int height,
    const std::string& hwPref
) {
    VideoCapabilityResult result{false, false, 0, 0, ""};

    // Try to find the encoder
    HWAccel::Preference pref = HWAccel::parsePreference(hwPref);
    HWAccel::EncoderInfo encInfo = HWAccel::selectEncoder(codecName, pref, width, height);

    if (!encInfo.codec) {
        result.error = "No encoder found for codec";
        return result;
    }

    // Try to actually open the codec with the given parameters
    AVCodecContext* ctx = avcodec_alloc_context3(encInfo.codec);
    if (!ctx) {
        result.error = "Failed to allocate context";
        return result;
    }

    ctx->width = width;
    ctx->height = height;
    ctx->time_base = {1, 1000000};
    ctx->pix_fmt = encInfo.inputFormat;
    ctx->bit_rate = 2000000;

    // Setup HW device if needed
    AVBufferRef* hwDeviceCtx = nullptr;
    if (encInfo.hwType != HWAccel::Type::None) {
        hwDeviceCtx = HWAccel::createHWDeviceContext(encInfo.hwType);
        if (hwDeviceCtx) {
            ctx->hw_device_ctx = av_buffer_ref(hwDeviceCtx);
            result.hardwareAccelerated = true;
        }
    }

    // Try to open
    int ret = avcodec_open2(ctx, encInfo.codec, nullptr);

    if (ret >= 0) {
        result.supported = true;
        result.maxWidth = ctx->width;  // Could query actual limits
        result.maxHeight = ctx->height;
        avcodec_close(ctx);
    } else {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        result.error = errBuf;
    }

    if (hwDeviceCtx) {
        av_buffer_unref(&hwDeviceCtx);
    }
    avcodec_free_context(&ctx);

    return result;
}

Napi::Value CapabilityProbe::ProbeVideoEncoder(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "Config required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object config = info[0].As<Napi::Object>();
    std::string codec = config.Get("codec").As<Napi::String>().Utf8Value();
    int width = config.Get("width").As<Napi::Number>().Int32Value();
    int height = config.Get("height").As<Napi::Number>().Int32Value();

    std::string hwPref = "no-preference";
    if (config.Has("hardwareAcceleration")) {
        hwPref = config.Get("hardwareAcceleration").As<Napi::String>().Utf8Value();
    }

    auto result = probeEncoder(codec, width, height, hwPref);

    Napi::Object ret = Napi::Object::New(env);
    ret.Set("supported", Napi::Boolean::New(env, result.supported));
    ret.Set("hardwareAccelerated", Napi::Boolean::New(env, result.hardwareAccelerated));

    if (!result.error.empty()) {
        ret.Set("error", Napi::String::New(env, result.error));
    }

    return ret;
}
```

#### 3.2 Update TypeScript isConfigSupported

**File**: `src/VideoEncoder.ts`
**Changes**: Use native probing

```typescript
static async isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
  // Basic validation first
  if (!config.codec || config.width <= 0 || config.height <= 0) {
    return { supported: false, config };
  }

  // Check codec string format
  if (!isVideoCodecSupported(config.codec)) {
    return { supported: false, config };
  }

  // If native probing is available, use it
  if (native?.CapabilityProbe?.probeVideoEncoder) {
    try {
      const result = native.CapabilityProbe.probeVideoEncoder({
        codec: getFFmpegVideoCodec(config.codec),
        width: config.width,
        height: config.height,
        hardwareAcceleration: config.hardwareAcceleration || 'no-preference',
      });

      return {
        supported: result.supported,
        config,
        // Extended info (non-standard but useful)
        hardwareAccelerated: result.hardwareAccelerated,
      };
    } catch (e) {
      // Fall back to basic check on error
    }
  }

  // Fallback to basic string check
  return { supported: true, config };
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Build succeeds: `npm run build`
- [ ] isConfigSupported returns false for invalid resolutions
- [ ] isConfigSupported returns false when codec isn't compiled into FFmpeg
- [ ] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [ ] isConfigSupported correctly reports hardware acceleration availability
- [ ] isConfigSupported returns false for 32K resolution (likely unsupported)
- [ ] Performance impact is minimal (< 50ms for probe)

---

## Testing Strategy

### Unit Tests

1. **Worker Thread**: `test/async-encoder.test.ts`
   - Verify encode completes without blocking event loop
   - Measure callback latency during encoding

2. **ReadableStream**: `test/readable-stream-image.test.ts`
   - Test streaming JPEG, PNG, WebP
   - Test completed promise behavior

3. **isConfigSupported**: `test/config-supported.test.ts`
   - Test various valid/invalid configurations
   - Test hardware acceleration reporting

### Integration Tests

1. **Event Loop Test**: `test/integration/event-loop.test.js`
   ```javascript
   // Encode 100 frames while checking event loop latency
   const delays = [];
   const interval = setInterval(() => {
     const start = process.hrtime.bigint();
     setImmediate(() => {
       delays.push(Number(process.hrtime.bigint() - start) / 1e6);
     });
   }, 1);

   await encodeAllFrames();
   clearInterval(interval);

   const maxDelay = Math.max(...delays);
   expect(maxDelay).toBeLessThan(10); // Should be < 10ms
   ```

2. **Stream Pipeline**: `test/integration/stream-pipeline.test.js`
   - Create ReadableStream from large file
   - Decode with ImageDecoder
   - Verify output

### Manual Testing

- Load test with 4K 60fps encoding for 1 minute
- Verify UI responsiveness if used in Electron app
- Test on various hardware (with/without GPU)

---

## Performance Considerations

1. **Worker Thread Overhead**: Thread synchronization adds ~1-5μs per frame
2. **Memory**: Frame cloning for async requires extra memory (~frame_size * queue_depth)
3. **ReadableStream**: Buffering entire stream before decode uses memory = file size
4. **isConfigSupported Probing**: Opening codec takes ~10-50ms per probe

---

## Migration Notes

These are additive features with opt-out:
- Worker thread is default, `useWorkerThread: false` for sync
- ReadableStream works alongside BufferSource
- isConfigSupported probing falls back gracefully

No breaking changes to existing API.

---

## References

- W3C WebCodecs Spec: https://www.w3.org/TR/webcodecs/
- N-API AsyncWorker: https://github.com/nodejs/node-addon-api/blob/main/doc/async_worker.md
- N-API ThreadSafeFunction: https://github.com/nodejs/node-addon-api/blob/main/doc/threadsafe_function.md
- FFmpeg Threading: https://ffmpeg.org/ffmpeg-codecs.html#Codec-Options
