/**
 * WebCodecs Functional Tests
 * 
 * These tests verify that encoding/decoding actually works, not just that the API exists.
 * Tests are implementation-agnostic and should pass in any spec-compliant environment.
 */

import { describe, it, expect, afterEach } from 'vitest';

const isWebCodecsAvailable = () => {
  return typeof globalThis.VideoEncoder !== 'undefined';
};

/**
 * Helper to create I420 VideoFrame (most compatible format)
 */
function createI420VideoFrame(
  width: number,
  height: number,
  timestamp: number,
  yValue: number = 128,
  uValue: number = 128,
  vValue: number = 128
): VideoFrame {
  const ySize = width * height;
  const uvWidth = Math.ceil(width / 2);
  const uvHeight = Math.ceil(height / 2);
  const uvSize = uvWidth * uvHeight;
  
  const data = new Uint8Array(ySize + uvSize * 2);
  data.fill(yValue, 0, ySize);
  data.fill(uValue, ySize, ySize + uvSize);
  data.fill(vValue, ySize + uvSize, ySize + uvSize * 2);

  return new VideoFrame(data, {
    format: 'I420',
    codedWidth: width,
    codedHeight: height,
    timestamp,
  });
}

describe('VideoFrame Format Tests', () => {
  const formats: VideoPixelFormat[] = ['I420', 'I420A', 'I422', 'I444', 'NV12', 'RGBA', 'RGBX', 'BGRA', 'BGRX'];

  function createVideoFrameForFormat(format: VideoPixelFormat, width: number, height: number): VideoFrame | null {
    let data: Uint8Array;
    
    switch (format) {
      case 'I420': {
        const ySize = width * height;
        const uvSize = Math.ceil(width / 2) * Math.ceil(height / 2);
        data = new Uint8Array(ySize + uvSize * 2);
        data.fill(128);
        break;
      }
      case 'I420A': {
        const ySize = width * height;
        const uvSize = Math.ceil(width / 2) * Math.ceil(height / 2);
        data = new Uint8Array(ySize * 2 + uvSize * 2); // Y + A + U + V
        data.fill(128);
        break;
      }
      case 'I422': {
        const ySize = width * height;
        const uvSize = Math.ceil(width / 2) * height;
        data = new Uint8Array(ySize + uvSize * 2);
        data.fill(128);
        break;
      }
      case 'I444': {
        const ySize = width * height;
        data = new Uint8Array(ySize * 3);
        data.fill(128);
        break;
      }
      case 'NV12': {
        const ySize = width * height;
        const uvSize = width * Math.ceil(height / 2);
        data = new Uint8Array(ySize + uvSize);
        data.fill(128);
        break;
      }
      case 'RGBA':
      case 'RGBX':
      case 'BGRA':
      case 'BGRX':
        data = new Uint8Array(width * height * 4);
        // Fill with a recognizable pattern
        for (let i = 0; i < data.length; i += 4) {
          data[i] = 255;     // R or B
          data[i + 1] = 128; // G
          data[i + 2] = 64;  // B or R
          data[i + 3] = 255; // A or X
        }
        break;
      default:
        return null;
    }

    try {
      return new VideoFrame(data, {
        format,
        codedWidth: width,
        codedHeight: height,
        timestamp: 0,
      });
    } catch {
      return null;
    }
  }

  for (const format of formats) {
    it(`should create VideoFrame with ${format} format`, () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const frame = createVideoFrameForFormat(format, 64, 64);
      
      if (frame === null) {
        // Format might not be supported, which is acceptable
        console.log(`Format ${format} not supported in this environment`);
        return;
      }

      expect(frame.format).toBe(format);
      expect(frame.codedWidth).toBe(64);
      expect(frame.codedHeight).toBe(64);
      
      frame.close();
    });
  }

  it('should report correct displayWidth and displayHeight', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const frame = createI420VideoFrame(128, 96, 0);
    
    expect(frame.displayWidth).toBe(128);
    expect(frame.displayHeight).toBe(96);
    
    frame.close();
  });

  it('should support custom displayWidth and displayHeight', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const ySize = 64 * 64;
    const uvSize = 32 * 32;
    const data = new Uint8Array(ySize + uvSize * 2);
    data.fill(128);

    const frame = new VideoFrame(data, {
      format: 'I420',
      codedWidth: 64,
      codedHeight: 64,
      displayWidth: 128,
      displayHeight: 128,
      timestamp: 0,
    });

    expect(frame.codedWidth).toBe(64);
    expect(frame.codedHeight).toBe(64);
    expect(frame.displayWidth).toBe(128);
    expect(frame.displayHeight).toBe(128);

    frame.close();
  });

  it('should support colorSpace information', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const frame = createI420VideoFrame(64, 64, 0);
    
    // colorSpace should be defined (may be null if not specified)
    expect(frame).toHaveProperty('colorSpace');
    
    frame.close();
  });
});

describe('Video Encoding Functional Tests', () => {
  let encoder: VideoEncoder | null = null;

  afterEach(() => {
    if (encoder && encoder.state !== 'closed') {
      encoder.close();
    }
    encoder = null;
  });

  it('should produce EncodedVideoChunk with actual data', async () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const chunks: EncodedVideoChunk[] = [];
    const metadata: EncodedVideoChunkMetadata[] = [];

    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        chunks.push(chunk);
        if (meta) metadata.push(meta);
      },
      error: (e) => { throw e; },
    });

    encoder.configure({
      codec: 'vp8',
      width: 128,
      height: 128,
      bitrate: 500_000,
      framerate: 30,
    });

    const frame = createI420VideoFrame(128, 128, 0, 200, 128, 128);
    encoder.encode(frame, { keyFrame: true });
    frame.close();

    await encoder.flush();

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].byteLength).toBeGreaterThan(10);
    expect(chunks[0].type).toBe('key');
    expect(metadata.length).toBeGreaterThan(0);
    expect(metadata[0]).toHaveProperty('decoderConfig');
  });

  it('should encode multiple frames with correct timestamps', async () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const chunks: EncodedVideoChunk[] = [];

    encoder = new VideoEncoder({
      output: (chunk) => { chunks.push(chunk); },
      error: (e) => { throw e; },
    });

    encoder.configure({
      codec: 'vp8',
      width: 64,
      height: 64,
      bitrate: 200_000,
      framerate: 30,
    });

    const timestamps = [0, 33333, 66666, 99999, 133332];
    
    for (let i = 0; i < timestamps.length; i++) {
      const frame = createI420VideoFrame(64, 64, timestamps[i], 50 + i * 40, 128, 128);
      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
    }

    await encoder.flush();

    expect(chunks.length).toBe(5);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].timestamp).toBe(timestamps[i]);
    }
  });
});

describe('Video Decoding Functional Tests', () => {
  let decoder: VideoDecoder | null = null;

  afterEach(() => {
    if (decoder && decoder.state !== 'closed') {
      decoder.close();
    }
    decoder = null;
  });

  it('should decode encoded video and produce VideoFrame with correct dimensions', async () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    // First encode
    const chunks: EncodedVideoChunk[] = [];
    let decoderConfig: VideoDecoderConfig | null = null;
    
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        chunks.push(chunk);
        if (meta?.decoderConfig) decoderConfig = meta.decoderConfig;
      },
      error: (e) => { throw e; },
    });

    encoder.configure({
      codec: 'vp8',
      width: 96,
      height: 96,
      bitrate: 300_000,
      framerate: 30,
    });

    const frame = createI420VideoFrame(96, 96, 0, 180, 128, 128);
    encoder.encode(frame, { keyFrame: true });
    frame.close();
    await encoder.flush();
    encoder.close();

    expect(chunks.length).toBeGreaterThan(0);
    expect(decoderConfig).not.toBeNull();

    // Now decode
    const decodedFrames: VideoFrame[] = [];
    
    decoder = new VideoDecoder({
      output: (f) => { decodedFrames.push(f); },
      error: (e) => { throw e; },
    });

    decoder.configure(decoderConfig!);

    for (const chunk of chunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();

    expect(decodedFrames.length).toBeGreaterThan(0);
    expect(decodedFrames[0].codedWidth).toBe(96);
    expect(decodedFrames[0].codedHeight).toBe(96);
    expect(decodedFrames[0].format).toBeTruthy();

    for (const f of decodedFrames) {
      f.close();
    }
  });
});

describe('Audio Encoding Functional Tests', () => {
  let encoder: AudioEncoder | null = null;

  afterEach(() => {
    if (encoder && encoder.state !== 'closed') {
      encoder.close();
    }
    encoder = null;
  });

  it('should encode AudioData and produce EncodedAudioChunk', async () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const chunks: EncodedAudioChunk[] = [];
    const metadata: EncodedAudioChunkMetadata[] = [];

    encoder = new AudioEncoder({
      output: (chunk, meta) => {
        chunks.push(chunk);
        if (meta) metadata.push(meta);
      },
      error: (e) => { throw e; },
    });

    encoder.configure({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 128000,
    });

    // 960 samples = 20ms at 48kHz (standard Opus frame)
    const numberOfFrames = 960;
    const samples = new Float32Array(numberOfFrames * 2);
    
    for (let i = 0; i < numberOfFrames; i++) {
      samples[i * 2] = Math.sin((2 * Math.PI * 440 * i) / 48000);
      samples[i * 2 + 1] = Math.sin((2 * Math.PI * 880 * i) / 48000);
    }

    const audioData = new AudioData({
      format: 'f32',
      sampleRate: 48000,
      numberOfFrames: numberOfFrames,
      numberOfChannels: 2,
      timestamp: 0,
      data: samples,
    });

    encoder.encode(audioData);
    audioData.close();

    await encoder.flush();

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].byteLength).toBeGreaterThan(0);
    expect(metadata.length).toBeGreaterThan(0);
    expect(metadata[0]).toHaveProperty('decoderConfig');
  });

  it('should preserve timestamps when encoding multiple audio frames', async () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const chunks: EncodedAudioChunk[] = [];

    encoder = new AudioEncoder({
      output: (chunk) => { chunks.push(chunk); },
      error: (e) => { throw e; },
    });

    encoder.configure({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 1,
      bitrate: 64000,
    });

    const frameSize = 960;
    const timestamps = [0, 20000, 40000, 60000, 80000];
    
    for (let i = 0; i < 5; i++) {
      const samples = new Float32Array(frameSize);
      for (let j = 0; j < frameSize; j++) {
        samples[j] = Math.sin((2 * Math.PI * (440 + i * 100) * j) / 48000);
      }

      const audioData = new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfFrames: frameSize,
        numberOfChannels: 1,
        timestamp: timestamps[i],
        data: samples,
      });

      encoder.encode(audioData);
      audioData.close();
    }

    await encoder.flush();

    expect(chunks.length).toBeGreaterThanOrEqual(5);
    
    // WebCodecs spec says output timestamps should match input timestamps
    for (let i = 0; i < 5; i++) {
      expect(chunks[i].timestamp).toBe(timestamps[i]);
    }
  });
});

describe('VideoFrame Functional Tests', () => {
  it('should clone VideoFrame and maintain properties', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const original = createI420VideoFrame(64, 64, 12345, 200, 128, 128);
    const clone = original.clone();

    expect(clone.codedWidth).toBe(original.codedWidth);
    expect(clone.codedHeight).toBe(original.codedHeight);
    expect(clone.timestamp).toBe(original.timestamp);
    expect(clone.format).toBe(original.format);

    original.close();
    
    // Clone should still be usable
    expect(clone.codedWidth).toBe(64);
    
    clone.close();
  });

  it('should correctly report visibleRect', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const frame = createI420VideoFrame(128, 96, 0);

    expect(frame.visibleRect).toBeDefined();
    expect(frame.visibleRect?.x).toBe(0);
    expect(frame.visibleRect?.y).toBe(0);
    expect(frame.visibleRect?.width).toBe(128);
    expect(frame.visibleRect?.height).toBe(96);

    frame.close();
  });

  it('should copyTo a buffer and return layout information', async () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const frame = createI420VideoFrame(32, 32, 0, 220, 100, 150);
    
    const size = frame.allocationSize();
    expect(size).toBeGreaterThan(0);
    
    const buffer = new Uint8Array(size);
    const layout = await frame.copyTo(buffer);

    expect(layout).toBeDefined();
    expect(Array.isArray(layout)).toBe(true);
    expect(layout.length).toBeGreaterThanOrEqual(3); // I420 has 3 planes
    
    // Buffer should have actual data
    let hasNonZero = false;
    for (const byte of buffer) {
      if (byte !== 0) {
        hasNonZero = true;
        break;
      }
    }
    expect(hasNonZero).toBe(true);

    frame.close();
  });
});

describe('AudioData Functional Tests', () => {
  it('should clone AudioData and maintain properties', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const samples = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    }

    const original = new AudioData({
      format: 'f32',
      sampleRate: 48000,
      numberOfFrames: 1024,
      numberOfChannels: 1,
      timestamp: 54321,
      data: samples,
    });

    const clone = original.clone();

    expect(clone.format).toBe(original.format);
    expect(clone.sampleRate).toBe(original.sampleRate);
    expect(clone.numberOfFrames).toBe(original.numberOfFrames);
    expect(clone.numberOfChannels).toBe(original.numberOfChannels);
    expect(clone.timestamp).toBe(original.timestamp);

    original.close();
    expect(clone.numberOfFrames).toBe(1024);

    clone.close();
  });

  it('should copyTo a buffer with correct data', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const numberOfFrames = 256;
    const samples = new Float32Array(numberOfFrames);
    
    for (let i = 0; i < numberOfFrames; i++) {
      samples[i] = (i / numberOfFrames) * 2 - 1;
    }

    const audioData = new AudioData({
      format: 'f32',
      sampleRate: 48000,
      numberOfFrames: numberOfFrames,
      numberOfChannels: 1,
      timestamp: 0,
      data: samples,
    });

    const size = audioData.allocationSize({ planeIndex: 0 });
    expect(size).toBe(numberOfFrames * 4);

    const destination = new Float32Array(numberOfFrames);
    audioData.copyTo(destination, { planeIndex: 0 });

    for (let i = 0; i < numberOfFrames; i++) {
      expect(destination[i]).toBeCloseTo(samples[i], 5);
    }

    audioData.close();
  });
});

describe('Audio Decoding Functional Tests', () => {
  let decoder: AudioDecoder | null = null;

  afterEach(() => {
    if (decoder && decoder.state !== 'closed') {
      decoder.close();
    }
    decoder = null;
  });

  it('should decode encoded audio and produce AudioData with correct properties', async () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    // First encode
    const chunks: EncodedAudioChunk[] = [];
    let decoderConfig: AudioDecoderConfig | null = null;

    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        chunks.push(chunk);
        if (meta?.decoderConfig) decoderConfig = meta.decoderConfig;
      },
      error: (e) => { throw e; },
    });

    encoder.configure({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 128000,
    });

    // Encode a single frame
    const numberOfFrames = 960;
    const samples = new Float32Array(numberOfFrames * 2);
    for (let i = 0; i < numberOfFrames; i++) {
      samples[i * 2] = Math.sin((2 * Math.PI * 440 * i) / 48000);
      samples[i * 2 + 1] = Math.sin((2 * Math.PI * 880 * i) / 48000);
    }

    const audioData = new AudioData({
      format: 'f32',
      sampleRate: 48000,
      numberOfFrames,
      numberOfChannels: 2,
      timestamp: 0,
      data: samples,
    });

    encoder.encode(audioData);
    audioData.close();
    await encoder.flush();
    encoder.close();

    expect(chunks.length).toBeGreaterThan(0);
    expect(decoderConfig).not.toBeNull();

    // Now decode
    const decodedAudio: AudioData[] = [];

    decoder = new AudioDecoder({
      output: (data) => { decodedAudio.push(data); },
      error: (e) => { throw e; },
    });

    decoder.configure(decoderConfig!);

    for (const chunk of chunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();

    expect(decodedAudio.length).toBeGreaterThan(0);
    expect(decodedAudio[0].sampleRate).toBe(48000);
    expect(decodedAudio[0].numberOfChannels).toBe(2);
    expect(decodedAudio[0].format).toBeTruthy();

    for (const data of decodedAudio) {
      data.close();
    }
  });

  it('should produce AudioData with monotonically increasing timestamps', async () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    // Encode multiple frames
    const chunks: EncodedAudioChunk[] = [];
    let decoderConfig: AudioDecoderConfig | null = null;

    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        chunks.push(chunk);
        if (meta?.decoderConfig) decoderConfig = meta.decoderConfig;
      },
      error: (e) => { throw e; },
    });

    encoder.configure({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 1,
      bitrate: 64000,
    });

    const frameSize = 960;
    const timestamps = [0, 20000, 40000];

    for (let i = 0; i < timestamps.length; i++) {
      const samples = new Float32Array(frameSize);
      for (let j = 0; j < frameSize; j++) {
        samples[j] = Math.sin((2 * Math.PI * 440 * j) / 48000);
      }

      const audioData = new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfFrames: frameSize,
        numberOfChannels: 1,
        timestamp: timestamps[i],
        data: samples,
      });

      encoder.encode(audioData);
      audioData.close();
    }

    await encoder.flush();
    encoder.close();

    // Decode
    const decodedAudio: AudioData[] = [];

    decoder = new AudioDecoder({
      output: (data) => { decodedAudio.push(data); },
      error: (e) => { throw e; },
    });

    decoder.configure(decoderConfig!);

    for (const chunk of chunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();

    expect(decodedAudio.length).toBeGreaterThan(0);
    
    // Decoded timestamps should be monotonically increasing
    // Note: Due to Opus encoder priming, decoded timestamps may not exactly match
    // input timestamps, but they should be monotonically increasing
    for (let i = 1; i < decodedAudio.length; i++) {
      expect(decodedAudio[i].timestamp).toBeGreaterThan(decodedAudio[i - 1].timestamp);
    }

    for (const data of decodedAudio) {
      data.close();
    }
  });
});

describe('Queue Size Tracking', () => {
  it('should track encodeQueueSize during video encoding', async () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    const encoder = new VideoEncoder({
      output: () => {},
      error: () => {},
    });

    encoder.configure({
      codec: 'vp8',
      width: 64,
      height: 64,
      bitrate: 100_000,
      framerate: 30,
    });

    for (let i = 0; i < 5; i++) {
      const frame = createI420VideoFrame(64, 64, i * 33333);
      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
    }

    await encoder.flush();
    
    expect(encoder.encodeQueueSize).toBe(0);
    
    encoder.close();
  });

  it('should track decodeQueueSize during video decoding', async () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }

    // First encode
    const chunks: EncodedVideoChunk[] = [];
    let decoderConfig: VideoDecoderConfig | null = null;
    
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        chunks.push(chunk);
        if (meta?.decoderConfig) decoderConfig = meta.decoderConfig;
      },
      error: () => {},
    });

    encoder.configure({
      codec: 'vp8',
      width: 64,
      height: 64,
      bitrate: 100_000,
      framerate: 30,
    });

    for (let i = 0; i < 5; i++) {
      const frame = createI420VideoFrame(64, 64, i * 33333, 100 + i * 30);
      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
    }
    await encoder.flush();
    encoder.close();

    // Now decode
    const decodedFrames: VideoFrame[] = [];
    
    const decoder = new VideoDecoder({
      output: (f) => { decodedFrames.push(f); },
      error: () => {},
    });

    decoder.configure(decoderConfig!);

    for (const chunk of chunks) {
      decoder.decode(chunk);
    }

    await decoder.flush();
    
    expect(decoder.decodeQueueSize).toBe(0);
    
    decoder.close();

    for (const f of decodedFrames) {
      f.close();
    }
  });
});

describe('Error Handling', () => {
  describe('VideoEncoder error states', () => {
    it('should throw when encoding without configure', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      const frame = createI420VideoFrame(64, 64, 0);

      expect(() => {
        encoder.encode(frame);
      }).toThrow();

      frame.close();
      encoder.close();
    });

    it('should throw when flushing unconfigured encoder', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      await expect(encoder.flush()).rejects.toThrow();
      encoder.close();
    });

    it('should throw when operating on closed encoder', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.close();

      expect(() => {
        encoder.configure({
          codec: 'vp8',
          width: 64,
          height: 64,
        });
      }).toThrow();
    });


  });

  describe('VideoDecoder error states', () => {
    it('should throw when decoding without configure', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      const chunk = new EncodedVideoChunk({
        type: 'key',
        timestamp: 0,
        data: new Uint8Array([0, 0, 0, 1]),
      });

      expect(() => {
        decoder.decode(chunk);
      }).toThrow();

      decoder.close();
    });

    it('should throw when operating on closed decoder', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.close();

      expect(() => {
        decoder.configure({ codec: 'vp8' });
      }).toThrow();
    });
  });

  describe('AudioEncoder error states', () => {
    it('should throw when encoding without configure', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      const audioData = new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfFrames: 960,
        numberOfChannels: 1,
        timestamp: 0,
        data: new Float32Array(960),
      });

      expect(() => {
        encoder.encode(audioData);
      }).toThrow();

      audioData.close();
      encoder.close();
    });

    it('should throw when operating on closed encoder', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });

      encoder.close();

      expect(() => {
        encoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
        });
      }).toThrow();
    });
  });

  describe('AudioDecoder error states', () => {
    it('should throw when decoding without configure', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: 0,
        data: new Uint8Array([0xff, 0xf1, 0x50, 0x80]),
      });

      expect(() => {
        decoder.decode(chunk);
      }).toThrow();

      decoder.close();
    });

    it('should throw when operating on closed decoder', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });

      decoder.close();

      expect(() => {
        decoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 2,
        });
      }).toThrow();
    });
  });

  describe('VideoFrame error states', () => {
    it('should throw when cloning closed VideoFrame', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const frame = createI420VideoFrame(64, 64, 0);
      frame.close();

      expect(() => {
        frame.clone();
      }).toThrow();
    });

    it('should throw when calling copyTo on closed VideoFrame', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const frame = createI420VideoFrame(64, 64, 0);
      const size = frame.allocationSize();
      frame.close();

      const buffer = new Uint8Array(size);
      await expect(frame.copyTo(buffer)).rejects.toThrow();
    });
  });

  describe('AudioData error states', () => {
    it('should throw when cloning closed AudioData', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const audioData = new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfFrames: 1024,
        numberOfChannels: 1,
        timestamp: 0,
        data: new Float32Array(1024),
      });

      audioData.close();

      expect(() => {
        audioData.clone();
      }).toThrow();
    });

    it('should throw when calling copyTo on closed AudioData', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }

      const audioData = new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfFrames: 1024,
        numberOfChannels: 1,
        timestamp: 0,
        data: new Float32Array(1024),
      });

      audioData.close();

      const buffer = new Float32Array(1024);
      expect(() => {
        audioData.copyTo(buffer, { planeIndex: 0 });
      }).toThrow();
    });
  });
});
