/**
 * AudioEncoder - Encodes AudioData to encoded audio data
 * Implements the W3C WebCodecs AudioEncoder interface
 */

import { AudioData } from './AudioData';
import { EncodedAudioChunk } from './EncodedAudioChunk';
import { isAudioCodecSupported, getFFmpegAudioCodec } from './codec-registry';
import { CodecState, DOMException } from './types';

export type AudioBitrateMode = 'constant' | 'variable';

export interface AudioEncoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate?: number;
  bitrateMode?: AudioBitrateMode;
}

export interface AudioEncoderInit {
  output: (chunk: EncodedAudioChunk, metadata?: AudioEncoderOutputMetadata) => void;
  error: (error: DOMException) => void;
}

export interface AudioEncoderOutputMetadata {
  decoderConfig?: {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
    description?: ArrayBuffer;
  };
}

export interface AudioEncoderSupport {
  supported: boolean;
  config: AudioEncoderConfig;
}

// Load native addon
import { native } from './native';

export class AudioEncoder {
  private _native: any;
  private _state: CodecState = 'unconfigured';
  private _outputCallback: (chunk: EncodedAudioChunk, metadata?: AudioEncoderOutputMetadata) => void;
  private _errorCallback: (error: DOMException) => void;
  private _encodeQueueSize: number = 0;
  private _config: AudioEncoderConfig | null = null;
  private _sentDecoderConfig: boolean = false;
  private _listeners: Map<string, Set<() => void>> = new Map();

  static async isConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport> {
    const supported = isAudioCodecSupported(config.codec) &&
                      config.sampleRate > 0 &&
                      config.numberOfChannels > 0;
    return { supported, config };
  }

  constructor(init: AudioEncoderInit) {
    if (!init.output || typeof init.output !== 'function') {
      throw new TypeError('output callback is required');
    }
    if (!init.error || typeof init.error !== 'function') {
      throw new TypeError('error callback is required');
    }

    this._outputCallback = init.output;
    this._errorCallback = init.error;

    if (native) {
      this._native = new native.AudioEncoderNative(
        this._onChunk.bind(this),
        this._onError.bind(this)
      );
    }
  }

  get state(): CodecState {
    return this._state;
  }

  get encodeQueueSize(): number {
    return this._encodeQueueSize;
  }

  /**
   * Minimal EventTarget-style API for 'dequeue' events, mirroring VideoEncoder.
   */
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void {
    if (typeof listener !== 'function') return;

    const once = !!(options && (options as any).once);
    const wrapper = once
      ? () => {
          this.removeEventListener(type, wrapper);
          listener();
        }
      : listener;

    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(wrapper);
  }

  removeEventListener(type: string, listener: () => void): void {
    const set = this._listeners.get(type);
    if (!set) return;

    if (set.has(listener)) {
      set.delete(listener);
    }

    if (set.size === 0) {
      this._listeners.delete(type);
    }
  }

  private _dispatchEvent(type: string): void {
    const set = this._listeners.get(type);
    if (!set) return;

    for (const listener of Array.from(set)) {
      try {
        listener();
      } catch {
        // Swallow listener errors
      }
    }
  }

  configure(config: AudioEncoderConfig): void {
    if (this._state === 'closed') {
      throw new DOMException('Encoder is closed', 'InvalidStateError');
    }

    if (!isAudioCodecSupported(config.codec)) {
      throw new DOMException(`Unsupported codec: ${config.codec}`, 'NotSupportedError');
    }

    if (!native) {
      throw new DOMException('Native addon not available', 'NotSupportedError');
    }

    if (config.sampleRate <= 0 || config.numberOfChannels <= 0) {
      throw new DOMException('Invalid audio parameters', 'NotSupportedError');
    }

    const ffmpegCodec = getFFmpegAudioCodec(config.codec);
    const codecParams: any = {
      codec: ffmpegCodec,
      sampleRate: config.sampleRate,
      channels: config.numberOfChannels,
    };

    if (config.bitrate) codecParams.bitrate = config.bitrate;

    this._native.configure(codecParams);
    this._config = config;
    this._state = 'configured';
    this._sentDecoderConfig = false;
  }

  encode(data: AudioData): void {
    if (this._state !== 'configured') {
      throw new DOMException('Encoder is not configured', 'InvalidStateError');
    }

    // Get audio data buffer
    const bufferSize = data.allocationSize({ planeIndex: 0 });
    const buffer = new ArrayBuffer(bufferSize);
    data.copyTo(buffer, { planeIndex: 0 });

    this._encodeQueueSize++;
    this._native.encode(
      new Float32Array(buffer),
      data.format,
      data.sampleRate,
      data.numberOfFrames,
      data.numberOfChannels,
      data.timestamp
    );
  }

  async flush(): Promise<void> {
    if (this._state !== 'configured') {
      throw new DOMException('Encoder is not configured', 'InvalidStateError');
    }

    return new Promise((resolve, reject) => {
      this._native.flush((err: Error | null) => {
        if (err) {
          reject(new DOMException(err.message, 'EncodingError'));
        } else {
          resolve();
        }
      });
    });
  }

  reset(): void {
    if (this._state === 'closed') {
      throw new DOMException('Encoder is closed', 'InvalidStateError');
    }

    if (this._native) {
      this._native.reset();
    }
    this._encodeQueueSize = 0;
    this._state = 'unconfigured';
    this._sentDecoderConfig = false;
    this._config = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    if (this._native) {
      this._native.close();
    }
    this._state = 'closed';
    this._encodeQueueSize = 0;
    this._config = null;
  }

  private _onChunk(data: Uint8Array, timestamp: number, duration: number, extradata?: Uint8Array): void {
    this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
    this._dispatchEvent('dequeue');

    const chunk = new EncodedAudioChunk({
      type: 'key',  // Audio frames are typically all keyframes
      timestamp,
      duration: duration > 0 ? duration : undefined,
      data,
    });

    let metadata: AudioEncoderOutputMetadata | undefined;

    if (!this._sentDecoderConfig && this._config) {
      metadata = {
        decoderConfig: {
          codec: this._config.codec,
          sampleRate: this._config.sampleRate,
          numberOfChannels: this._config.numberOfChannels,
          description: extradata ? new Uint8Array(extradata).buffer as ArrayBuffer : undefined,
        },
      };
      this._sentDecoderConfig = true;
    }

    try {
      this._outputCallback(chunk, metadata);
    } catch (e) {
      // Don't propagate callback errors
    }
  }

  private _onError(message: string): void {
    try {
      this._errorCallback(new DOMException(message, 'EncodingError') as any);
    } catch (e) {
      // Don't propagate callback errors
    }
  }
}
