/**
 * VideoFrame - Represents a single frame of video
 * Implements the W3C WebCodecs VideoFrame interface
 */

import { VideoColorSpace, VideoColorSpaceInit } from './VideoColorSpace';
import { BufferSource, DOMRectReadOnly, DOMException } from './types';

export type VideoPixelFormat =
  | 'I420'
  | 'I420A'
  | 'I422'
  | 'I444'
  | 'NV12'
  | 'RGBA'
  | 'RGBX'
  | 'BGRA'
  | 'BGRX';

export interface PlaneLayout {
  offset: number;
  stride: number;
}

export interface VideoFrameInit {
  timestamp: number;  // microseconds
  duration?: number;  // microseconds
  format?: VideoPixelFormat;
  codedWidth?: number;
  codedHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  visibleRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  colorSpace?: VideoColorSpaceInit;
}

export interface VideoFrameBufferInit extends VideoFrameInit {
  format: VideoPixelFormat;
  codedWidth: number;
  codedHeight: number;
}

export interface VideoFrameCopyToOptions {
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layout?: PlaneLayout[];
  format?: VideoPixelFormat;
}

// Load native addon
import { native } from './native';

export class VideoFrame {
  private _native: any;
  private _closed: boolean = false;
  private _buffer: Uint8Array | null = null;

  private _format: VideoPixelFormat | null;
  private _codedWidth: number;
  private _codedHeight: number;
  private _displayWidth: number;
  private _displayHeight: number;
  private _timestamp: number;
  private _duration: number | null;
  private _colorSpace: VideoColorSpace;
  private _visibleRect: DOMRectReadOnly | null;

  // Per WebCodecs spec, after close() these should return null/0
  // Note: timestamp is preserved after close per spec
  get format(): VideoPixelFormat | null {
    return this._closed ? null : this._format;
  }
  get codedWidth(): number {
    return this._closed ? 0 : this._codedWidth;
  }
  get codedHeight(): number {
    return this._closed ? 0 : this._codedHeight;
  }
  get displayWidth(): number {
    return this._closed ? 0 : this._displayWidth;
  }
  get displayHeight(): number {
    return this._closed ? 0 : this._displayHeight;
  }
  get timestamp(): number {
    return this._timestamp;  // Preserved after close
  }
  get duration(): number | null {
    return this._closed ? null : this._duration;
  }
  get colorSpace(): VideoColorSpace {
    return this._colorSpace;
  }
  get visibleRect(): DOMRectReadOnly | null {
    return this._closed ? null : this._visibleRect;
  }

  constructor(data: BufferSource, init: VideoFrameBufferInit);
  constructor(image: VideoFrame, init?: VideoFrameInit);
  constructor(dataOrImage: BufferSource | VideoFrame, init?: VideoFrameInit | VideoFrameBufferInit) {
    if (dataOrImage instanceof VideoFrame) {
      // Clone from existing frame
      if (dataOrImage._closed) {
        throw new DOMException('Source VideoFrame is closed', 'InvalidStateError');
      }

      this._native = dataOrImage._native ? dataOrImage._native.clone() : null;
      this._buffer = dataOrImage._buffer ? new Uint8Array(dataOrImage._buffer) : null;
      this._format = dataOrImage._format;
      this._codedWidth = dataOrImage._codedWidth;
      this._codedHeight = dataOrImage._codedHeight;
      this._displayWidth = init?.displayWidth ?? dataOrImage._displayWidth;
      this._displayHeight = init?.displayHeight ?? dataOrImage._displayHeight;
      this._timestamp = init?.timestamp ?? dataOrImage._timestamp;
      this._duration = init?.duration ?? dataOrImage._duration;
      this._colorSpace = dataOrImage._colorSpace;
      this._visibleRect = dataOrImage._visibleRect;
    } else {
      // Create from buffer
      const bufferInit = init as VideoFrameBufferInit;
      if (!bufferInit?.format || !bufferInit.codedWidth || !bufferInit.codedHeight) {
        throw new TypeError('format, codedWidth, and codedHeight are required');
      }

      if (bufferInit.timestamp === undefined) {
        throw new TypeError('timestamp is required');
      }

      // Convert BufferSource to Uint8Array
      let buffer: Uint8Array;
      if (dataOrImage instanceof ArrayBuffer) {
        buffer = new Uint8Array(dataOrImage);
      } else {
        buffer = new Uint8Array(
          (dataOrImage as ArrayBufferView).buffer,
          (dataOrImage as ArrayBufferView).byteOffset,
          (dataOrImage as ArrayBufferView).byteLength
        );
      }

      // Store buffer copy for non-native mode
      this._buffer = new Uint8Array(buffer);

      // Try to create native frame if available
      if (native) {
        try {
          this._native = native.createVideoFrame(
            Buffer.from(buffer),
            bufferInit.format,
            bufferInit.codedWidth,
            bufferInit.codedHeight
          );
        } catch (e) {
          // Fall back to JS-only mode
          this._native = null;
        }
      }

      this._format = bufferInit.format;
      this._codedWidth = bufferInit.codedWidth;
      this._codedHeight = bufferInit.codedHeight;
      this._displayWidth = bufferInit.displayWidth ?? bufferInit.codedWidth;
      this._displayHeight = bufferInit.displayHeight ?? bufferInit.codedHeight;
      this._timestamp = bufferInit.timestamp;
      this._duration = bufferInit.duration ?? null;

      // Set default color space based on pixel format per WebCodecs spec
      // RGB formats default to sRGB, YUV formats default to BT.709
      const isRgbFormat = ['RGBA', 'RGBX', 'BGRA', 'BGRX'].includes(bufferInit.format);
      const defaultColorSpace = isRgbFormat
        ? { primaries: 'bt709' as const, transfer: 'iec61966-2-1' as const, matrix: 'rgb' as const, fullRange: true }
        : { primaries: 'bt709' as const, transfer: 'bt709' as const, matrix: 'bt709' as const, fullRange: false };

      this._colorSpace = new VideoColorSpace({
        primaries: bufferInit.colorSpace?.primaries ?? defaultColorSpace.primaries,
        transfer: bufferInit.colorSpace?.transfer ?? defaultColorSpace.transfer,
        matrix: bufferInit.colorSpace?.matrix ?? defaultColorSpace.matrix,
        fullRange: bufferInit.colorSpace?.fullRange ?? defaultColorSpace.fullRange,
      });
      this._visibleRect = bufferInit.visibleRect
        ? new DOMRectReadOnly(
            bufferInit.visibleRect.x,
            bufferInit.visibleRect.y,
            bufferInit.visibleRect.width,
            bufferInit.visibleRect.height
          )
        : new DOMRectReadOnly(0, 0, bufferInit.codedWidth, bufferInit.codedHeight);
    }
  }

  /**
   * Get the native frame handle (internal use only)
   */
  _getNative(): any {
    this._assertNotClosed();
    return this._native;
  }

  /**
   * Calculate the size in bytes needed to hold the frame data
   */
  allocationSize(options?: VideoFrameCopyToOptions): number {
    this._assertNotClosed();

    // Calculate size based on target format and dimensions
    const width = options?.rect?.width ?? this.codedWidth;
    const height = options?.rect?.height ?? this.codedHeight;
    const targetFormat = options?.format ?? this.format;

    return this._calculateFormatSize(targetFormat, width, height);
  }

  private _calculateFormatSize(format: VideoPixelFormat | null, width: number, height: number): number {
    switch (format) {
      case 'RGBA':
      case 'RGBX':
      case 'BGRA':
      case 'BGRX':
        return width * height * 4;
      case 'I420':
        return Math.floor(width * height * 1.5);
      case 'I420A':
        return width * height * 2;
      case 'I422':
        return width * height * 2;
      case 'I444':
        return width * height * 3;
      case 'NV12':
        return Math.floor(width * height * 1.5);
      default:
        return width * height * 4;
    }
  }

  /**
   * Copy the frame data to a destination buffer
   */
  async copyTo(destination: BufferSource, options?: VideoFrameCopyToOptions): Promise<PlaneLayout[]> {
    this._assertNotClosed();

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
      // Copy from stored buffer
      const size = Math.min(dest.byteLength, this._buffer.byteLength);
      dest.set(this._buffer.subarray(0, size));
    }

    // Return plane layouts based on format
    return this._getPlaneLayouts(options);
  }

  /**
   * Create a clone of this frame
   */
  clone(): VideoFrame {
    this._assertNotClosed();
    return new VideoFrame(this);
  }

  /**
   * Close the frame and release resources
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
      throw new DOMException('VideoFrame is closed', 'InvalidStateError');
    }
  }

  private _getPlaneLayouts(options?: VideoFrameCopyToOptions): PlaneLayout[] {
    const width = options?.rect?.width ?? this.codedWidth;
    const height = options?.rect?.height ?? this.codedHeight;
    const targetFormat = options?.format ?? this.format;

    switch (targetFormat) {
      case 'RGBA':
      case 'RGBX':
      case 'BGRA':
      case 'BGRX':
        return [{ offset: 0, stride: width * 4 }];
      case 'I420': {
        const ySize = width * height;
        const uvSize = Math.floor((width / 2) * (height / 2));
        return [
          { offset: 0, stride: width },
          { offset: ySize, stride: Math.floor(width / 2) },
          { offset: ySize + uvSize, stride: Math.floor(width / 2) },
        ];
      }
      case 'I420A': {
        const ySize = width * height;
        const uvSize = Math.floor((width / 2) * (height / 2));
        return [
          { offset: 0, stride: width },
          { offset: ySize, stride: Math.floor(width / 2) },
          { offset: ySize + uvSize, stride: Math.floor(width / 2) },
          { offset: ySize + 2 * uvSize, stride: width },
        ];
      }
      case 'I422': {
        const ySize = width * height;
        const uvSize = Math.floor((width / 2) * height);
        return [
          { offset: 0, stride: width },
          { offset: ySize, stride: Math.floor(width / 2) },
          { offset: ySize + uvSize, stride: Math.floor(width / 2) },
        ];
      }
      case 'I444': {
        const planeSize = width * height;
        return [
          { offset: 0, stride: width },
          { offset: planeSize, stride: width },
          { offset: planeSize * 2, stride: width },
        ];
      }
      case 'NV12': {
        const ySize = width * height;
        return [
          { offset: 0, stride: width },
          { offset: ySize, stride: width },
        ];
      }
      default:
        return [{ offset: 0, stride: width * 4 }];
    }
  }
}
