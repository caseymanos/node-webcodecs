/**
 * AudioData - Represents a segment of audio data
 * Implements the W3C WebCodecs AudioData interface
 */

import { BufferSource, DOMException } from './types';

export type AudioSampleFormat =
  | 'u8'
  | 's16'
  | 's32'
  | 'f32'
  | 'u8-planar'
  | 's16-planar'
  | 's32-planar'
  | 'f32-planar';

export interface AudioDataInit {
  format: AudioSampleFormat;
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  timestamp: number;  // microseconds
  data: BufferSource;
}

export interface AudioDataCopyToOptions {
  planeIndex: number;
  frameOffset?: number;
  frameCount?: number;
  format?: AudioSampleFormat;
}

// Load native addon
import { native } from './native';

/**
 * Get bytes per sample for a given format
 */
function getBytesPerSample(format: AudioSampleFormat): number {
  switch (format) {
    case 'u8':
    case 'u8-planar':
      return 1;
    case 's16':
    case 's16-planar':
      return 2;
    case 's32':
    case 's32-planar':
    case 'f32':
    case 'f32-planar':
      return 4;
    default:
      return 4;
  }
}

/**
 * Check if format is planar
 */
function isPlanar(format: AudioSampleFormat): boolean {
  return format.endsWith('-planar');
}

export class AudioData {
  private _native: any;
  private _closed: boolean = false;
  private _buffer: Uint8Array | null = null;

  private _format: AudioSampleFormat | null;
  private _sampleRate: number;
  private _numberOfFrames: number;
  private _numberOfChannels: number;
  private _duration: number;  // microseconds
  private _timestamp: number;

  // Per WebCodecs spec, after close() these should return null/0
  get format(): AudioSampleFormat | null {
    return this._closed ? null : this._format;
  }
  get sampleRate(): number {
    return this._closed ? 0 : this._sampleRate;
  }
  get numberOfFrames(): number {
    return this._closed ? 0 : this._numberOfFrames;
  }
  get numberOfChannels(): number {
    return this._closed ? 0 : this._numberOfChannels;
  }
  get duration(): number {
    return this._closed ? 0 : this._duration;
  }
  get timestamp(): number {
    return this._closed ? 0 : this._timestamp;
  }

  constructor(init: AudioDataInit) {
    if (!init.format) {
      throw new TypeError('format is required');
    }
    if (!init.sampleRate || init.sampleRate <= 0) {
      throw new TypeError('sampleRate must be positive');
    }
    if (!init.numberOfFrames || init.numberOfFrames <= 0) {
      throw new TypeError('numberOfFrames must be positive');
    }
    if (!init.numberOfChannels || init.numberOfChannels <= 0) {
      throw new TypeError('numberOfChannels must be positive');
    }
    if (init.timestamp === undefined) {
      throw new TypeError('timestamp is required');
    }
    if (!init.data) {
      throw new TypeError('data is required');
    }

    // Convert BufferSource to Uint8Array
    let buffer: Uint8Array;
    if (init.data instanceof ArrayBuffer) {
      buffer = new Uint8Array(init.data);
    } else {
      buffer = new Uint8Array(
        (init.data as ArrayBufferView).buffer,
        (init.data as ArrayBufferView).byteOffset,
        (init.data as ArrayBufferView).byteLength
      );
    }

    // Store buffer copy
    this._buffer = new Uint8Array(buffer);

    // Try to create native audio data if available
    if (native) {
      try {
        this._native = native.createAudioData(
          Buffer.from(buffer),
          init.format,
          init.sampleRate,
          init.numberOfFrames,
          init.numberOfChannels,
          init.timestamp
        );
      } catch {
        this._native = null;
      }
    }

    this._format = init.format;
    this._sampleRate = init.sampleRate;
    this._numberOfFrames = init.numberOfFrames;
    this._numberOfChannels = init.numberOfChannels;
    this._timestamp = init.timestamp;
    // Duration in microseconds: (frames / sampleRate) * 1,000,000
    this._duration = Math.floor((init.numberOfFrames / init.sampleRate) * 1_000_000);
  }

  /**
   * Calculate the size in bytes needed to hold the audio data for a plane
   */
  allocationSize(options: AudioDataCopyToOptions): number {
    this._assertNotClosed();

    const frameOffset = options.frameOffset ?? 0;
    const frameCount = options.frameCount ?? (this.numberOfFrames - frameOffset);
    const format = options.format ?? this.format;

    if (!format) {
      throw new DOMException('No format available', 'InvalidStateError');
    }

    const bytesPerSample = getBytesPerSample(format);

    if (isPlanar(format)) {
      // Planar format: each plane contains samples for one channel
      return frameCount * bytesPerSample;
    } else {
      // Interleaved format: all channels in one plane
      return frameCount * this.numberOfChannels * bytesPerSample;
    }
  }

  /**
   * Copy audio data to a destination buffer
   */
  copyTo(destination: BufferSource, options: AudioDataCopyToOptions): void {
    this._assertNotClosed();

    if (options.planeIndex < 0) {
      throw new RangeError('planeIndex must be non-negative');
    }

    const format = options.format ?? this.format;
    if (!format) {
      throw new DOMException('No format available', 'InvalidStateError');
    }

    // Validate plane index
    if (isPlanar(format)) {
      if (options.planeIndex >= this.numberOfChannels) {
        throw new RangeError(`planeIndex ${options.planeIndex} out of range for ${this.numberOfChannels} channels`);
      }
    } else {
      if (options.planeIndex !== 0) {
        throw new RangeError('planeIndex must be 0 for interleaved formats');
      }
    }

    let dest: Uint8Array;
    if (destination instanceof ArrayBuffer) {
      dest = new Uint8Array(destination);
    } else {
      dest = new Uint8Array(
        (destination as ArrayBufferView).buffer,
        (destination as ArrayBufferView).byteOffset,
        (destination as ArrayBufferView).byteLength
      );
    }

    if (this._native) {
      this._native.copyTo(Buffer.from(dest.buffer, dest.byteOffset, dest.byteLength), options);
    } else if (this._buffer) {
      // Simple copy - assumes same format
      const frameOffset = options.frameOffset ?? 0;
      const frameCount = options.frameCount ?? (this.numberOfFrames - frameOffset);
      const bytesPerSample = getBytesPerSample(format);

      if (isPlanar(format)) {
        const planeSize = this.numberOfFrames * bytesPerSample;
        const srcOffset = options.planeIndex * planeSize + frameOffset * bytesPerSample;
        const copySize = frameCount * bytesPerSample;
        dest.set(this._buffer.subarray(srcOffset, srcOffset + copySize));
      } else {
        const srcOffset = frameOffset * this.numberOfChannels * bytesPerSample;
        const copySize = frameCount * this.numberOfChannels * bytesPerSample;
        dest.set(this._buffer.subarray(srcOffset, srcOffset + copySize));
      }
    }
  }

  /**
   * Create a clone of this audio data
   */
  clone(): AudioData {
    this._assertNotClosed();

    if (!this._buffer || !this.format) {
      throw new DOMException('Cannot clone AudioData without data', 'InvalidStateError');
    }

    return new AudioData({
      format: this.format,
      sampleRate: this.sampleRate,
      numberOfFrames: this.numberOfFrames,
      numberOfChannels: this.numberOfChannels,
      timestamp: this.timestamp,
      data: new Uint8Array(this._buffer),
    });
  }

  /**
   * Close the audio data and release resources
   */
  close(): void {
    if (!this._closed) {
      if (this._native) {
        this._native.close();
        this._native = null;
      }
      this._buffer = null;
      this._closed = true;
    }
  }

  private _assertNotClosed(): void {
    if (this._closed) {
      throw new DOMException('AudioData is closed', 'InvalidStateError');
    }
  }
}
