# node-webcodecs

Native WebCodecs API implementation for Node.js, using FFmpeg for encoding and decoding.

[![npm version](https://badge.fury.io/js/node-webcodecs.svg)](https://www.npmjs.com/package/node-webcodecs)

## Features

- **W3C WebCodecs API compatible** - Same API as the browser WebCodecs
- **Video codecs**: H.264/AVC, H.265/HEVC, VP8, VP9, AV1
- **Audio codecs**: AAC, Opus, FLAC, MP3
- **High performance** - Native C++ bindings with FFmpeg
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

## Supported Codecs

### Video Codecs

| Codec String | Description | Encoder | Decoder |
|--------------|-------------|---------|---------|
| `avc1.PPCCLL` | H.264/AVC | libx264 | h264 |
| `hvc1`, `hev1` | H.265/HEVC | libx265 | hevc |
| `vp8` | VP8 | libvpx | vp8 |
| `vp9`, `vp09.PP.LL.DD` | VP9 | libvpx-vp9 | vp9 |
| `av01` | AV1 | libaom-av1 | libdav1d |

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
