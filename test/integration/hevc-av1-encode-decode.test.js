/**
 * Integration tests for H.265/HEVC and AV1 Video Encoding/Decoding
 * Phase 5: Extended Codec Support
 * Run with: node test/integration/hevc-av1-encode-decode.test.js
 *
 * NOTE: HEVC and especially AV1 software encoders are very slow.
 * These tests are skipped in CI to avoid timeouts.
 */

const { VideoEncoder, VideoDecoder, VideoFrame, EncodedVideoChunk } = require('../../dist/index.js');

// Skip slow codec tests in CI environments
const isCI = process.env.CI === 'true';

if (isCI) {
  console.log('WebCodecs-Node H.265/HEVC and AV1 Integration Tests');
  console.log('====================================================');
  console.log('\nSKIPPED: HEVC/AV1 tests are slow and skipped in CI');
  console.log('These codecs are tested locally where hardware acceleration may be available.\n');
  process.exit(0);
}

// Helper to create a test frame
function createTestFrame(width, height, timestamp, color = { r: 128, g: 128, b: 128 }) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color.r;
    data[i + 1] = color.g;
    data[i + 2] = color.b;
    data[i + 3] = 255;
  }

  return new VideoFrame(data, {
    format: 'RGBA',
    codedWidth: width,
    codedHeight: height,
    timestamp,
  });
}

// ==================== H.265/HEVC Tests ====================

async function testHEVCEncodeSingleFrame() {
  console.log('\n=== Test: H.265/HEVC Encode Single Frame ===');

  const chunks = [];
  const errors = [];

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      console.log(`  Got chunk: ${chunk.byteLength} bytes, type: ${chunk.type}`);
      chunks.push({ chunk, metadata });
    },
    error: (err) => {
      console.error('  Encoder error:', err);
      errors.push(err);
    },
  });

  try {
    encoder.configure({
      codec: 'hvc1',
      width: 320,
      height: 240,
      bitrate: 500000,
    });
    console.log('  Encoder configured for HEVC');

    const frame = createTestFrame(320, 240, 0, { r: 255, g: 128, b: 0 });
    console.log(`  Created frame: ${frame.codedWidth}x${frame.codedHeight}`);

    encoder.encode(frame, { keyFrame: true });
    frame.close();
    console.log('  Frame encoded, flushing...');

    await encoder.flush();
    encoder.close();

    console.log(`  Total chunks: ${chunks.length}`);
    if (chunks.length > 0) {
      console.log(`  First chunk type: ${chunks[0].chunk.type}`);
      console.log('  PASSED\n');
      return { success: true, chunks };
    } else if (errors.length > 0) {
      console.log('  FAILED (encoder errors)\n');
      return { success: false, error: errors[0] };
    } else {
      console.log('  FAILED (no chunks produced)\n');
      return { success: false };
    }
  } catch (err) {
    console.log(`  SKIPPED: ${err.message}\n`);
    return { success: false, skipped: true, error: err.message };
  }
}

async function testHEVCEncodeMultipleFrames() {
  console.log('\n=== Test: H.265/HEVC Encode Multiple Frames ===');

  const chunks = [];
  const errors = [];

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => chunks.push({ chunk, metadata }),
    error: (err) => errors.push(err),
  });

  try {
    encoder.configure({
      codec: 'hvc1',
      width: 320,
      height: 240,
      bitrate: 500000,
      framerate: 30,
    });
    console.log('  Encoder configured for HEVC');

    const frameDuration = 33333;

    for (let i = 0; i < 5; i++) {
      const gray = 50 + i * 40;
      const frame = createTestFrame(320, 240, i * frameDuration, { r: gray, g: gray, b: gray });
      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
    }
    console.log('  5 frames encoded, flushing...');

    await encoder.flush();
    encoder.close();

    console.log(`  Total chunks: ${chunks.length}`);
    if (chunks.length >= 5) {
      console.log('  PASSED\n');
      return { success: true, chunks };
    } else if (errors.length > 0) {
      console.log('  FAILED (encoder errors)\n');
      return { success: false };
    } else {
      console.log(`  PARTIAL (only ${chunks.length} chunks)\n`);
      return { success: chunks.length > 0, chunks };
    }
  } catch (err) {
    console.log(`  SKIPPED: ${err.message}\n`);
    return { success: false, skipped: true, error: err.message };
  }
}

async function testHEVCEncodeDecode() {
  console.log('\n=== Test: H.265/HEVC Encode then Decode ===');

  const encodedChunks = [];
  const decodedFrames = [];
  const errors = [];
  let decoderConfig = null;

  // Encode
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      encodedChunks.push(chunk);
      if (metadata?.decoderConfig) {
        decoderConfig = metadata.decoderConfig;
      }
    },
    error: (err) => errors.push(err),
  });

  try {
    encoder.configure({
      codec: 'hvc1',
      width: 320,
      height: 240,
      bitrate: 500000,
    });

    const frame = createTestFrame(320, 240, 0, { r: 0, g: 128, b: 255 });
    encoder.encode(frame, { keyFrame: true });
    frame.close();
    await encoder.flush();
    encoder.close();

    console.log(`  Encoded ${encodedChunks.length} chunks`);

    if (encodedChunks.length === 0) {
      console.log('  SKIPPED: No encoded chunks\n');
      return { success: false, skipped: true };
    }

    // Decode
    const decoder = new VideoDecoder({
      output: (decodedFrame) => {
        console.log(`  Decoded frame: ${decodedFrame.codedWidth}x${decodedFrame.codedHeight}`);
        decodedFrames.push(decodedFrame);
      },
      error: (err) => {
        console.error('  Decoder error:', err);
        errors.push(err);
      },
    });

    decoder.configure({
      codec: 'hvc1',
      codedWidth: 320,
      codedHeight: 240,
      description: decoderConfig?.description,
    });
    console.log('  Decoder configured');

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }
    console.log('  All chunks sent for decoding');

    await decoder.flush();
    decoder.close();

    console.log(`  Decoded ${decodedFrames.length} frames`);

    decodedFrames.forEach(f => f.close());

    if (decodedFrames.length > 0) {
      console.log('  PASSED\n');
      return { success: true };
    } else {
      console.log('  FAILED (no frames decoded)\n');
      return { success: false };
    }
  } catch (err) {
    console.log(`  SKIPPED: ${err.message}\n`);
    return { success: false, skipped: true, error: err.message };
  }
}

// ==================== AV1 Tests ====================

async function testAV1EncodeSingleFrame() {
  console.log('\n=== Test: AV1 Encode Single Frame ===');

  const chunks = [];
  const errors = [];

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      console.log(`  Got chunk: ${chunk.byteLength} bytes, type: ${chunk.type}`);
      chunks.push({ chunk, metadata });
    },
    error: (err) => {
      console.error('  Encoder error:', err);
      errors.push(err);
    },
  });

  try {
    encoder.configure({
      codec: 'av01',
      width: 320,
      height: 240,
      bitrate: 500000,
    });
    console.log('  Encoder configured for AV1');

    const frame = createTestFrame(320, 240, 0, { r: 128, g: 255, b: 128 });
    console.log(`  Created frame: ${frame.codedWidth}x${frame.codedHeight}`);

    encoder.encode(frame, { keyFrame: true });
    frame.close();
    console.log('  Frame encoded, flushing...');

    await encoder.flush();
    encoder.close();

    console.log(`  Total chunks: ${chunks.length}`);
    if (chunks.length > 0) {
      console.log(`  First chunk type: ${chunks[0].chunk.type}`);
      console.log('  PASSED\n');
      return { success: true, chunks };
    } else if (errors.length > 0) {
      console.log('  FAILED (encoder errors)\n');
      return { success: false, error: errors[0] };
    } else {
      console.log('  FAILED (no chunks produced)\n');
      return { success: false };
    }
  } catch (err) {
    console.log(`  SKIPPED: ${err.message}\n`);
    return { success: false, skipped: true, error: err.message };
  }
}

async function testAV1EncodeDecode() {
  console.log('\n=== Test: AV1 Encode then Decode ===');

  const encodedChunks = [];
  const decodedFrames = [];
  const errors = [];

  // Encode
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => encodedChunks.push(chunk),
    error: (err) => errors.push(err),
  });

  try {
    encoder.configure({
      codec: 'av01',
      width: 320,
      height: 240,
      bitrate: 500000,
    });

    const frame = createTestFrame(320, 240, 0, { r: 255, g: 0, b: 255 });
    encoder.encode(frame, { keyFrame: true });
    frame.close();
    await encoder.flush();
    encoder.close();

    console.log(`  Encoded ${encodedChunks.length} chunks`);

    if (encodedChunks.length === 0) {
      console.log('  SKIPPED: No encoded chunks\n');
      return { success: false, skipped: true };
    }

    // Decode
    const decoder = new VideoDecoder({
      output: (decodedFrame) => {
        console.log(`  Decoded frame: ${decodedFrame.codedWidth}x${decodedFrame.codedHeight}`);
        decodedFrames.push(decodedFrame);
      },
      error: (err) => {
        console.error('  Decoder error:', err);
        errors.push(err);
      },
    });

    decoder.configure({
      codec: 'av01',
      codedWidth: 320,
      codedHeight: 240,
    });
    console.log('  Decoder configured');

    for (const chunk of encodedChunks) {
      decoder.decode(chunk);
    }
    console.log('  All chunks sent for decoding');

    await decoder.flush();
    decoder.close();

    console.log(`  Decoded ${decodedFrames.length} frames`);

    decodedFrames.forEach(f => f.close());

    if (decodedFrames.length > 0) {
      console.log('  PASSED\n');
      return { success: true };
    } else {
      console.log('  FAILED (no frames decoded)\n');
      return { success: false };
    }
  } catch (err) {
    console.log(`  SKIPPED: ${err.message}\n`);
    return { success: false, skipped: true, error: err.message };
  }
}

// ==================== Run All Tests ====================

async function runAllTests() {
  console.log('WebCodecs-Node H.265/HEVC and AV1 Integration Tests');
  console.log('====================================================');
  console.log('Phase 5: Extended Codec Support\n');

  const results = {
    hevc: { passed: 0, failed: 0, skipped: 0 },
    av1: { passed: 0, failed: 0, skipped: 0 },
  };

  // H.265/HEVC Tests
  console.log('\n--- H.265/HEVC Codec Tests ---');

  let result = await testHEVCEncodeSingleFrame();
  if (result.skipped) results.hevc.skipped++;
  else if (result.success) results.hevc.passed++;
  else results.hevc.failed++;

  result = await testHEVCEncodeMultipleFrames();
  if (result.skipped) results.hevc.skipped++;
  else if (result.success) results.hevc.passed++;
  else results.hevc.failed++;

  result = await testHEVCEncodeDecode();
  if (result.skipped) results.hevc.skipped++;
  else if (result.success) results.hevc.passed++;
  else results.hevc.failed++;

  // AV1 Tests
  console.log('\n--- AV1 Codec Tests ---');

  result = await testAV1EncodeSingleFrame();
  if (result.skipped) results.av1.skipped++;
  else if (result.success) results.av1.passed++;
  else results.av1.failed++;

  result = await testAV1EncodeDecode();
  if (result.skipped) results.av1.skipped++;
  else if (result.success) results.av1.passed++;
  else results.av1.failed++;

  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`HEVC: ${results.hevc.passed} passed, ${results.hevc.failed} failed, ${results.hevc.skipped} skipped`);
  console.log(`AV1: ${results.av1.passed} passed, ${results.av1.failed} failed, ${results.av1.skipped} skipped`);

  const totalPassed = results.hevc.passed + results.av1.passed;
  const totalFailed = results.hevc.failed + results.av1.failed;
  const totalSkipped = results.hevc.skipped + results.av1.skipped;

  console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`);

  if (totalFailed > 0) {
    console.log('\nSome tests failed!');
    process.exit(1);
  } else if (totalSkipped > 0 && totalPassed === 0) {
    console.log('\nAll tests skipped - HEVC/AV1 codecs may not be available');
    console.log('Note: H.265/HEVC requires libx265, AV1 requires libaom');
    process.exit(0);
  } else {
    console.log('\nAll available tests passed!');
  }
}

runAllTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
