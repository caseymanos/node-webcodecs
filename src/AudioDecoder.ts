/**
 * AudioDecoder - Decodes encoded audio data to AudioData
 * Implements the W3C WebCodecs AudioDecoder interface
 */

import { AudioData, AudioDataInit, AudioSampleFormat } from './AudioData';
import { EncodedAudioChunk } from './EncodedAudioChunk';
import { isAudioCodecSupported, getFFmpegAudioDecoder, parseAacCodecString } from './codec-registry';
import { CodecState, DOMException, BufferSource } from './types';

export interface AudioDecoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: BufferSource;
}

export interface AudioDecoderInit {
  output: (data: AudioData) => void;
  error: (error: DOMException) => void;
}

export interface AudioDecoderSupport {
  supported: boolean;
  config: AudioDecoderConfig;
}

// Load native addon
import { native } from './native';

export class AudioDecoder {
  private _native: any;
  private _state: CodecState = 'unconfigured';
  private _outputCallback: (data: AudioData) => void;
  private _errorCallback: (error: DOMException) => void;
  private _decodeQueueSize: number = 0;
  private _config: AudioDecoderConfig | null = null;
  private _ondequeue: ((event: Event) => void) | null = null;
  private _listeners: Map<string, Set<() => void>> = new Map();

  static async isConfigSupported(config: AudioDecoderConfig): Promise<AudioDecoderSupport> {
    const supported = isAudioCodecSupported(config.codec);
    return { supported, config };
  }

  constructor(init: AudioDecoderInit) {
    if (!init.output || typeof init.output !== 'function') {
      throw new TypeError('output callback is required');
    }
    if (!init.error || typeof init.error !== 'function') {
      throw new TypeError('error callback is required');
    }

    this._outputCallback = init.output;
    this._errorCallback = init.error;

    if (native) {
      this._native = new native.AudioDecoderNative(
        this._onData.bind(this),
        this._onError.bind(this)
      );
    }
  }

  get state(): CodecState {
    return this._state;
  }

  get decodeQueueSize(): number {
    return this._decodeQueueSize;
  }

  /**
   * Event handler for dequeue events
   */
  get ondequeue(): ((event: Event) => void) | null {
    return this._ondequeue;
  }

  set ondequeue(handler: ((event: Event) => void) | null) {
    this._ondequeue = handler;
  }

  /**
   * Minimal EventTarget-style API for 'dequeue' events.
   * Enables compatibility with MediaBunny and browser WebCodecs code.
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
    // Call the ondequeue handler if it exists
    if (type === 'dequeue' && this._ondequeue) {
      try {
        this._ondequeue(new Event('dequeue'));
      } catch {
        // Swallow handler errors
      }
    }

    // Call registered listeners
    const set = this._listeners.get(type);
    if (set) {
      for (const listener of set) {
        try {
          listener();
        } catch {
          // Swallow handler errors
        }
      }
    }
  }

  configure(config: AudioDecoderConfig): void {
    if (this._state === 'closed') {
      throw new DOMException('Decoder is closed', 'InvalidStateError');
    }

    if (!isAudioCodecSupported(config.codec)) {
      throw new DOMException(`Unsupported codec: ${config.codec}`, 'NotSupportedError');
    }

    if (!native) {
      throw new DOMException('Native addon not available', 'NotSupportedError');
    }

    const ffmpegCodec = getFFmpegAudioDecoder(config.codec);
    const codecParams: any = {
      codec: ffmpegCodec,
      sampleRate: config.sampleRate,
      channels: config.numberOfChannels,
    };

    if (config.description) {
      let desc: Uint8Array;
      if (config.description instanceof ArrayBuffer) {
        desc = new Uint8Array(config.description);
      } else {
        desc = new Uint8Array(
          (config.description as ArrayBufferView).buffer,
          (config.description as ArrayBufferView).byteOffset,
          (config.description as ArrayBufferView).byteLength
        );
      }
      codecParams.extradata = Buffer.from(desc);
    }

    this._native.configure(codecParams);
    this._config = config;
    this._state = 'configured';
  }

  decode(chunk: EncodedAudioChunk): void {
    if (this._state !== 'configured') {
      throw new DOMException('Decoder is not configured', 'InvalidStateError');
    }

    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);

    this._decodeQueueSize++;

    // Call native decode synchronously
    this._native.decode(
      Buffer.from(data),
      chunk.type === 'key',
      chunk.timestamp,
      chunk.duration ?? 0
    );
  }

  async flush(): Promise<void> {
    if (this._state !== 'configured') {
      throw new DOMException('Decoder is not configured', 'InvalidStateError');
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
      throw new DOMException('Decoder is closed', 'InvalidStateError');
    }

    if (this._native) {
      this._native.reset();
    }
    this._decodeQueueSize = 0;
    this._state = 'unconfigured';
    this._config = null;
  }

  close(): void {
    if (this._state === 'closed') return;

    if (this._native) {
      this._native.close();
    }
    this._state = 'closed';
    this._decodeQueueSize = 0;
    this._config = null;
  }

  private _onData(
    buffer: Float32Array,
    format: string,
    sampleRate: number,
    numberOfFrames: number,
    numberOfChannels: number,
    timestamp: number
  ): void {
    // Copy buffer data immediately since native buffer may be recycled
    const bufferCopy = new Uint8Array(buffer);

    // Defer callback to ensure decodeQueueSize > 0 when decode() returns
    // Use setImmediate to allow the event loop to process the listener registration
    setImmediate(() => {
      this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);

      // Dispatch dequeue event
      this._dispatchEvent('dequeue');

      try {
        const audioData = new AudioData({
          format: format as AudioSampleFormat,
          sampleRate,
          numberOfFrames,
          numberOfChannels,
          timestamp,
          data: bufferCopy.buffer as ArrayBuffer,
        });

        this._outputCallback(audioData);
      } catch (e) {
        console.error('AudioDecoder output callback error:', e);
      }
    });
  }

  private _onError(message: string): void {
    try {
      this._errorCallback(new DOMException(message, 'EncodingError') as any);
    } catch (e) {
      // Don't propagate callback errors
    }
  }
}
