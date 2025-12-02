/**
 * ImageDecoder - Decodes still images to VideoFrame
 * Implements the W3C WebCodecs ImageDecoder interface
 */

import { VideoFrame } from './VideoFrame';
import { DOMException, BufferSource } from './types';

// Load native addon
import { native } from './native';

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

/**
 * Check if a value is a ReadableStream
 */
function isReadableStream(value: unknown): value is ReadableStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).getReader === 'function'
  );
}

export class ImageDecoder {
  private _native: any;
  private _type: string;
  private _complete: boolean = false;
  private _closed: boolean = false;
  private _completedPromise: Promise<void>;
  private _completedResolve!: () => void;
  private _completedReject!: (error: Error) => void;
  private _streamReader?: ReadableStreamDefaultReader<BufferSource>;

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

    this._type = init.type;
    this._completedPromise = new Promise((resolve, reject) => {
      this._completedResolve = resolve;
      this._completedReject = reject;
    });

    // Handle ReadableStream
    if (isReadableStream(init.data)) {
      this._handleReadableStream(init.data as ReadableStream<BufferSource>);
      return;
    }

    // Handle BufferSource
    let dataBuffer: Buffer;
    if (init.data instanceof ArrayBuffer) {
      dataBuffer = Buffer.from(init.data);
    } else if (ArrayBuffer.isView(init.data)) {
      dataBuffer = Buffer.from(init.data.buffer, init.data.byteOffset, init.data.byteLength);
    } else {
      throw new TypeError('Invalid data type: expected BufferSource or ReadableStream');
    }

    this._initNative(dataBuffer);
  }

  /**
   * Handle ReadableStream input by reading all chunks and concatenating them
   */
  private async _handleReadableStream(stream: ReadableStream<BufferSource>): Promise<void> {
    this._streamReader = stream.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { done, value } = await this._streamReader.read();

        if (done) break;

        // Convert BufferSource to Uint8Array
        let chunk: Uint8Array;
        if (value instanceof ArrayBuffer) {
          chunk = new Uint8Array(value);
        } else if (ArrayBuffer.isView(value)) {
          chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        } else {
          throw new TypeError('ReadableStream yielded invalid chunk type');
        }

        chunks.push(chunk);
      }

      // Concatenate all chunks
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const fullData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        fullData.set(chunk, offset);
        offset += chunk.length;
      }

      this._initNative(Buffer.from(fullData));
    } catch (error) {
      this._completedReject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Initialize the native decoder with buffer data
   */
  private _initNative(dataBuffer: Buffer): void {
    try {
      this._native = new native.ImageDecoderNative({
        data: dataBuffer,
        type: this._type,
      });

      this._complete = this._native.complete;
      if (this._complete) {
        this._completedResolve();
      }
    } catch (e: any) {
      const error = new DOMException(e.message || 'Failed to create ImageDecoder', 'NotSupportedError');
      this._completedReject(error);
      throw error;
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
