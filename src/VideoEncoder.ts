/**
 * VideoEncoder - Encodes VideoFrame to encoded video data
 * Implements the W3C WebCodecs VideoEncoder interface
 */

import { VideoFrame } from './VideoFrame';
import { EncodedVideoChunk, EncodedVideoChunkType } from './EncodedVideoChunk';
import { isVideoCodecSupported, getFFmpegVideoCodec, parseAvcCodecString } from './codec-registry';
import { CodecState, DOMException } from './types';
import { VideoColorSpaceInit } from './VideoColorSpace';

/**
 * Encoder latency mode
 * - `quality`: Optimize for compression ratio (slower)
 * - `realtime`: Optimize for encoding speed (lower latency)
 */
export type LatencyMode = 'quality' | 'realtime';

/**
 * Bitrate control mode
 * - `constant`: Constant bitrate (CBR)
 * - `variable`: Variable bitrate (VBR)
 * - `quantizer`: Constant quality (CQP)
 */
export type BitrateMode = 'constant' | 'variable' | 'quantizer';

/**
 * Alpha channel handling
 * - `discard`: Remove alpha channel
 * - `keep`: Preserve alpha channel (if codec supports it)
 */
export type AlphaOption = 'discard' | 'keep';

/**
 * VideoEncoder configuration options
 * @see https://w3c.github.io/webcodecs/#dictdef-videoencoderconfig
 */
export interface VideoEncoderConfig {
  /**
   * Codec string (e.g., 'avc1.42E01E', 'vp09.00.10.08', 'h264_videotoolbox')
   * Supports both WebCodecs MIME types and FFmpeg codec names
   * @example
   * ```ts
   * codec: 'avc1.42E01E'  // H.264 Baseline Level 3.0
   * codec: 'vp09.00.10.08'  // VP9 Profile 0
   * codec: 'h264_videotoolbox'  // macOS hardware encoder
   * codec: 'h264_nvenc'  // NVIDIA hardware encoder
   * ```
   */
  codec: string;

  /**
   * Frame width in pixels (must be > 0)
   */
  width: number;

  /**
   * Frame height in pixels (must be > 0)
   */
  height: number;

  /**
   * Display width in pixels (defaults to width)
   * Used for pixel aspect ratio correction
   */
  displayWidth?: number;

  /**
   * Display height in pixels (defaults to height)
   * Used for pixel aspect ratio correction
   */
  displayHeight?: number;

  /**
   * Target bitrate in bits per second
   * @example
   * ```ts
   * bitrate: 1_000_000  // 1 Mbps
   * bitrate: 5_000_000  // 5 Mbps
   * ```
   */
  bitrate?: number;

  /**
   * Target framerate in frames per second
   * @default 30
   */
  framerate?: number;

  /**
   * Hardware acceleration preference
   * - `no-preference`: Let encoder decide
   * - `prefer-hardware`: Use hardware encoder if available
   * - `prefer-software`: Use software encoder
   * @default 'no-preference'
   */
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';

  /**
   * Alpha channel handling (if codec supports transparency)
   */
  alpha?: AlphaOption;

  /**
   * Scalability mode for SVC/temporal layering
   * @example 'L1T2' (1 spatial layer, 2 temporal layers)
   */
  scalabilityMode?: string;

  /**
   * Bitrate control mode
   */
  bitrateMode?: BitrateMode;

  /**
   * Encoding latency optimization
   */
  latencyMode?: LatencyMode;

  /**
   * Color space metadata (primaries, transfer, matrix)
   */
  colorSpace?: VideoColorSpaceInit;

  /**
   * H.264/AVC specific options
   */
  avc?: {
    /**
     * Output format for H.264 bitstream
     * - `annexb`: Annex B format (start codes)
     * - `avc`: AVC format (length-prefixed NALUs)
     * @default 'annexb'
     */
    format?: 'annexb' | 'avc';
  };

  /**
   * Use async (non-blocking) encoder via worker thread
   * Set to false to use synchronous encoder (blocks event loop during encoding)
   * @default true
   */
  useWorkerThread?: boolean;
}

/**
 * VideoEncoder initialization callbacks
 * @see https://w3c.github.io/webcodecs/#dictdef-videoencoderinit
 */
export interface VideoEncoderInit {
  /**
   * Callback for encoded video chunks
   * @param chunk - Encoded video chunk (contains compressed data)
   * @param metadata - Optional metadata (decoder config on first keyframe)
   */
  output: (chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata) => void;

  /**
   * Callback for encoding errors
   * @param error - Error that occurred during encoding
   */
  error: (error: DOMException) => void;
}

/**
 * Metadata returned with encoded chunks
 * @see https://w3c.github.io/webcodecs/#dictdef-encodedvideochunkmetadata
 */
export interface VideoEncoderOutputMetadata {
  /**
   * Decoder configuration (sent with first keyframe)
   * Contains codec parameters needed to initialize a VideoDecoder
   */
  decoderConfig?: {
    /** Codec string (e.g., 'avc1.42E01E') */
    codec: string;
    /** Frame width in pixels */
    codedWidth: number;
    /** Frame height in pixels */
    codedHeight: number;
    /** Codec-specific extradata (e.g., H.264 SPS/PPS, VP9 CodecPrivate) */
    description?: ArrayBuffer;
    /** Color space information */
    colorSpace?: VideoColorSpaceInit;
  };

  /**
   * Scalable Video Coding metadata (if using SVC)
   */
  svc?: {
    /** Temporal layer ID (0 = base layer) */
    temporalLayerId: number;
  };
}

/**
 * Options for encoding a single frame
 * @see https://w3c.github.io/webcodecs/#dictdef-videoencoderencodeoptions
 */
export interface VideoEncoderEncodeOptions {
  /**
   * Force this frame to be a keyframe (I-frame)
   * Keyframes are independently decodable (no dependencies on other frames)
   * @default false
   * @example
   * ```ts
   * encoder.encode(frame, { keyFrame: true });  // Force keyframe
   * encoder.encode(frame, { keyFrame: i % 60 === 0 });  // Keyframe every 2s at 30fps
   * ```
   */
  keyFrame?: boolean;
}

/**
 * Result of codec support check
 * @see https://w3c.github.io/webcodecs/#dictdef-videoencodersupport
 */
export interface VideoEncoderSupport {
  /**
   * Whether the encoder configuration is supported
   */
  supported: boolean;

  /**
   * The configuration that was tested (may be modified/normalized)
   */
  config: VideoEncoderConfig;
}

// Load native addon
import { native } from './native';

/**
 * VideoEncoder encodes VideoFrame objects into EncodedVideoChunk objects
 *
 * This class implements the W3C WebCodecs VideoEncoder interface, providing
 * hardware-accelerated video encoding via FFmpeg.
 *
 * @example Basic Usage
 * ```ts
 * import { VideoEncoder, VideoFrame } from 'node-webcodecs';
 *
 * const encoder = new VideoEncoder({
 *   output: (chunk, metadata) => {
 *     console.log(`Encoded ${chunk.byteLength} bytes`);
 *     // Save chunk to file or stream
 *   },
 *   error: (err) => console.error('Encoding error:', err)
 * });
 *
 * encoder.configure({
 *   codec: 'avc1.42E01E',
 *   width: 1920,
 *   height: 1080,
 *   bitrate: 5_000_000
 * });
 *
 * const frame = new VideoFrame(buffer, {
 *   format: 'RGBA',
 *   codedWidth: 1920,
 *   codedHeight: 1080,
 *   timestamp: 0
 * });
 *
 * encoder.encode(frame);
 * frame.close();  // Important: prevent memory leaks
 *
 * await encoder.flush();
 * encoder.close();
 * ```
 *
 * @example Hardware Acceleration
 * ```ts
 * encoder.configure({
 *   codec: 'h264_videotoolbox',  // macOS VideoToolbox
 *   // codec: 'h264_nvenc',       // NVIDIA NVENC
 *   // codec: 'h264_qsv',         // Intel QuickSync
 *   width: 1920,
 *   height: 1080
 * });
 * ```
 *
 * @see https://w3c.github.io/webcodecs/#videoencoder
 */
export class VideoEncoder {
  private _native: any;
  private _state: CodecState = 'unconfigured';
  private _outputCallback: (chunk: EncodedVideoChunk, metadata?: VideoEncoderOutputMetadata) => void;
  private _errorCallback: (error: DOMException) => void;
  private _encodeQueueSize: number = 0;
  private _pendingCallbacks: number = 0;  // Track pending setImmediate callbacks
  private _config: VideoEncoderConfig | null = null;
  private _sentDecoderConfig: boolean = false;
  private _listeners: Map<string, Set<() => void>> = new Map();
  private _useAsync: boolean = true;
  private _nativeCreated: boolean = false;
  private _ondequeue: ((event: Event) => void) | null = null;

  /**
   * Check if a VideoEncoder configuration is supported
   *
   * Tests whether the specified codec and parameters can be encoded on this platform.
   * This method probes the native FFmpeg installation for codec availability.
   *
   * @param config - Configuration to test
   * @returns Promise resolving to support status and normalized config
   *
   * @example
   * ```ts
   * const result = await VideoEncoder.isConfigSupported({
   *   codec: 'avc1.42E01E',
   *   width: 1920,
   *   height: 1080
   * });
   *
   * if (result.supported) {
   *   console.log('H.264 encoding is supported');
   * } else {
   *   console.log('H.264 encoding is NOT supported');
   * }
   * ```
   *
   * @example Check hardware encoder
   * ```ts
   * const hwSupport = await VideoEncoder.isConfigSupported({
   *   codec: 'h264_videotoolbox',
   *   width: 3840,
   *   height: 2160,
   *   hardwareAcceleration: 'prefer-hardware'
   * });
   *
   * if (!hwSupport.supported) {
   *   // Fallback to software encoder
   *   encoder.configure({ codec: 'avc1.42E01E', ... });
   * }
   * ```
   */
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

  /**
   * Create a new VideoEncoder
   *
   * @param init - Initialization callbacks for output and errors
   * @throws TypeError if callbacks are not functions
   *
   * @example
   * ```ts
   * const encoder = new VideoEncoder({
   *   output: (chunk, metadata) => {
   *     // Handle encoded chunk
   *     if (metadata?.decoderConfig) {
   *       console.log('Received decoder config:', metadata.decoderConfig);
   *     }
   *   },
   *   error: (err) => {
   *     console.error('Encoding failed:', err.message);
   *   }
   * });
   * ```
   */
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

  /**
   * Current encoder state
   * - `unconfigured`: Not configured yet, or reset() was called
   * - `configured`: Ready to encode frames
   * - `closed`: Encoder has been closed and cannot be used
   */
  get state(): CodecState {
    return this._state;
  }

  /**
   * Number of pending encode operations
   * Useful for backpressure management in async mode
   *
   * @example Backpressure handling
   * ```ts
   * for (const frame of frames) {
   *   encoder.encode(frame);
   *
   *   // Wait if queue gets too large
   *   if (encoder.encodeQueueSize > 10) {
   *     await new Promise(resolve => {
   *       encoder.addEventListener('dequeue', resolve, { once: true });
   *     });
   *   }
   * }
   * ```
   */
  get encodeQueueSize(): number {
    return this._encodeQueueSize;
  }

  /**
   * Event handler for dequeue events
   * 
   * Called when an item is removed from the encode queue. Useful for backpressure
   * management. This is an alternative to using addEventListener('dequeue', ...).
   * 
   * @example
   * ```ts
   * encoder.ondequeue = () => {
   *   console.log('Queue size:', encoder.encodeQueueSize);
   * };
   * ```
   */
  get ondequeue(): ((event: Event) => void) | null {
    return this._ondequeue;
  }

  set ondequeue(handler: ((event: Event) => void) | null) {
    this._ondequeue = handler;
  }

  /**
   * Add an event listener
   * Currently supports 'dequeue' events fired when encode queue decreases
   *
   * @param type - Event type ('dequeue')
   * @param listener - Callback to invoke
   * @param options - Event listener options
   *
   * @example Wait for queue to drain
   * ```ts
   * encoder.addEventListener('dequeue', () => {
   *   console.log('Queue size:', encoder.encodeQueueSize);
   * });
   * ```
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

  /**
   * Remove an event listener
   *
   * @param type - Event type ('dequeue')
   * @param listener - Callback to remove
   */
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

  /**
   * Configure the encoder with codec parameters
   *
   * Must be called before encoding frames. Can be called multiple times to
   * reconfigure (e.g., to change bitrate or resolution).
   *
   * @param config - Encoder configuration
   * @throws DOMException if encoder is closed
   * @throws DOMException if codec is not supported
   * @throws DOMException if dimensions are invalid
   *
   * @example Basic H.264
   * ```ts
   * encoder.configure({
   *   codec: 'avc1.42E01E',
   *   width: 1920,
   *   height: 1080,
   *   bitrate: 5_000_000,
   *   framerate: 30
   * });
   * ```
   *
   * @example Hardware acceleration
   * ```ts
   * encoder.configure({
   *   codec: 'h264_videotoolbox',  // macOS
   *   width: 1920,
   *   height: 1080,
   *   hardwareAcceleration: 'prefer-hardware'
   * });
   * ```
   *
   * @example VP9 with HDR
   * ```ts
   * encoder.configure({
   *   codec: 'vp09.00.10.08',
   *   width: 3840,
   *   height: 2160,
   *   bitrate: 20_000_000,
   *   colorSpace: {
   *     primaries: 'bt2020',
   *     transfer: 'pq',
   *     matrix: 'bt2020-ncl'
   *   }
   * });
   * ```
   */
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

  /**
   * Encode a video frame
   *
   * Queues a frame for encoding. In async mode (default), encoding happens in
   * a worker thread and the output callback is invoked when complete.
   *
   * **IMPORTANT**: Always call `frame.close()` after encoding to prevent memory leaks.
   *
   * @param frame - VideoFrame to encode
   * @param options - Encoding options (keyFrame)
   * @throws DOMException if encoder is not configured
   * @throws DOMException if frame is invalid
   *
   * @example Basic encoding
   * ```ts
   * const frame = new VideoFrame(buffer, {
   *   format: 'RGBA',
   *   codedWidth: 1920,
   *   codedHeight: 1080,
   *   timestamp: 0
   * });
   *
   * encoder.encode(frame);
   * frame.close();  // MUST close to prevent memory leak
   * ```
   *
   * @example Force keyframe
   * ```ts
   * // Force first frame to be keyframe
   * encoder.encode(frame, { keyFrame: true });
   * frame.close();
   *
   * // Keyframe every 2 seconds at 30fps
   * for (let i = 0; i < frames.length; i++) {
   *   encoder.encode(frames[i], { keyFrame: i % 60 === 0 });
   *   frames[i].close();
   * }
   * ```
   */
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

  /**
   * Wait for all pending encodes to complete
   *
   * Flushes the internal encode queue and returns a promise that resolves when
   * all frames have been encoded. Call this before closing the encoder to ensure
   * no frames are lost.
   *
   * @returns Promise that resolves when flush is complete
   * @throws DOMException if encoder is not configured
   * @throws DOMException if encoding fails
   *
   * @example
   * ```ts
   * // Encode all frames
   * for (const frame of frames) {
   *   encoder.encode(frame);
   *   frame.close();
   * }
   *
   * // Wait for encoding to finish
   * await encoder.flush();
   *
   * console.log('All frames encoded!');
   * encoder.close();
   * ```
   */
  async flush(): Promise<void> {
    if (this._state !== 'configured') {
      throw new DOMException('Encoder is not configured', 'InvalidStateError');
    }

    return new Promise((resolve, reject) => {
      this._native.flush(async (err: Error | null) => {
        if (err) {
          reject(new DOMException(err.message, 'EncodingError'));
        } else {
          // Wait for any pending setImmediate callbacks to complete
          while (this._pendingCallbacks > 0) {
            await new Promise(r => setImmediate(r));
          }
          resolve();
        }
      });
    });
  }

  /**
   * Reset the encoder to unconfigured state
   *
   * Aborts all pending encode operations and resets to unconfigured state.
   * You must call `configure()` again before encoding more frames.
   *
   * @throws DOMException if encoder is closed
   *
   * @example
   * ```ts
   * encoder.configure({ codec: 'avc1.42E01E', width: 1920, height: 1080 });
   * encoder.encode(frame1);
   *
   * // Abort and reconfigure with different settings
   * encoder.reset();
   * encoder.configure({ codec: 'vp09.00.10.08', width: 1280, height: 720 });
   * encoder.encode(frame2);
   * ```
   */
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

  /**
   * Close the encoder and release resources
   *
   * Closes the encoder and frees all native resources. The encoder cannot be
   * used after calling close(). Any pending encode operations are aborted.
   *
   * @example
   * ```ts
   * // Encode frames
   * for (const frame of frames) {
   *   encoder.encode(frame);
   *   frame.close();
   * }
   *
   * await encoder.flush();
   * encoder.close();  // Release resources
   *
   * // encoder.encode() will now throw
   * ```
   */
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
    // Copy data immediately since native buffer may be recycled
    const dataCopy = new Uint8Array(data);
    const extradataCopy = extradata ? new Uint8Array(extradata) : undefined;

    this._pendingCallbacks++;

    // Defer callback to ensure encodeQueueSize > 0 when encode() returns
    setImmediate(() => {
      this._pendingCallbacks--;
      this._encodeQueueSize = Math.max(0, this._encodeQueueSize - 1);
      this._dispatchEvent('dequeue');

      const chunk = new EncodedVideoChunk({
        type: isKeyframe ? 'key' : 'delta',
        timestamp,
        duration: duration > 0 ? duration : undefined,
        data: dataCopy,
      });

      let metadata: VideoEncoderOutputMetadata | undefined;

      // Send decoder config with first keyframe
      if (isKeyframe && !this._sentDecoderConfig && this._config) {
        // Default color space for encoded video - use sRGB for RGBA source
        const colorSpace = this._config.colorSpace ?? {
          primaries: 'bt709',
          transfer: 'iec61966-2-1',
          matrix: 'rgb',
          fullRange: true,
        };

        metadata = {
          decoderConfig: {
            codec: this._config.codec,
            codedWidth: this._config.width,
            codedHeight: this._config.height,
            description: extradataCopy ? extradataCopy.buffer as ArrayBuffer : undefined,
            colorSpace,
          },
        };
        this._sentDecoderConfig = true;
      }

      try {
        this._outputCallback(chunk, metadata);
      } catch (e) {
        // Don't propagate callback errors
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
