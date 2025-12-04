/**
 * VideoDecoder - Decodes encoded video data to VideoFrame
 * Implements the W3C WebCodecs VideoDecoder interface
 */

import { VideoFrame, VideoFrameBufferInit } from './VideoFrame';
import { EncodedVideoChunk } from './EncodedVideoChunk';
import { isVideoCodecSupported, getFFmpegVideoDecoder, parseAvcCodecString } from './codec-registry';
import { CodecState, DOMException, BufferSource } from './types';

export interface VideoDecoderConfig {
  codec: string;
  codedWidth?: number;
  codedHeight?: number;
  displayAspectWidth?: number;
  displayAspectHeight?: number;
  colorSpace?: {
    primaries?: string;
    transfer?: string;
    matrix?: string;
    fullRange?: boolean;
  };
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  optimizeForLatency?: boolean;
  description?: BufferSource;  // Codec-specific data (e.g., AVCC for H.264)
  /**
   * Use async (non-blocking) decoder. Defaults to true.
   * Set to false to use synchronous decoder (blocks event loop during decoding).
   */
  useWorkerThread?: boolean;
}

export interface VideoDecoderInit {
  output: (frame: VideoFrame) => void;
  error: (error: DOMException) => void;
}

export interface VideoDecoderSupport {
  supported: boolean;
  config: VideoDecoderConfig;
}

// Load native addon
import { native } from './native';

export class VideoDecoder {
  private _native: any;
  private _state: CodecState = 'unconfigured';
  private _outputCallback: (frame: VideoFrame) => void;
  private _errorCallback: (error: DOMException) => void;
  private _decodeQueueSize: number = 0;
  private _config: VideoDecoderConfig | null = null;
  private _listeners: Map<string, Set<() => void>> = new Map();
  private _useAsync: boolean = true;
  private _nativeCreated: boolean = false;
  private _ondequeue: ((event: Event) => void) | null = null;

  static async isConfigSupported(config: VideoDecoderConfig): Promise<VideoDecoderSupport> {
    // Basic validation first
    if (!config.codec) {
      return { supported: false, config };
    }

    // Check codec string format
    if (!isVideoCodecSupported(config.codec)) {
      return { supported: false, config };
    }

    // If native probing is available, use it to actually test codec support
    if (native?.CapabilityProbe?.probeVideoDecoder) {
      try {
        const ffmpegCodec = getFFmpegVideoDecoder(config.codec);
        const result = native.CapabilityProbe.probeVideoDecoder({
          codec: ffmpegCodec,
          width: config.codedWidth || 1920,
          height: config.codedHeight || 1080,
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

  constructor(init: VideoDecoderInit) {
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

  configure(config: VideoDecoderConfig): void {
    if (this._state === 'closed') {
      throw new DOMException('Decoder is closed', 'InvalidStateError');
    }

    if (!isVideoCodecSupported(config.codec)) {
      throw new DOMException(`Unsupported codec: ${config.codec}`, 'NotSupportedError');
    }

    if (!native) {
      throw new DOMException('Native addon not available', 'NotSupportedError');
    }

    // Determine whether to use async (non-blocking) decoder
    // Default to async unless explicitly disabled
    this._useAsync = config.useWorkerThread !== false && !!native.VideoDecoderAsync;

    // Create native decoder if not already created
    if (!this._nativeCreated) {
      if (this._useAsync) {
        this._native = new native.VideoDecoderAsync(
          this._onFrame.bind(this),
          this._onError.bind(this)
        );
      } else {
        this._native = new native.VideoDecoderNative(
          this._onFrame.bind(this),
          this._onError.bind(this)
        );
      }
      this._nativeCreated = true;
    }

    const ffmpegCodec = getFFmpegVideoDecoder(config.codec);
    const codecParams: any = { codec: ffmpegCodec };

    // Parse H.264 codec string for profile/level
    if (config.codec.startsWith('avc1.')) {
      const avcInfo = parseAvcCodecString(config.codec);
      if (avcInfo) {
        codecParams.profile = avcInfo.profile;
        codecParams.level = avcInfo.level;
      }
    }

    if (config.codedWidth) codecParams.width = config.codedWidth;
    if (config.codedHeight) codecParams.height = config.codedHeight;

    if (config.description) {
      // Convert BufferSource to Buffer
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

  decode(chunk: EncodedVideoChunk): void {
    if (this._state !== 'configured') {
      throw new DOMException('Decoder is not configured', 'InvalidStateError');
    }

    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);

    this._decodeQueueSize++;
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

  private _onFrame(nativeFrame: any, timestamp: number, duration: number): void {
    this._decodeQueueSize = Math.max(0, this._decodeQueueSize - 1);
    this._dispatchEvent('dequeue');

    try {
      // Get frame info from native
      const width = nativeFrame.width;
      const height = nativeFrame.height;
      const format = nativeFrame.format || 'I420';

      // Get the data from the native frame
      const size = nativeFrame.allocationSize();
      const buffer = Buffer.alloc(size);
      nativeFrame.copyTo(buffer);

      // Create VideoFrame
      const frame = new VideoFrame(buffer, {
        format: format,
        codedWidth: width,
        codedHeight: height,
        timestamp: timestamp,
        duration: duration > 0 ? duration : undefined,
      } as VideoFrameBufferInit);

      this._outputCallback(frame);
    } catch (e) {
      // Don't propagate callback errors, but report as error
      console.error('VideoDecoder output callback error:', e);
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
