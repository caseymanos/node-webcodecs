/**
 * ImageDecoder - Decodes still images to VideoFrame
 * Implements the W3C WebCodecs ImageDecoder interface
 */

import { VideoFrame } from './VideoFrame';
import { DOMException, BufferSource } from './types';

// Load native addon
let native: any;
try {
  native = require('../build/Release/webcodecs_node.node');
} catch {
  native = null;
}

export interface ImageDecodeResult {
  image: VideoFrame;
  complete: boolean;
}

export interface ImageDecodeOptions {
  frameIndex?: number;
  completeFramesOnly?: boolean;
}

export interface ImageDecoderInit {
  data: BufferSource | ReadableStream<BufferSource>;
  type: string;
  colorSpaceConversion?: 'default' | 'none';
  desiredWidth?: number;
  desiredHeight?: number;
  preferAnimation?: boolean;
}

export class ImageDecoder {
  private _native: any;
  private _type: string;
  private _complete: boolean;
  private _closed: boolean = false;
  private _completedPromise: Promise<void>;
  private _completedResolve!: () => void;

  /**
   * Check if a MIME type is supported for decoding
   */
  static isTypeSupported(type: string): Promise<boolean> {
    if (!native || !native.ImageDecoderNative) {
      return Promise.resolve(false);
    }
    return Promise.resolve(native.ImageDecoderNative.isTypeSupported(type));
  }

  constructor(init: ImageDecoderInit) {
    if (!init.data) {
      throw new TypeError('data is required');
    }
    if (!init.type) {
      throw new TypeError('type is required');
    }

    if (!native || !native.ImageDecoderNative) {
      throw new DOMException('Native addon not available', 'NotSupportedError');
    }

    // Handle BufferSource
    let dataBuffer: Buffer;
    if (init.data instanceof ArrayBuffer) {
      dataBuffer = Buffer.from(init.data);
    } else if (ArrayBuffer.isView(init.data)) {
      dataBuffer = Buffer.from(init.data.buffer, init.data.byteOffset, init.data.byteLength);
    } else {
      // ReadableStream
      throw new TypeError('ReadableStream not yet supported');
    }

    this._type = init.type;
    this._completedPromise = new Promise((resolve) => {
      this._completedResolve = resolve;
    });

    try {
      this._native = new native.ImageDecoderNative({
        data: dataBuffer,
        type: init.type,
      });
    } catch (e: any) {
      throw new DOMException(e.message || 'Failed to create ImageDecoder', 'NotSupportedError');
    }

    this._complete = this._native.complete;
    if (this._complete) {
      this._completedResolve();
    }
  }

  /**
   * Whether all image data has been received
   */
  get complete(): boolean {
    return this._complete;
  }

  /**
   * Promise that resolves when complete becomes true
   */
  get completed(): Promise<void> {
    return this._completedPromise;
  }

  /**
   * The MIME type of the image
   */
  get type(): string {
    return this._type;
  }

  /**
   * Decode an image frame
   */
  async decode(options?: ImageDecodeOptions): Promise<ImageDecodeResult> {
    if (this._closed) {
      throw new DOMException('ImageDecoder is closed', 'InvalidStateError');
    }

    if (!this._complete) {
      throw new DOMException('Image data is not complete', 'InvalidStateError');
    }

    try {
      const result = this._native.decode(options?.frameIndex ?? 0);

      // The native decode returns an object with image (native VideoFrameNative) and complete
      // We need to wrap the native frame in a VideoFrame
      const videoFrame = new VideoFrame(result.image);

      return {
        image: videoFrame,
        complete: result.complete,
      };
    } catch (e: any) {
      throw new DOMException(e.message || 'Failed to decode image', 'EncodingError');
    }
  }

  /**
   * Reset the decoder state
   */
  reset(): void {
    if (!this._closed) {
      this._native.reset();
    }
  }

  /**
   * Close the decoder and release resources
   */
  close(): void {
    if (!this._closed) {
      this._closed = true;
      this._native.close();
    }
  }
}
