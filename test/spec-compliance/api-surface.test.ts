/**
 * WebCodecs API Surface Tests
 * 
 * These tests verify that all WebCodecs classes, methods, and properties exist.
 * Tests are implementation-agnostic and should pass in any spec-compliant environment.
 */

import { describe, it, expect, afterEach } from 'vitest';

// Helper to check if WebCodecs API is available
const isWebCodecsAvailable = () => {
  return typeof globalThis.VideoEncoder !== 'undefined' &&
         typeof globalThis.VideoDecoder !== 'undefined' &&
         typeof globalThis.AudioEncoder !== 'undefined' &&
         typeof globalThis.AudioDecoder !== 'undefined';
};

describe('WebCodecs API Availability', () => {
  it('should expose VideoEncoder globally', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }
    expect(typeof globalThis.VideoEncoder).toBe('function');
  });

  it('should expose VideoDecoder globally', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }
    expect(typeof globalThis.VideoDecoder).toBe('function');
  });

  it('should expose AudioEncoder globally', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }
    expect(typeof globalThis.AudioEncoder).toBe('function');
  });

  it('should expose AudioDecoder globally', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }
    expect(typeof globalThis.AudioDecoder).toBe('function');
  });

  it('should expose VideoFrame globally', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }
    expect(typeof globalThis.VideoFrame).toBe('function');
  });

  it('should expose AudioData globally', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }
    expect(typeof globalThis.AudioData).toBe('function');
  });

  it('should expose EncodedVideoChunk globally', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }
    expect(typeof globalThis.EncodedVideoChunk).toBe('function');
  });

  it('should expose EncodedAudioChunk globally', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }
    expect(typeof globalThis.EncodedAudioChunk).toBe('function');
  });

  it('should expose ImageDecoder globally', () => {
    if (!isWebCodecsAvailable()) {
      expect.fail('WebCodecs API not available');
    }
    expect(typeof globalThis.ImageDecoder).toBe('function');
  });
});

describe('VideoEncoder', () => {
  let encoder: InstanceType<typeof VideoEncoder> | null = null;

  afterEach(() => {
    if (encoder && encoder.state !== 'closed') {
      encoder.close();
    }
    encoder = null;
  });

  describe('isConfigSupported', () => {
    it('should have static isConfigSupported method', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      expect(typeof VideoEncoder.isConfigSupported).toBe('function');
    });

    it('should support VP8 codec', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const config = {
        codec: 'vp8',
        width: 640,
        height: 480,
        bitrate: 1_000_000,
        framerate: 30,
      };
      const support = await VideoEncoder.isConfigSupported(config);
      expect(support).toHaveProperty('supported');
      expect(support).toHaveProperty('config');
    });

    it('should support VP9 codec', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const config = {
        codec: 'vp09.00.10.08',
        width: 640,
        height: 480,
        bitrate: 1_000_000,
        framerate: 30,
      };
      const support = await VideoEncoder.isConfigSupported(config);
      expect(support).toHaveProperty('supported');
    });

    it('should support H.264 codec', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const config = {
        codec: 'avc1.42001E',
        width: 640,
        height: 480,
        bitrate: 1_000_000,
        framerate: 30,
      };
      const support = await VideoEncoder.isConfigSupported(config);
      expect(support).toHaveProperty('supported');
    });

    it('should reject invalid codec', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const config = {
        codec: 'invalid-codec',
        width: 640,
        height: 480,
        bitrate: 1_000_000,
        framerate: 30,
      };
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        expect(support.supported).toBe(false);
      } catch {
        // Throwing is also acceptable behavior for invalid codec
        expect(true).toBe(true);
      }
    });
  });

  describe('constructor', () => {
    it('should create a VideoEncoder instance', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });
      expect(encoder).toBeInstanceOf(VideoEncoder);
    });

    it('should start in unconfigured state', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });
      expect(encoder.state).toBe('unconfigured');
    });

    it('should have encodeQueueSize property', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });
      expect(typeof encoder.encodeQueueSize).toBe('number');
      expect(encoder.encodeQueueSize).toBe(0);
    });
  });

  describe('configure', () => {
    it('should configure with valid VP8 config', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });
      encoder.configure({
        codec: 'vp8',
        width: 640,
        height: 480,
        bitrate: 1_000_000,
        framerate: 30,
      });
      expect(encoder.state).toBe('configured');
    });
  });

  describe('close', () => {
    it('should close the encoder', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });
      encoder.close();
      expect(encoder.state).toBe('closed');
    });

    it('should throw when configuring after close', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });
      encoder.close();
      expect(() => {
        encoder!.configure({
          codec: 'vp8',
          width: 640,
          height: 480,
        });
      }).toThrow();
    });
  });

  describe('reset', () => {
    it('should reset to unconfigured state', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      encoder = new VideoEncoder({
        output: () => {},
        error: () => {},
      });
      encoder.configure({
        codec: 'vp8',
        width: 640,
        height: 480,
        bitrate: 1_000_000,
        framerate: 30,
      });
      encoder.reset();
      expect(encoder.state).toBe('unconfigured');
    });
  });
});

describe('VideoDecoder', () => {
  let decoder: InstanceType<typeof VideoDecoder> | null = null;

  afterEach(() => {
    if (decoder && decoder.state !== 'closed') {
      decoder.close();
    }
    decoder = null;
  });

  describe('isConfigSupported', () => {
    it('should have static isConfigSupported method', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      expect(typeof VideoDecoder.isConfigSupported).toBe('function');
    });

    it('should support VP8 codec', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const config = { codec: 'vp8' };
      const support = await VideoDecoder.isConfigSupported(config);
      expect(support).toHaveProperty('supported');
    });
  });

  describe('constructor', () => {
    it('should create a VideoDecoder instance', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });
      expect(decoder).toBeInstanceOf(VideoDecoder);
    });

    it('should start in unconfigured state', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });
      expect(decoder.state).toBe('unconfigured');
    });

    it('should have decodeQueueSize property', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });
      expect(typeof decoder.decodeQueueSize).toBe('number');
      expect(decoder.decodeQueueSize).toBe(0);
    });
  });

  describe('configure', () => {
    it('should configure with valid VP8 config', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });
      decoder.configure({ codec: 'vp8' });
      expect(decoder.state).toBe('configured');
    });
  });

  describe('close', () => {
    it('should close the decoder', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });
      decoder.close();
      expect(decoder.state).toBe('closed');
    });
  });

  describe('reset', () => {
    it('should reset to unconfigured state', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      decoder = new VideoDecoder({
        output: () => {},
        error: () => {},
      });
      decoder.configure({ codec: 'vp8' });
      decoder.reset();
      expect(decoder.state).toBe('unconfigured');
    });
  });
});

describe('AudioEncoder', () => {
  let encoder: InstanceType<typeof AudioEncoder> | null = null;

  afterEach(() => {
    if (encoder && encoder.state !== 'closed') {
      encoder.close();
    }
    encoder = null;
  });

  describe('isConfigSupported', () => {
    it('should have static isConfigSupported method', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      expect(typeof AudioEncoder.isConfigSupported).toBe('function');
    });

    it('should support Opus codec', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const config = {
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      };
      const support = await AudioEncoder.isConfigSupported(config);
      expect(support).toHaveProperty('supported');
    });
  });

  describe('constructor', () => {
    it('should create an AudioEncoder instance', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });
      expect(encoder).toBeInstanceOf(AudioEncoder);
    });

    it('should start in unconfigured state', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });
      expect(encoder.state).toBe('unconfigured');
    });
  });

  describe('configure', () => {
    it('should configure with valid Opus config', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });
      encoder.configure({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      });
      expect(encoder.state).toBe('configured');
    });
  });

  describe('close', () => {
    it('should close the encoder', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      encoder = new AudioEncoder({
        output: () => {},
        error: () => {},
      });
      encoder.close();
      expect(encoder.state).toBe('closed');
    });
  });
});

describe('AudioDecoder', () => {
  let decoder: InstanceType<typeof AudioDecoder> | null = null;

  afterEach(() => {
    if (decoder && decoder.state !== 'closed') {
      decoder.close();
    }
    decoder = null;
  });

  describe('isConfigSupported', () => {
    it('should have static isConfigSupported method', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      expect(typeof AudioDecoder.isConfigSupported).toBe('function');
    });

    it('should support Opus codec', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const config = {
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
      };
      const support = await AudioDecoder.isConfigSupported(config);
      expect(support).toHaveProperty('supported');
    });
  });

  describe('constructor', () => {
    it('should create an AudioDecoder instance', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });
      expect(decoder).toBeInstanceOf(AudioDecoder);
    });

    it('should start in unconfigured state', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });
      expect(decoder.state).toBe('unconfigured');
    });
  });

  describe('close', () => {
    it('should close the decoder', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      decoder = new AudioDecoder({
        output: () => {},
        error: () => {},
      });
      decoder.close();
      expect(decoder.state).toBe('closed');
    });
  });
});

describe('EncodedVideoChunk', () => {
  describe('constructor', () => {
    it('should be a constructor function', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      expect(typeof EncodedVideoChunk).toBe('function');
    });

    it('should create an EncodedVideoChunk', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const data = new Uint8Array([0, 0, 0, 1, 0x67]);
      const chunk = new EncodedVideoChunk({
        type: 'key',
        timestamp: 0,
        data: data,
      });

      expect(chunk.type).toBe('key');
      expect(chunk.timestamp).toBe(0);
      expect(chunk.byteLength).toBe(5);
    });

    it('should support delta frames', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const data = new Uint8Array([0, 0, 0, 1, 0x61]);
      const chunk = new EncodedVideoChunk({
        type: 'delta',
        timestamp: 33333,
        data: data,
      });

      expect(chunk.type).toBe('delta');
      expect(chunk.timestamp).toBe(33333);
    });

    it('should support duration', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const data = new Uint8Array([0, 0, 0, 1, 0x67]);
      const chunk = new EncodedVideoChunk({
        type: 'key',
        timestamp: 0,
        duration: 33333,
        data: data,
      });

      expect(chunk.duration).toBe(33333);
    });
  });

  describe('copyTo', () => {
    it('should copy data to a buffer', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const data = new Uint8Array([0, 0, 0, 1, 0x67]);
      const chunk = new EncodedVideoChunk({
        type: 'key',
        timestamp: 0,
        data: data,
      });

      const buffer = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buffer);

      expect(buffer).toEqual(data);
    });
  });
});

describe('EncodedAudioChunk', () => {
  describe('constructor', () => {
    it('should be a constructor function', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      expect(typeof EncodedAudioChunk).toBe('function');
    });

    it('should create an EncodedAudioChunk', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const data = new Uint8Array([0xff, 0xf1, 0x50, 0x80]);
      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: 0,
        data: data,
      });

      expect(chunk.type).toBe('key');
      expect(chunk.timestamp).toBe(0);
      expect(chunk.byteLength).toBe(4);
    });
  });
});

describe('AudioData', () => {
  describe('constructor', () => {
    it('should be a constructor function', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      expect(typeof AudioData).toBe('function');
    });

    it('should create AudioData from raw samples', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const samples = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        samples[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
      }

      const audioData = new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfFrames: 1024,
        numberOfChannels: 1,
        timestamp: 0,
        data: samples,
      });

      expect(audioData.format).toBe('f32');
      expect(audioData.sampleRate).toBe(48000);
      expect(audioData.numberOfFrames).toBe(1024);
      expect(audioData.numberOfChannels).toBe(1);
      expect(audioData.timestamp).toBe(0);

      audioData.close();
    });
  });

  describe('properties', () => {
    it('should have duration property', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const samples = new Float32Array(48000);
      const audioData = new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfFrames: 48000,
        numberOfChannels: 1,
        timestamp: 0,
        data: samples,
      });

      expect(audioData.duration).toBe(1_000_000); // 1 second in microseconds

      audioData.close();
    });
  });
});

describe('ImageDecoder', () => {
  describe('isTypeSupported', () => {
    it('should have static isTypeSupported method', () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      expect(typeof ImageDecoder.isTypeSupported).toBe('function');
    });

    it('should support common image types', async () => {
      if (!isWebCodecsAvailable()) {
        expect.fail('WebCodecs API not available');
      }
      const pngSupport = await ImageDecoder.isTypeSupported('image/png');
      const jpegSupport = await ImageDecoder.isTypeSupported('image/jpeg');

      // At least PNG and JPEG should be supported
      expect(pngSupport || jpegSupport).toBe(true);
    });
  });
});
