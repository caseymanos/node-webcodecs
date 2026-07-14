/**
 * Installs node-webcodecs on globalThis so code written against browser
 * WebCodecs (Mediabunny, mp4-muxer, ...) runs unmodified in Node:
 *
 *   require('node-webcodecs/register');
 *   // or: import 'node-webcodecs/register';
 *
 * Existing globals are never overwritten.
 */
import * as webcodecs from './index';

const GLOBALS = [
  'VideoEncoder',
  'VideoDecoder',
  'AudioEncoder',
  'AudioDecoder',
  'VideoFrame',
  'AudioData',
  'EncodedVideoChunk',
  'EncodedAudioChunk',
  'VideoColorSpace',
  'ImageDecoder',
] as const;

for (const name of GLOBALS) {
  const impl = (webcodecs as Record<string, unknown>)[name];
  if (impl && !(name in globalThis)) {
    (globalThis as Record<string, unknown>)[name] = impl;
  }
}
