/**
 * VideoEncoder - Encodes VideoFrame to encoded video data
 * Implements the W3C WebCodecs VideoEncoder interface
 */

import { VideoFrame } from './VideoFrame';
import { EncodedVideoChunk, EncodedVideoChunkType } from './EncodedVideoChunk';
import { isVideoCodecSupported, getFFmpegVideoCodec, parseAvcCodecString } from './codec-registry';
import { CodecState, DOMException } from './types';
import { VideoColorSpaceInit } from './VideoColorSpace';

export type LatencyMode = 'quality' | 'realtime';
export type BitrateMode = 'constant' | 'variable' | 'quantizer';
export type AlphaOption = 'discard' | 'keep';

export interface VideoEncoderConfig {
  codec: string;
  width: number;
  height: number;
  displayWidth?: number;
  displayHeight?: number;
  bitrate?: number;
  framerate?: number;
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  alpha?: AlphaOption;
  scalabilityMode?: string;
  bitrateMode?: BitrateMode;
  latencyMode?: LatencyMode;
  colorSpace?: VideoColorSpaceInit;
  avc?: {
    format?: 'annexb' | 'avc';
  };
  /**
   * Use async (non-blocking) encoder. Defaults to true.
   * Set to false to use synchronous encoder (blocks event loop during encoding).
   */
  useWorkerThread?: boolean;
}

export interface VideoEncoderInit {
  output: (chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata) => void;
  error: (error: DOMException) => void;
}

export interface VideoEncoderOutputMetadata {
  decoderConfig?: {
    codec: string;
    codedWidth: number;
    codedHeight: number;
    description?: ArrayBuffer;
  };
  svc?: {
    temporalLayerId: number;
  };
}

export interface VideoEncoderEncodeOptions {
  keyFrame?: boolean;
}

export interface VideoEncoderSupport {
  supported: boolean;
  config: VideoEncoderConfig;
}

// Load native addon
import { native } from './native';

export class VideoEncoder {
  private _native: any;
  private _state: CodecState = 'unconfigured';
  private _outputCallback: (chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata) => void;
  private _errorCallback: (error: DOMException) => void;
  private _encodeQueueSize: number = 0;
  private _config: VideoEncoderConfig | null = null;
  private _sentDecoderConfig: boolean = false;
  private _listeners: Map<string, Set<() => void>> = new Map();
  private _useAsync: boolean = true;
  private _nativeCreated: boolean = false;

  static async isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
    // Basic validation first
    if (!config.codec || config.width <= 0 || config.height <= 0) {
      return { supported: false, config };
    }

    // Check codec string format
    if (!isVideoCodecSupported(config.codec)) {
      return { supported: false, config };
    }

    // If native probing is available, use it to actually test codec support
    if (native?.CapabilityProbe?.probeVideoEncoder) {
      try {
        const ffmpegCodec = getFFmpegVideoCodec(config.codec);
        const result = native.CapabilityProbe.probeVideoEncoder({
          codec: ffmpegCodec,
          width: config.width,
          height: config.height,
          hardwareAcceleration: config.hardwareAcceleration || 'no-preference',
        });

        return {
          supported: result.supported,
          config,
        };
      } catch {
        // Fall back to basic check on error
      }
    }

    // Fallback to basic string check
    return { supported: true, config };
  }

  constructor(init: VideoEncoderInit) {
    if (!init.output || typeof init.output !== 'function') {
      throw new TypeError('output callback is required');
    }
    if (!init.error || typeof init.error !== 'function') {
      throw new TypeError('error callback is required');
    }

    this._outputCallback = init.output;
    this._errorCallback = init.error;

    // Defer native creation to configure() so we know whether to use async or sync
  }

  get state(): CodecState {
    return this._state;
  }

  get encodeQueueSize(): number {
    return this._encodeQueueSize;
  }

  /**
   * Minimal EventTarget-style API for 'dequeue' events.
   * Mediabunny uses encoder.addEventListener('dequeue', fn, { once: true }).
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

  configure(config: VideoEncoderConfig): void {
    if (this._state === 'closed') {
      throw new DOMException('Encoder is closed', 'InvalidStateError');
    }

    if (!isVideoCodecSupported(config.codec)) {
      throw new DOMException(`Unsupported codec: ${config.codec}`, 'NotSupportedError');
    }

    if (config.width <= 0 || config.height <= 0) {
      throw new DOMException('Invalid dimensions', 'NotSupportedError');
    }

    // Validate latencyMode
    if (config.latencyMode && !['quality', 'realtime'].includes(config.latencyMode)) {
      throw new DOMException(
        `Invalid latencyMode: ${config.latencyMode}. Must be 'quality' or 'realtime'.`,
        'TypeError'
      );
    }

    // Validate bitrateMode
    if (config.bitrateMode && !['constant', 'variable', 'quantizer'].includes(config.bitrateMode)) {
      throw new DOMException(
        `Invalid bitrateMode: ${config.bitrateMode}. Must be 'constant', 'variable', or 'quantizer'.`,
        'TypeError'
      );
    }

    if (!native) {
      throw new DOMException('Native addon not available', 'NotSupportedError');
    }

    // Determine whether to use async (non-blocking) encoder
    // Default to async unless explicitly disabled
    this._useAsync = config.useWorkerThread !== false && !!native.VideoEncoderAsync;

    // Create native encoder if not already created, or if switching mode
    if (!this._nativeCreated) {
      if (this._useAsync) {
        this._native = new native.VideoEncoderAsync(
          this._onChunk.bind(this),
          this._onError.bind(this)
        );
      } else {
        this._native = new native.VideoEncoderNative(
          this._onChunk.bind(this),
          this._onError.bind(this)
        );
      }
      this._nativeCreated = true;
    }

    const ffmpegCodec = getFFmpegVideoCodec(config.codec);
    const codecParams: any = {
      codec: ffmpegCodec,
      width: config.width,
      height: config.height,
    };

    // Parse H.264 codec string for profile/level
    if (config.codec.startsWith('avc1.')) {
      const avcInfo = parseAvcCodecString(config.codec);
      if (avcInfo) {
        codecParams.profile = avcInfo.profile;
        codecParams.level = avcInfo.level;
      }
      codecParams.avcFormat = config.avc?.format ?? 'annexb';
    }

    if (config.bitrate) codecParams.bitrate = config.bitrate;
    if (config.framerate) codecParams.framerate = config.framerate;
    if (config.bitrateMode) codecParams.bitrateMode = config.bitrateMode;
    if (config.latencyMode) codecParams.latencyMode = config.latencyMode;
    if (config.colorSpace) codecParams.colorSpace = config.colorSpace;
    if (config.hardwareAcceleration) codecParams.hardwareAcceleration = config.hardwareAcceleration;
    if (config.alpha) codecParams.alpha = config.alpha;
    if (config.scalabilityMode) codecParams.scalabilityMode = config.scalabilityMode;

    this._native.configure(codecParams);
    this._config = config;
    this._state = 'configured';
    this._sentDecoderConfig = false;
  }

  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void {
    if (this._state !== 'configured') {
      throw new DOMException('Encoder is not configured', 'InvalidStateError');
    }

    const nativeFrame = frame._getNative();
    if (!nativeFrame) {
      throw new DOMException('VideoFrame has no native handle', 'InvalidStateError');
    }

    const keyFrame = options?.keyFrame ?? false;

    this._encodeQueueSize++;
    this._native.encode(nativeFrame, frame.timestamp, keyFrame);
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

  private _onChunk(data: Uint8Array, isKeyframe: boolean, timestamp: number, duration: number, extradata?: Uint8Array): void {
    this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
    this._dispatchEvent('dequeue');

    const chunk = new EncodedVideoChunk({
      type: isKeyframe ? 'key' : 'delta',
      timestamp,
      duration: duration > 0 ? duration : undefined,
      data,
    });

    let metadata: VideoEncoderOutputMetadata | undefined;

    // Send decoder config with first keyframe
    if (isKeyframe && !this._sentDecoderConfig && this._config) {
      metadata = {
        decoderConfig: {
          codec: this._config.codec,
          codedWidth: this._config.width,
          codedHeight: this._config.height,
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
