/**
 * webcodecs-node - Native WebCodecs API implementation for Node.js
 *
 * This package provides a native implementation of the W3C WebCodecs API
 * for Node.js, using FFmpeg for encoding and decoding.
 */

// Core frame types
export { VideoFrame, VideoFrameInit, VideoFrameBufferInit, VideoPixelFormat, PlaneLayout, VideoFrameCopyToOptions } from './VideoFrame';
export { AudioData, AudioDataInit, AudioDataCopyToOptions, AudioSampleFormat } from './AudioData';

// Encoded chunk types
export { EncodedVideoChunk, EncodedVideoChunkInit, EncodedVideoChunkType } from './EncodedVideoChunk';
export { EncodedAudioChunk, EncodedAudioChunkInit, EncodedAudioChunkType } from './EncodedAudioChunk';

// Color space
export { VideoColorSpace, VideoColorSpaceInit, VideoColorPrimaries, VideoTransferCharacteristics, VideoMatrixCoefficients } from './VideoColorSpace';

// Image decoder
export { ImageDecoder, ImageDecoderInit, ImageDecodeResult, ImageDecodeOptions } from './ImageDecoder';

// Video encoder/decoder
export {
  VideoEncoder,
  VideoEncoderConfig,
  VideoEncoderInit,
  VideoEncoderSupport,
  VideoEncoderOutputMetadata,
  VideoEncoderEncodeOptions,
  LatencyMode,
  BitrateMode,
  AlphaOption,
} from './VideoEncoder';

export {
  VideoDecoder,
  VideoDecoderConfig,
  VideoDecoderInit,
  VideoDecoderSupport,
} from './VideoDecoder';

// Audio encoder/decoder
export {
  AudioEncoder,
  AudioEncoderConfig,
  AudioEncoderInit,
  AudioEncoderSupport,
  AudioEncoderOutputMetadata,
  AudioBitrateMode,
} from './AudioEncoder';

export {
  AudioDecoder,
  AudioDecoderConfig,
  AudioDecoderInit,
  AudioDecoderSupport,
} from './AudioDecoder';

// Codec registry utilities
export {
  isVideoCodecSupported,
  isAudioCodecSupported,
  getFFmpegVideoCodec,
  getFFmpegAudioCodec,
  parseAvcCodecString,
  parseAacCodecString,
  parseVp9CodecString,
} from './codec-registry';

// Type exports
export { CodecState, BufferSource, DOMRectReadOnly } from './types';

// Native utilities (if available)
let _native: any = null;
try {
  _native = require('../build/Release/webcodecs_node.node');
} catch {
  // Native addon not available
}

/**
 * Get FFmpeg version information
 */
export function getFFmpegVersion(): { avcodec: string; avcodecVersion: string } | null {
  if (_native && _native.getFFmpegVersion) {
    return _native.getFFmpegVersion();
  }
  return null;
}

/**
 * List available codecs
 */
export function listCodecs(): {
  encoders: Array<{ name: string; longName: string; type: string }>;
  decoders: Array<{ name: string; longName: string; type: string }>;
} | null {
  if (_native && _native.listCodecs) {
    return _native.listCodecs();
  }
  return null;
}

/**
 * Check if a specific codec is available
 */
export function hasCodec(codecName: string, type: 'encoder' | 'decoder'): boolean {
  if (_native && _native.hasCodec) {
    return _native.hasCodec(codecName, type);
  }
  return false;
}

/**
 * Check if native addon is available
 */
export function isNativeAvailable(): boolean {
  return _native !== null;
}
