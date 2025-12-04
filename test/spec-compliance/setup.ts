/**
 * Vitest setup file for spec-compliance tests
 * 
 * This file sets up the WebCodecs API for testing.
 * Tests are implementation-agnostic and should work with any spec-compliant implementation.
 */

import {
  VideoFrame,
  AudioData,
  EncodedVideoChunk,
  EncodedAudioChunk,
  VideoEncoder,
  VideoDecoder,
  AudioEncoder,
  AudioDecoder,
  ImageDecoder,
  VideoColorSpace,
} from '../../src/index';

// Make WebCodecs globally available (matching browser API)
Object.assign(globalThis, {
  VideoFrame,
  AudioData,
  EncodedVideoChunk,
  EncodedAudioChunk,
  VideoEncoder,
  VideoDecoder,
  AudioEncoder,
  AudioDecoder,
  ImageDecoder,
  VideoColorSpace,
});

// Polyfill DOMRect for Node.js (required by some WebCodecs implementations)
if (typeof globalThis.DOMRect === 'undefined') {
  class DOMRect {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;

    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.top = y;
      this.right = x + width;
      this.bottom = y + height;
      this.left = x;
    }

    toJSON() {
      return {
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height,
        top: this.top,
        right: this.right,
        bottom: this.bottom,
        left: this.left
      };
    }

    static fromRect(other?: { x?: number; y?: number; width?: number; height?: number }) {
      return new DOMRect(other?.x, other?.y, other?.width, other?.height);
    }
  }
  (globalThis as unknown as Record<string, unknown>).DOMRect = DOMRect;
}
