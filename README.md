# node-webcodecs

Native WebCodecs API implementation for Node.js, using FFmpeg for encoding and decoding.

[![npm version](https://badge.fury.io/js/node-webcodecs.svg)](https://www.npmjs.com/package/node-webcodecs)

## Features

- **W3C WebCodecs API compatible** - Same API as the browser WebCodecs
- **Non-blocking async encoding/decoding** - Worker thread pool keeps the event loop responsive
- **Hardware acceleration** - VideoToolbox (macOS), NVENC (NVIDIA), QSV (Intel), VAAPI (Linux)
- **Video codecs**: H.264/AVC, H.265/HEVC, VP8, VP9, AV1
- **Audio codecs**: AAC, Opus, FLAC, MP3
- **ImageDecoder** - Decode JPEG, PNG, GIF, WebP, BMP images with ReadableStream support
- **Native codec probing** - `isConfigSupported` actually tests codec availability
- **HDR support** - BT.2020, PQ (HDR10), HLG color spaces
- **Alpha channel** - VP8/VP9 with transparency (`alpha: 'keep'`)
- **Scalability modes** - Temporal layer SVC (L1T1, L1T2, L1T3)
- **Latency modes** - `'quality'` vs `'realtime'` encoding
- **Bitrate modes** - `'constant'`, `'variable'`, `'quantizer'`
- **High performance** - Native C++ bindings with FFmpeg
- **Backpressure support** - `encodeQueueSize`, `decodeQueueSize`, and `dequeue` events
- **TypeScript support** - Full type definitions included

## Requirements

- Node.js 18+
- FFmpeg libraries (libavcodec, libavutil, libswscale, libswresample)
- pkg-config (for finding FFmpeg during build)
- A C++ compiler (Xcode Command Line Tools on macOS, build-essential on Linux)

### Installing Dependencies

**macOS (Homebrew):**
```bash
brew install ffmpeg pkg-config

# Ensure Homebrew is in your PATH (add to ~/.zshrc or ~/.bashrc)
export PATH="/opt/homebrew/bin:$PATH"
```

**Ubuntu/Debian:**
```bash
sudo apt-get install build-essential pkg-config libavcodec-dev libavutil-dev libswscale-dev libswresample-dev
```

**Windows:**
Install FFmpeg and add to PATH, or use vcpkg. Ensure `pkg-config` is available.

## Installation

```bash
npm install node-webcodecs
```

## Quick Start

### Video Encoding

```javascript
const { VideoEncoder, VideoFrame } = require('node-webcodecs');

const encoder = new VideoEncoder({
  output: (chunk, metadata) => {
    console.log(`Encoded: ${chunk.byteLength} bytes`);
  },
  error: (err) => console.error(err),
});

encoder.configure({
  codec: 'avc1.42E01E',  // H.264 Baseline
  width: 640,
  height: 480,
  bitrate: 1_000_000,
});

// Create frame from RGBA buffer
const frame = new VideoFrame(rgbaBuffer, {
  format: 'RGBA',
  codedWidth: 640,
  codedHeight: 480,
  timestamp: 0,
});

encoder.encode(frame, { keyFrame: true });
frame.close();

await encoder.flush();
encoder.close();
```

### Video Decoding

```javascript
const { VideoDecoder, EncodedVideoChunk } = require('node-webcodecs');

const decoder = new VideoDecoder({
  output: (frame) => {
    console.log(`Decoded: ${frame.codedWidth}x${frame.codedHeight}`);
    frame.close();
  },
  error: (err) => console.error(err),
});

decoder.configure({
  codec: 'avc1.42E01E',
  codedWidth: 640,
  codedHeight: 480,
});

// Decode an encoded chunk
decoder.decode(encodedChunk);
await decoder.flush();
decoder.close();
```

### Audio Encoding

```javascript
const { AudioEncoder, AudioData } = require('node-webcodecs');

const encoder = new AudioEncoder({
  output: (chunk, metadata) => {
    console.log(`Encoded: ${chunk.byteLength} bytes`);
  },
  error: (err) => console.error(err),
});

encoder.configure({
  codec: 'mp4a.40.2',  // AAC-LC
  sampleRate: 48000,
  numberOfChannels: 2,
  bitrate: 128000,
});

const audio = new AudioData({
  format: 'f32',
  sampleRate: 48000,
  numberOfFrames: 1024,
  numberOfChannels: 2,
  timestamp: 0,
  data: floatSamples,
});

encoder.encode(audio);
audio.close();

await encoder.flush();
encoder.close();
```

### Image Decoding

```javascript
const { ImageDecoder } = require('node-webcodecs');
const fs = require('fs');

const imageData = fs.readFileSync('photo.jpg');

const decoder = new ImageDecoder({
  data: imageData,
  type: 'image/jpeg',
});

await decoder.completed;

console.log(`Image: ${decoder.tracks.selectedTrack.frameCount} frame(s)`);

const result = await decoder.decode({ frameIndex: 0 });
const frame = result.image;

console.log(`Decoded: ${frame.codedWidth}x${frame.codedHeight}`);
frame.close();
decoder.close();
```

### Advanced Encoding Options

```javascript
// HDR encoding with BT.2020 + PQ
encoder.configure({
  codec: 'hvc1',
  width: 3840,
  height: 2160,
  bitrate: 20_000_000,
  colorSpace: {
    primaries: 'bt2020',
    transfer: 'pq',        // HDR10
    matrix: 'bt2020-ncl',
    fullRange: false,
  },
});

// Low-latency realtime encoding
encoder.configure({
  codec: 'avc1.42E01E',
  width: 1280,
  height: 720,
  bitrate: 2_000_000,
  latencyMode: 'realtime',
  bitrateMode: 'constant',
});

// VP9 with alpha channel
encoder.configure({
  codec: 'vp09.00.10.08',
  width: 640,
  height: 480,
  bitrate: 1_000_000,
  alpha: 'keep',  // Preserve alpha channel
});

// Temporal layer SVC
encoder.configure({
  codec: 'vp09.00.10.08',
  width: 1280,
  height: 720,
  bitrate: 2_000_000,
  scalabilityMode: 'L1T2',  // 1 spatial, 2 temporal layers
});
```

## Supported Codecs

### Video Codecs

| Codec String | Description | SW Encoder | HW Encoder |
|--------------|-------------|------------|------------|
| `avc1.PPCCLL` | H.264/AVC | libx264 | VideoToolbox, NVENC, QSV |
| `hvc1`, `hev1` | H.265/HEVC | libx265 | VideoToolbox, NVENC, QSV |
| `vp8` | VP8 | libvpx | - |
| `vp9`, `vp09.PP.LL.DD` | VP9 | libvpx-vp9 | VAAPI, QSV |
| `av01` | AV1 | libsvtav1 | NVENC (RTX 40+), QSV |

## Hardware Acceleration

Hardware encoders are automatically selected when available. You can control this with the `hardwareAcceleration` option:

```javascript
encoder.configure({
  codec: 'avc1.42E01E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  hardwareAcceleration: 'prefer-hardware',  // 'no-preference' | 'prefer-hardware' | 'prefer-software'
});
```

### Supported Hardware Accelerators

| Platform | Accelerator | H.264 | HEVC | VP9 | AV1 |
|----------|-------------|-------|------|-----|-----|
| macOS | VideoToolbox | Encode/Decode | Encode/Decode | - | - |
| Windows/Linux | NVIDIA NVENC | Encode | Encode | - | Encode (RTX 40+) |
| Windows/Linux | Intel QuickSync | Encode/Decode | Encode/Decode | Encode | Encode |
| Linux | VA-API | Encode/Decode | Encode/Decode | Encode | Encode |

## Async Worker Threads

By default, encoding and decoding operations run on a dedicated worker thread to avoid blocking the Node.js event loop. This keeps your application responsive during heavy video processing.

```javascript
// Async mode (default) - event loop stays responsive
encoder.configure({
  codec: 'avc1.42E01E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  useWorkerThread: true,  // default
});

// Sync mode - blocks event loop (legacy behavior)
encoder.configure({
  codec: 'avc1.42E01E',
  width: 1920,
  height: 1080,
  bitrate: 5_000_000,
  useWorkerThread: false,
});
```

Benchmark results show async mode allows **3100% more event loop iterations** compared to sync mode, meaning your HTTP servers, timers, and I/O operations continue running smoothly during encoding.

### Audio Codecs

| Codec String | Description | Encoder | Decoder |
|--------------|-------------|---------|---------|
| `mp4a.40.2` | AAC-LC | aac | aac |
| `opus` | Opus | libopus | opus |
| `flac` | FLAC (lossless) | flac | flac |
| `mp3` | MP3 | libmp3lame | mp3 |

## API Reference

### VideoEncoder

```typescript
const encoder = new VideoEncoder(init: VideoEncoderInit);
encoder.configure(config: VideoEncoderConfig);
encoder.encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions);
await encoder.flush();
encoder.close();
encoder.reset();

// Static method to check codec support
const support = await VideoEncoder.isConfigSupported(config);
```

### VideoDecoder

```typescript
const decoder = new VideoDecoder(init: VideoDecoderInit);
decoder.configure(config: VideoDecoderConfig);
decoder.decode(chunk: EncodedVideoChunk);
await decoder.flush();
decoder.close();
decoder.reset();

// Static method to check codec support
const support = await VideoDecoder.isConfigSupported(config);
```

### AudioEncoder

```typescript
const encoder = new AudioEncoder(init: AudioEncoderInit);
encoder.configure(config: AudioEncoderConfig);
encoder.encode(data: AudioData);
await encoder.flush();
encoder.close();
encoder.reset();
```

### AudioDecoder

```typescript
const decoder = new AudioDecoder(init: AudioDecoderInit);
decoder.configure(config: AudioDecoderConfig);
decoder.decode(chunk: EncodedAudioChunk);
await decoder.flush();
decoder.close();
decoder.reset();
```

### ImageDecoder

```typescript
const decoder = new ImageDecoder(init: ImageDecoderInit);
await decoder.completed;              // Promise that resolves when ready
decoder.type;                         // MIME type
decoder.tracks;                       // ImageTrackList with frame info
const result = await decoder.decode({ frameIndex: 0 });
decoder.close();

// Supported types: image/jpeg, image/png, image/gif, image/webp, image/bmp
```

### VideoFrame

```typescript
const frame = new VideoFrame(data: BufferSource, init: VideoFrameBufferInit);
frame.codedWidth;
frame.codedHeight;
frame.timestamp;
frame.duration;
frame.format;
frame.allocationSize(options?);
frame.copyTo(destination, options?);
frame.clone();
frame.close();
```

### AudioData

```typescript
const audio = new AudioData(init: AudioDataInit);
audio.sampleRate;
audio.numberOfFrames;
audio.numberOfChannels;
audio.format;
audio.timestamp;
audio.duration;
audio.allocationSize(options?);
audio.copyTo(destination, options?);
audio.clone();
audio.close();
```

## Examples

See the `examples/` directory for more usage examples:

- `basic-video-encode.js` - Simple video encoding
- `basic-audio-encode.js` - Simple audio encoding
- `encode-decode-roundtrip.js` - Full encode/decode cycle

## Runtime Support

| Runtime | Version | Status |
|---------|---------|--------|
| Node.js | 18+     | Supported |
| Bun     | 1.0+    | Supported |

### Bun Installation

```bash
bun add node-webcodecs
```

If the native binary doesn't compile automatically, you may need to trust the package:

```bash
bun pm trust node-webcodecs
```

## Building from Source

```bash
git clone https://github.com/caseymanos/node-webcodecs.git
cd node-webcodecs
npm install
npm run build
npm test
```

## License

MIT
