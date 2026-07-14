/**
 * One-line Mediabunny integration:
 *
 *   require('node-webcodecs/mediabunny');
 *   // or: import 'node-webcodecs/mediabunny';
 *
 * Installs the WebCodecs globals (see ./register) and registers a
 * VideoSample transformer so Mediabunny's resize paths (e.g. Conversion
 * with width/height) work in Node without a canvas.
 *
 * Requires `mediabunny` to be installed alongside this package.
 */
import './register';
import { VideoFrame } from './VideoFrame';

// Runtime-only dependency: mediabunny is an optional peer, so don't bind to
// its types at compile time
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mediabunny = require('mediabunny');

type TransformDescription = {
  width: number;
  height: number;
  fit: 'fill' | 'contain' | 'cover';
  rotation: 0 | 90 | 180 | 270;
  crop: { left: number; top: number; width: number; height: number };
  alpha: 'keep' | 'discard';
};

mediabunny.registerVideoSampleTransformer(
  (sample: any, d: TransformDescription) => {
    // Handle the plain resize path; decline anything needing rotation,
    // cropping, or letterboxing so Mediabunny can report it clearly
    if (d.rotation !== 0) return null;

    const fullCrop =
      !d.crop ||
      ((d.crop.left ?? 0) === 0 &&
        (d.crop.top ?? 0) === 0 &&
        d.crop.width === sample.codedWidth &&
        d.crop.height === sample.codedHeight);
    if (!fullCrop) return null;

    if (d.fit !== 'fill') {
      // contain/cover only reduce to a plain scale when aspect ratio is kept
      const srcRatio = sample.codedWidth / sample.codedHeight;
      const dstRatio = d.width / d.height;
      if (Math.abs(srcRatio - dstRatio) > 0.001) return null;
    }

    const frame = sample.toVideoFrame() as VideoFrame;
    try {
      const scaled = frame._scale(d.width, d.height);
      return new mediabunny.VideoSample(scaled);
    } finally {
      frame.close();
    }
  }
);
