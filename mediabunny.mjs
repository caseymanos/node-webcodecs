/**
 * ESM variant of `node-webcodecs/mediabunny`. Must import `mediabunny` with
 * the same loader as the application, or the transformer registers into a
 * different module instance (CJS/ESM dual-package hazard).
 */
import './dist/register.js';
import { registerVideoSampleTransformer, VideoSample } from 'mediabunny';

registerVideoSampleTransformer((sample, d) => {
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

  const frame = sample.toVideoFrame();
  try {
    const scaled = frame._scale(d.width, d.height);
    return new VideoSample(scaled);
  } finally {
    frame.close();
  }
});
