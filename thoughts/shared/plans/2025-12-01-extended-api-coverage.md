# Extended WebCodecs API Coverage Implementation Plan

## Overview

This plan extends node-webcodecs to achieve fuller W3C WebCodecs API compliance by implementing missing features organized by priority. The implementation builds on the existing FFmpeg-based native layer while adding new classes and capabilities.

## Current State Analysis

### Already Implemented
- VideoEncoder/VideoDecoder with hardware acceleration
- AudioEncoder/AudioDecoder
- VideoFrame with basic pixel formats (I420, NV12, RGBA, BGRA, etc.)
- AudioData with planar/interleaved formats
- EncodedVideoChunk/EncodedAudioChunk
- hardwareAcceleration preference
- Backpressure support (encodeQueueSize, decodeQueueSize, dequeue events)

### Missing Features (by priority)
| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| High | ImageDecoder | Medium | Image → VideoFrame pipeline |
| High | latencyMode | Low | Realtime streaming use cases |
| Medium | bitrateMode options | Low | Better quality control |
| Medium | Full colorSpace | Medium | HDR, wide gamut support |
| Medium | copyTo() full impl | Medium | Zero-copy frame access |
| Low | Scalability modes | High | SVC for adaptive streaming |
| Low | Alpha channel | Medium | Transparency in video |

### Key Discoveries
- `bitrateMode` is declared in TypeScript but NOT passed to native encoder (`VideoEncoder.ts:196` sets it but `encoder.cpp` ignores it)
- `latencyMode` is partially implemented - passed to native but only affects encoder presets, not all optimizations
- `colorSpace` is declared in VideoDecoderConfig but NOT used
- `scalabilityMode` is declared but completely unimplemented
- `alpha` option exists but encoding path doesn't handle it

## Desired End State

After implementation:
1. **ImageDecoder** - Decode JPEG, PNG, WebP, GIF images to VideoFrame
2. **latencyMode** - Full realtime optimization including threading and buffer config
3. **bitrateMode** - CBR, VBR, and quantizer modes properly configure encoders
4. **colorSpace** - HDR support with BT.2020, PQ/HLG transfers
5. **copyTo()** - Format conversion, rect cropping, colorSpace conversion
6. **scalabilityMode** - Temporal layer encoding for VP9/AV1
7. **alpha** - Alpha channel preservation in encoding

### Verification
- All existing 80+ unit tests continue to pass
- New tests cover each feature
- Integration tests for ImageDecoder → VideoEncoder pipeline
- Benchmark comparisons for latencyMode

## What We're NOT Doing

- Full SVC spatial scalability (highly complex, limited FFmpeg support)
- Simulcast modes (S2T1, etc.) - different encoding paradigm
- ImageTrackList/ImageTrack (animated image tracks)
- Progressive image decode (completeFramesOnly option)
- GPU-backed VideoFrame (WebGPU integration)
- Custom GOP structures beyond basic keyframe intervals

---

## Phase 1: High Priority - latencyMode Full Implementation

### Overview
Complete the latencyMode implementation to properly configure encoders for realtime streaming with all optimizations.

### Changes Required:

#### 1.1 Native Encoder Enhancements

**File**: `native/encoder.cpp`
**Changes**: Expand `configureEncoderOptions()` with full realtime configuration

```cpp
// After line 113, add thread and buffer configuration
void VideoEncoderNative::configureEncoderOptions(AVCodecContext* ctx,
                                                   const std::string& codecName,
                                                   const std::string& latencyMode) {
    bool isRealtime = (latencyMode == "realtime");

    // Thread configuration for realtime
    if (isRealtime) {
        ctx->thread_count = 1;  // Single thread for lowest latency
        ctx->thread_type = 0;   // Disable threading
        ctx->delay = 0;         // No delay
    }

    // Existing codec-specific options...
    if (codecName.find("libx264") != std::string::npos) {
        av_opt_set(ctx->priv_data, "preset", isRealtime ? "ultrafast" : "medium", 0);
        if (isRealtime) {
            av_opt_set(ctx->priv_data, "tune", "zerolatency", 0);
            av_opt_set(ctx->priv_data, "rc-lookahead", "0", 0);
            av_opt_set(ctx->priv_data, "sync-lookahead", "0", 0);
        }
    }
    // ... (continue with other codecs, adding lookahead disabling)
}
```

**File**: `native/encoder.cpp` line ~175
**Changes**: Set `max_b_frames = 0` for realtime mode regardless of codec

```cpp
// Replace line 188
if (latencyMode_ == "realtime") {
    ctx->max_b_frames = 0;
    ctx->refs = 1;  // Single reference frame
}
```

#### 1.2 TypeScript Updates

**File**: `src/VideoEncoder.ts`
**Changes**: Add validation and documentation for latencyMode

```typescript
// Add validation in configure() around line 175
if (config.latencyMode && !['quality', 'realtime'].includes(config.latencyMode)) {
    throw new DOMException(
        `Invalid latencyMode: ${config.latencyMode}. Must be 'quality' or 'realtime'.`,
        'TypeError'
    );
}
```

### Success Criteria:

#### Automated Verification:
- [x] Build succeeds: `npm run build`
- [x] All unit tests pass: `npm test`
- [x] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [ ] Benchmark realtime vs quality mode - realtime should have lower latency
- [ ] Verify encoder logs show correct presets for each mode

---

## Phase 2: High Priority - bitrateMode Implementation

### Overview
Wire bitrateMode through to native encoder to support constant, variable, and quantizer modes.

### Changes Required:

#### 2.1 Native Encoder Rate Control

**File**: `native/encoder.cpp`
**Changes**: Add bitrateMode handling in Configure()

```cpp
// After bitrate setting (~line 177), add:
std::string bitrateMode = "variable";  // default
if (config.Has("bitrateMode")) {
    bitrateMode = config.Get("bitrateMode").As<Napi::String>().Utf8Value();
}
bitrateMode_ = bitrateMode;

// Configure rate control based on mode
if (bitrateMode == "constant") {
    // CBR - set min/max to same as target
    codecCtx_->rc_min_rate = bitrate_;
    codecCtx_->rc_max_rate = bitrate_;
    codecCtx_->rc_buffer_size = bitrate_; // 1 second buffer

    // Codec-specific CBR settings
    if (codecName.find("libx264") != std::string::npos) {
        av_opt_set(codecCtx_->priv_data, "nal-hrd", "cbr", 0);
    }
} else if (bitrateMode == "quantizer") {
    // CQP mode - disable bitrate targeting
    codecCtx_->bit_rate = 0;
    codecCtx_->rc_max_rate = 0;
    // Quantizer will be set per-frame in encode()
} else {
    // VBR (default) - just set target bitrate
    codecCtx_->bit_rate = bitrate_;
}
```

**File**: `native/encoder.h`
**Changes**: Add bitrateMode member

```cpp
// Add after line ~34
std::string bitrateMode_;
```

#### 2.2 Quantizer Mode Encode Support

**File**: `native/encoder.cpp` in Encode()
**Changes**: Support per-frame quantizer

```cpp
// In Encode(), after getting timestamp (~line 324), add:
if (bitrateMode_ == "quantizer") {
    int quantizer = 30; // default
    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object options = info[1].As<Napi::Object>();
        // Check for codec-specific quantizer
        if (options.Has("vp9") && options.Get("vp9").IsObject()) {
            auto vp9Opts = options.Get("vp9").As<Napi::Object>();
            if (vp9Opts.Has("quantizer")) {
                quantizer = vp9Opts.Get("quantizer").As<Napi::Number>().Int32Value();
            }
        }
        // Similar for avc, hevc, av1...
    }
    // Apply quantizer
    if (codecName_.find("libx264") != std::string::npos ||
        codecName_.find("hevc") != std::string::npos) {
        frame->quality = quantizer;
    } else if (codecName_.find("vp") != std::string::npos ||
               codecName_.find("av1") != std::string::npos) {
        // VP8/9/AV1 use different quantizer scale
        av_dict_set(&frame->metadata, "qp", std::to_string(quantizer).c_str(), 0);
    }
}
```

#### 2.3 TypeScript Types

**File**: `src/types.ts`
**Changes**: Ensure BitrateMode type is exported

```typescript
export type BitrateMode = 'constant' | 'variable' | 'quantizer';
```

### Success Criteria:

#### Automated Verification:
- [x] Build succeeds: `npm run build`
- [x] New unit tests for each bitrateMode pass
- [x] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [ ] CBR output file shows consistent bitrate in analysis
- [ ] VBR shows varying bitrate per scene complexity
- [ ] Quantizer mode ignores bitrate setting

---

## Phase 3: High Priority - ImageDecoder Implementation

### Overview
Add ImageDecoder class for decoding still images (JPEG, PNG, WebP, GIF) to VideoFrame.

### Changes Required:

#### 3.1 Native ImageDecoder

**File**: `native/image_decoder.h` (NEW)

```cpp
#pragma once
#include <napi.h>
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
```

**File**: `native/image_decoder.cpp` (NEW)

```cpp
#include "image_decoder.h"
#include "frame.h"
#include <map>

static const std::map<std::string, AVCodecID> mimeToCodec = {
    {"image/jpeg", AV_CODEC_ID_MJPEG},
    {"image/png", AV_CODEC_ID_PNG},
    {"image/webp", AV_CODEC_ID_WEBP},
    {"image/gif", AV_CODEC_ID_GIF},
    {"image/avif", AV_CODEC_ID_AV1},
    {"image/bmp", AV_CODEC_ID_BMP},
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
    return Napi::Boolean::New(env, mimeToCodec.find(type) != mimeToCodec.end());
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

    // Initialize codec context
    if (!codecCtx_) {
        codecCtx_ = avcodec_alloc_context3(codec_);
        if (avcodec_open2(codecCtx_, codec_, nullptr) < 0) {
            Napi::Error::New(env, "Failed to open image decoder").ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    // Create packet
    AVPacket* pkt = av_packet_alloc();
    pkt->data = data_.data();
    pkt->size = static_cast<int>(data_.size());

    // Send packet
    int ret = avcodec_send_packet(codecCtx_, pkt);
    av_packet_free(&pkt);

    if (ret < 0) {
        Napi::Error::New(env, "Failed to decode image").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Receive frame
    AVFrame* frame = av_frame_alloc();
    ret = avcodec_receive_frame(codecCtx_, frame);

    if (ret < 0) {
        av_frame_free(&frame);
        Napi::Error::New(env, "Failed to receive decoded frame").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Create VideoFrameNative
    Napi::Object result = Napi::Object::New(env);

    // Wrap frame in VideoFrameNative
    auto frameObj = VideoFrameNative::NewInstance(env, frame);
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
```

#### 3.2 TypeScript ImageDecoder Class

**File**: `src/ImageDecoder.ts` (NEW)

```typescript
import bindings from 'bindings';
import { VideoFrame } from './VideoFrame';

const native = bindings('webcodecs');

export interface ImageDecodeResult {
    image: VideoFrame;
    complete: boolean;
}

export interface ImageDecodeOptions {
    frameIndex?: number;
    completeFramesOnly?: boolean;
}

export interface ImageDecoderInit {
    data: BufferSource | ReadableStream<BufferSource>;
    type: string;
    colorSpaceConversion?: 'default' | 'none';
    desiredWidth?: number;
    desiredHeight?: number;
    preferAnimation?: boolean;
}

export class ImageDecoder {
    private _native: any;
    private _type: string;
    private _complete: boolean;
    private _closed: boolean = false;
    private _completedPromise: Promise<void>;
    private _completedResolve!: () => void;

    static isTypeSupported(type: string): Promise<boolean> {
        return Promise.resolve(native.ImageDecoderNative.isTypeSupported(type));
    }

    constructor(init: ImageDecoderInit) {
        if (!init.data) {
            throw new TypeError('data is required');
        }
        if (!init.type) {
            throw new TypeError('type is required');
        }

        // Handle BufferSource
        let dataBuffer: Buffer;
        if (init.data instanceof ArrayBuffer) {
            dataBuffer = Buffer.from(init.data);
        } else if (ArrayBuffer.isView(init.data)) {
            dataBuffer = Buffer.from(init.data.buffer, init.data.byteOffset, init.data.byteLength);
        } else {
            throw new TypeError('ReadableStream not yet supported');
        }

        this._type = init.type;
        this._completedPromise = new Promise((resolve) => {
            this._completedResolve = resolve;
        });

        this._native = new native.ImageDecoderNative({
            data: dataBuffer,
            type: init.type,
        });

        this._complete = this._native.complete;
        if (this._complete) {
            this._completedResolve();
        }
    }

    get complete(): boolean {
        return this._complete;
    }

    get completed(): Promise<void> {
        return this._completedPromise;
    }

    get type(): string {
        return this._type;
    }

    async decode(options?: ImageDecodeOptions): Promise<ImageDecodeResult> {
        if (this._closed) {
            throw new DOMException('ImageDecoder is closed', 'InvalidStateError');
        }

        const result = this._native.decode(options?.frameIndex ?? 0);

        // Wrap native frame in VideoFrame
        const videoFrame = new VideoFrame(result.image);

        return {
            image: videoFrame,
            complete: result.complete,
        };
    }

    reset(): void {
        if (!this._closed) {
            this._native.reset();
        }
    }

    close(): void {
        if (!this._closed) {
            this._closed = true;
            this._native.close();
        }
    }
}
```

#### 3.3 Update Exports and Build

**File**: `src/index.ts`
**Changes**: Export ImageDecoder

```typescript
export { ImageDecoder } from './ImageDecoder';
export type { ImageDecoderInit, ImageDecodeResult, ImageDecodeOptions } from './ImageDecoder';
```

**File**: `binding.gyp`
**Changes**: Add image_decoder.cpp

```json
"sources": [
    "native/binding.cpp",
    "native/encoder.cpp",
    "native/decoder.cpp",
    "native/audio.cpp",
    "native/frame.cpp",
    "native/hw_accel.cpp",
    "native/image_decoder.cpp"
],
```

**File**: `native/binding.cpp`
**Changes**: Initialize ImageDecoderNative

```cpp
#include "image_decoder.h"

// In Init():
ImageDecoderNative::Init(env, exports);
```

### Success Criteria:

#### Automated Verification:
- [x] Build succeeds: `npm run build`
- [x] ImageDecoder.isTypeSupported('image/jpeg') returns true
- [x] ImageDecoder.isTypeSupported('image/png') returns true
- [x] New ImageDecoder unit tests pass
- [x] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [ ] Decode JPEG → VideoFrame → encode to H.264 pipeline works
- [ ] PNG with transparency preserves alpha channel (format: RGBA)
- [ ] WebP static images decode correctly

---

## Phase 4: Medium Priority - colorSpace Full Implementation

### Overview
Implement full color space support including HDR (BT.2020, PQ, HLG transfers).

### Changes Required:

#### 4.1 Native Color Space Structures

**File**: `native/color.h` (NEW)

```cpp
#pragma once
#include <string>
extern "C" {
#include <libavutil/pixfmt.h>
}

namespace ColorSpace {
    // Map WebCodecs primaries to FFmpeg
    AVColorPrimaries parsePrimaries(const std::string& primaries);
    // Map WebCodecs transfer to FFmpeg
    AVColorTransferCharacteristic parseTransfer(const std::string& transfer);
    // Map WebCodecs matrix to FFmpeg
    AVColorSpace parseMatrix(const std::string& matrix);
    // Map FFmpeg to WebCodecs strings (reverse)
    std::string primariesToString(AVColorPrimaries primaries);
    std::string transferToString(AVColorTransferCharacteristic transfer);
    std::string matrixToString(AVColorSpace matrix);
}
```

**File**: `native/color.cpp` (NEW)

```cpp
#include "color.h"
#include <map>

namespace ColorSpace {

AVColorPrimaries parsePrimaries(const std::string& primaries) {
    static const std::map<std::string, AVColorPrimaries> mapping = {
        {"bt709", AVCOL_PRI_BT709},
        {"bt470bg", AVCOL_PRI_BT470BG},
        {"smpte170m", AVCOL_PRI_SMPTE170M},
        {"bt2020", AVCOL_PRI_BT2020},
        {"smpte432", AVCOL_PRI_SMPTE432},  // Display P3
    };
    auto it = mapping.find(primaries);
    return it != mapping.end() ? it->second : AVCOL_PRI_UNSPECIFIED;
}

AVColorTransferCharacteristic parseTransfer(const std::string& transfer) {
    static const std::map<std::string, AVColorTransferCharacteristic> mapping = {
        {"bt709", AVCOL_TRC_BT709},
        {"smpte170m", AVCOL_TRC_SMPTE170M},
        {"iec61966-2-1", AVCOL_TRC_IEC61966_2_1},  // sRGB
        {"linear", AVCOL_TRC_LINEAR},
        {"pq", AVCOL_TRC_SMPTE2084},      // HDR PQ
        {"hlg", AVCOL_TRC_ARIB_STD_B67},  // HDR HLG
    };
    auto it = mapping.find(transfer);
    return it != mapping.end() ? it->second : AVCOL_TRC_UNSPECIFIED;
}

AVColorSpace parseMatrix(const std::string& matrix) {
    static const std::map<std::string, AVColorSpace> mapping = {
        {"rgb", AVCOL_SPC_RGB},
        {"bt709", AVCOL_SPC_BT709},
        {"bt470bg", AVCOL_SPC_BT470BG},
        {"smpte170m", AVCOL_SPC_SMPTE170M},
        {"bt2020-ncl", AVCOL_SPC_BT2020_NCL},
    };
    auto it = mapping.find(matrix);
    return it != mapping.end() ? it->second : AVCOL_SPC_UNSPECIFIED;
}

std::string primariesToString(AVColorPrimaries primaries) {
    switch (primaries) {
        case AVCOL_PRI_BT709: return "bt709";
        case AVCOL_PRI_BT470BG: return "bt470bg";
        case AVCOL_PRI_SMPTE170M: return "smpte170m";
        case AVCOL_PRI_BT2020: return "bt2020";
        case AVCOL_PRI_SMPTE432: return "smpte432";
        default: return "";
    }
}

std::string transferToString(AVColorTransferCharacteristic transfer) {
    switch (transfer) {
        case AVCOL_TRC_BT709: return "bt709";
        case AVCOL_TRC_SMPTE170M: return "smpte170m";
        case AVCOL_TRC_IEC61966_2_1: return "iec61966-2-1";
        case AVCOL_TRC_LINEAR: return "linear";
        case AVCOL_TRC_SMPTE2084: return "pq";
        case AVCOL_TRC_ARIB_STD_B67: return "hlg";
        default: return "";
    }
}

std::string matrixToString(AVColorSpace matrix) {
    switch (matrix) {
        case AVCOL_SPC_RGB: return "rgb";
        case AVCOL_SPC_BT709: return "bt709";
        case AVCOL_SPC_BT470BG: return "bt470bg";
        case AVCOL_SPC_SMPTE170M: return "smpte170m";
        case AVCOL_SPC_BT2020_NCL: return "bt2020-ncl";
        default: return "";
    }
}

} // namespace ColorSpace
```

#### 4.2 Update Encoder for Color Space

**File**: `native/encoder.cpp`
**Changes**: Apply color space to codec context

```cpp
#include "color.h"

// In Configure(), after dimension/bitrate setup (~line 195):
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
```

#### 4.3 Update Decoder to Report Color Space

**File**: `native/decoder.cpp`
**Changes**: Include color space in emitted frames

```cpp
#include "color.h"

// In EmitFrame(), add color space info to callback:
Napi::Object colorSpace = Napi::Object::New(env);
colorSpace.Set("primaries", Napi::String::New(env,
    ColorSpace::primariesToString(frame->color_primaries)));
colorSpace.Set("transfer", Napi::String::New(env,
    ColorSpace::transferToString(frame->color_trc)));
colorSpace.Set("matrix", Napi::String::New(env,
    ColorSpace::matrixToString(frame->colorspace)));
colorSpace.Set("fullRange", Napi::Boolean::New(env,
    frame->color_range == AVCOL_RANGE_JPEG));

// Pass to callback
callback.Call({frameObj, timestamp, duration, colorSpace});
```

#### 4.4 TypeScript VideoColorSpace Updates

**File**: `src/VideoColorSpace.ts`
**Changes**: Add HDR-related values to types

```typescript
export type VideoColorPrimaries =
    | 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020' | 'smpte432';

export type VideoTransferCharacteristics =
    | 'bt709' | 'smpte170m' | 'iec61966-2-1' | 'linear' | 'pq' | 'hlg';

export type VideoMatrixCoefficients =
    | 'rgb' | 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020-ncl';
```

### Success Criteria:

#### Automated Verification:
- [x] Build succeeds: `npm run build`
- [x] Color space round-trip test passes (encode with bt2020/pq, decode, verify)
- [x] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [x] Encode HDR content (bt2020 + pq) and verify metadata in output file
- [x] MediaInfo/ffprobe shows correct color primaries/transfer

---

## Phase 5: Medium Priority - copyTo() Full Implementation

### Overview
Extend VideoFrame.copyTo() to support format conversion, rect cropping, and color space conversion.

### Changes Required:

#### 5.1 Native copyTo Enhancement

**File**: `native/frame.cpp`
**Changes**: Add format/rect/colorSpace conversion support

```cpp
Napi::Value VideoFrameNative::CopyTo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1) {
        Napi::TypeError::New(env, "destination buffer required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Get destination buffer
    uint8_t* destData;
    size_t destSize;

    if (info[0].IsBuffer()) {
        auto buf = info[0].As<Napi::Buffer<uint8_t>>();
        destData = buf.Data();
        destSize = buf.Length();
    } else if (info[0].IsArrayBuffer()) {
        auto ab = info[0].As<Napi::ArrayBuffer>();
        destData = static_cast<uint8_t*>(ab.Data());
        destSize = ab.ByteLength();
    } else {
        Napi::TypeError::New(env, "Invalid destination type").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Parse options
    AVPixelFormat targetFormat = static_cast<AVPixelFormat>(frame_->format);
    int rectX = 0, rectY = 0;
    int rectW = frame_->width, rectH = frame_->height;

    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object options = info[1].As<Napi::Object>();

        // Format conversion
        if (options.Has("format") && options.Get("format").IsString()) {
            std::string fmt = options.Get("format").As<Napi::String>().Utf8Value();
            targetFormat = StringToPixelFormat(fmt);
        }

        // Rect cropping
        if (options.Has("rect") && options.Get("rect").IsObject()) {
            Napi::Object rect = options.Get("rect").As<Napi::Object>();
            rectX = rect.Has("x") ? rect.Get("x").As<Napi::Number>().Int32Value() : 0;
            rectY = rect.Has("y") ? rect.Get("y").As<Napi::Number>().Int32Value() : 0;
            rectW = rect.Has("width") ? rect.Get("width").As<Napi::Number>().Int32Value() : frame_->width;
            rectH = rect.Has("height") ? rect.Get("height").As<Napi::Number>().Int32Value() : frame_->height;
        }
    }

    // Perform conversion if needed
    bool needsConversion = (targetFormat != frame_->format) ||
                          (rectX != 0 || rectY != 0 ||
                           rectW != frame_->width || rectH != frame_->height);

    if (needsConversion) {
        // Use swscale for conversion
        SwsContext* swsCtx = sws_getContext(
            frame_->width, frame_->height, static_cast<AVPixelFormat>(frame_->format),
            rectW, rectH, targetFormat,
            SWS_BILINEAR, nullptr, nullptr, nullptr
        );

        if (!swsCtx) {
            Napi::Error::New(env, "Failed to create conversion context").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Create output frame
        AVFrame* outFrame = av_frame_alloc();
        outFrame->format = targetFormat;
        outFrame->width = rectW;
        outFrame->height = rectH;
        av_frame_get_buffer(outFrame, 0);

        // Adjust source pointers for rect offset
        const uint8_t* srcSlice[4];
        int srcStride[4];
        for (int i = 0; i < 4 && frame_->data[i]; i++) {
            srcSlice[i] = frame_->data[i];
            srcStride[i] = frame_->linesize[i];
        }

        sws_scale(swsCtx, srcSlice, srcStride, rectY, rectH,
                  outFrame->data, outFrame->linesize);

        // Copy to destination
        copyFrameToBuffer(outFrame, destData, destSize, targetFormat);

        sws_freeContext(swsCtx);
        av_frame_free(&outFrame);
    } else {
        // Direct copy
        copyFrameToBuffer(frame_, destData, destSize, targetFormat);
    }

    // Return layout info
    return createLayoutArray(env, targetFormat, rectW, rectH);
}
```

#### 5.2 TypeScript copyTo Options

**File**: `src/VideoFrame.ts`
**Changes**: Add full copyTo options interface

```typescript
export interface VideoFrameCopyToOptions {
    rect?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
    };
    format?: VideoPixelFormat;
    colorSpace?: 'srgb' | 'display-p3';
    layout?: PlaneLayout[];
}
```

### Success Criteria:

#### Automated Verification:
- [x] Build succeeds: `npm run build`
- [x] copyTo format conversion test (I420 → RGBA)
- [x] copyTo rect cropping test
- [x] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [x] Visual verification of cropped frame output
- [x] Format conversion produces correct colors

---

## Phase 6: Low Priority - Alpha Channel Support

### Overview
Enable alpha channel preservation during encoding for VP8/VP9.

### Changes Required:

#### 6.1 Native Alpha Encoding

**File**: `native/encoder.cpp`
**Changes**: Handle alpha in pixel format selection

```cpp
// In Configure(), after parsing config:
bool keepAlpha = false;
if (config.Has("alpha") && config.Get("alpha").IsString()) {
    std::string alphaMode = config.Get("alpha").As<Napi::String>().Utf8Value();
    keepAlpha = (alphaMode == "keep");
}
alpha_ = keepAlpha;

// When setting pixel format (~line 191):
if (alpha_ && (codecName.find("vp8") != std::string::npos ||
               codecName.find("vp9") != std::string::npos)) {
    hwInputFormat_ = AV_PIX_FMT_YUVA420P;  // YUV with alpha
} else {
    hwInputFormat_ = encInfo.inputFormat;
}
```

**File**: `native/encoder.h`
**Changes**: Add alpha member

```cpp
bool alpha_;
```

#### 6.2 Frame Format Detection

**File**: `native/encoder.cpp` in Encode()
**Changes**: Detect and handle alpha channel in input frames

```cpp
// When converting pixel format:
bool inputHasAlpha = (srcFormat == AV_PIX_FMT_RGBA ||
                      srcFormat == AV_PIX_FMT_BGRA ||
                      srcFormat == AV_PIX_FMT_YUVA420P);

if (alpha_ && inputHasAlpha) {
    // Convert to YUVA420P preserving alpha
    // ... swscale with alpha-aware conversion
}
```

### Success Criteria:

#### Automated Verification:
- [x] Build succeeds: `npm run build`
- [x] VP9 alpha encode/decode roundtrip test
- [x] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [x] Encode RGBA → VP9 with alpha: 'keep', verify transparency preserved
- [ ] Play encoded video in Chrome, confirm transparency works

---

## Phase 7: Low Priority - Scalability Modes (Temporal Layers)

### Overview
Implement temporal layer encoding (L1T2, L1T3) for VP9 and AV1.

### Changes Required:

#### 7.1 Native SVC Configuration

**File**: `native/svc.h` (NEW)

```cpp
#pragma once
#include <string>

struct ScalabilityConfig {
    int spatialLayers;
    int temporalLayers;
    bool isSimulcast;
    float ratioH;  // 1.5 for 'h' suffix, 2.0 otherwise
};

ScalabilityConfig parseScalabilityMode(const std::string& mode);
```

**File**: `native/svc.cpp` (NEW)

```cpp
#include "svc.h"
#include <regex>

ScalabilityConfig parseScalabilityMode(const std::string& mode) {
    ScalabilityConfig config = {1, 1, false, 2.0f};

    std::regex pattern("([LS])(\\d)T(\\d)(h)?(_KEY)?(_SHIFT)?");
    std::smatch match;

    if (std::regex_match(mode, match, pattern)) {
        config.isSimulcast = (match[1] == "S");
        config.spatialLayers = std::stoi(match[2]);
        config.temporalLayers = std::stoi(match[3]);
        config.ratioH = match[4].matched ? 1.5f : 2.0f;
    }

    return config;
}
```

#### 7.2 VP9/AV1 Temporal Layers

**File**: `native/encoder.cpp`
**Changes**: Configure temporal layers for VP9/AV1

```cpp
#include "svc.h"

// In Configure(), after codec-specific setup:
if (config.Has("scalabilityMode") && config.Get("scalabilityMode").IsString()) {
    std::string svcMode = config.Get("scalabilityMode").As<Napi::String>().Utf8Value();
    auto svcConfig = parseScalabilityMode(svcMode);

    if (svcConfig.temporalLayers > 1) {
        if (codecName.find("vp9") != std::string::npos ||
            codecName.find("vp8") != std::string::npos) {
            // libvpx temporal layers
            char tlStr[8];
            snprintf(tlStr, sizeof(tlStr), "%d", svcConfig.temporalLayers);
            av_opt_set(codecCtx_->priv_data, "lag-in-frames", "0", 0);
            av_opt_set(codecCtx_->priv_data, "error-resilient", "1", 0);
            // Note: Full SVC config via -svc-parameters
        } else if (codecName.find("av1") != std::string::npos) {
            // libaom-av1 temporal layers
            av_opt_set_int(codecCtx_->priv_data, "aom-params",
                          svcConfig.temporalLayers, 0);
        }
    }

    scalabilityMode_ = svcMode;
}
```

#### 7.3 Temporal Layer ID in Output

**File**: `native/encoder.cpp` in EmitChunk()
**Changes**: Include temporal layer info in chunk metadata

```cpp
// When creating metadata object:
if (!scalabilityMode_.empty()) {
    Napi::Object svc = Napi::Object::New(env);
    svc.Set("temporalLayerId", /* extract from packet */);
    meta.Set("svc", svc);
}
```

### Success Criteria:

#### Automated Verification:
- [x] Build succeeds: `npm run build`
- [x] VP9 L1T2 encode test (verify 2 temporal layers)
- [x] TypeScript compiles: `npx tsc --noEmit`

#### Manual Verification:
- [x] Analyze encoded stream to verify temporal layer structure
- [ ] Test selective layer decoding

---

## Testing Strategy

### Unit Tests

Each phase should add tests in `test/`:

1. **latencyMode**: `test/latency-mode.test.ts`
   - Configure with 'quality' and 'realtime'
   - Verify encoder opens successfully
   - Compare output characteristics

2. **bitrateMode**: `test/bitrate-mode.test.ts`
   - Test CBR, VBR, quantizer modes
   - Verify quantizer parameter is respected

3. **ImageDecoder**: `test/image-decoder.test.ts`
   - Test each supported format (JPEG, PNG, WebP, GIF)
   - Test isTypeSupported()
   - Test decode() returns VideoFrame
   - Test close() cleanup

4. **colorSpace**: `test/color-space.test.ts`
   - Round-trip encode/decode with specific color space
   - Verify metadata preservation

5. **copyTo**: `test/copyto.test.ts`
   - Format conversion (I420 → RGBA)
   - Rect cropping
   - Buffer size validation

6. **alpha**: `test/alpha.test.ts`
   - Encode RGBA with alpha: 'keep'
   - Verify alpha plane in decoded output

### Integration Tests

1. **Image → Video Pipeline**: `test/integration/image-to-video.test.ts`
   - Decode multiple images with ImageDecoder
   - Encode to video with VideoEncoder
   - Verify output

2. **HDR Workflow**: `test/integration/hdr.test.ts`
   - Create HDR-tagged frames
   - Encode with bt2020/pq
   - Decode and verify color space metadata

### Manual Testing

- Benchmark latencyMode performance difference
- Visual verification of alpha channel in browser
- HDR content playback verification

---

## Performance Considerations

1. **ImageDecoder**: Single-frame decoding - no buffering needed
2. **latencyMode realtime**: Reduces quality for speed - document tradeoffs
3. **copyTo format conversion**: Uses swscale - may be slow for large frames
4. **Alpha channel**: Adds ~25% encoding overhead due to extra plane
5. **Temporal layers**: Slightly more complex encoding, minimal overhead

---

## Migration Notes

These are additive features - no breaking changes:
- Existing code continues to work unchanged
- New features are opt-in via configuration options
- Default behavior matches current implementation

---

## References

- W3C WebCodecs Spec: https://www.w3.org/TR/webcodecs/
- MDN ImageDecoder: https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder
- FFmpeg libavcodec: https://ffmpeg.org/libavcodec.html
- WebRTC-SVC: https://w3c.github.io/webrtc-svc/
