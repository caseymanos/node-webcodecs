/**
 * Scalability Mode (SVC) Test
 *
 * Tests temporal layer encoding with VP9 and VP8.
 * Scalability modes: L1T1, L1T2, L1T3
 */

const { VideoEncoder, VideoFrame } = require('../dist/index.js');
const fs = require('fs');
const path = require('path');

async function testScalabilityMode(codec, scalabilityMode) {
  console.log(`\n--- Testing ${codec} with scalabilityMode: ${scalabilityMode} ---`);

  const encodedChunks = [];
  let configReceived = false;

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      encodedChunks.push({
        data,
        type: chunk.type,
        timestamp: chunk.timestamp,
      });

      if (metadata?.decoderConfig && !configReceived) {
        configReceived = true;
        console.log('  Decoder config received');
      }
    },
    error: (error) => {
      console.error('  Encoder error:', error);
    },
  });

  const config = {
    codec,
    width: 320,
    height: 240,
    bitrate: 500_000,
    framerate: 30,
    scalabilityMode,
  };

  try {
    encoder.configure(config);
    console.log('  Encoder configured successfully');
  } catch (error) {
    console.log(`  Configuration failed: ${error.message}`);
    return { success: false, error: error.message };
  }

  // Encode 60 frames (2 seconds at 30fps)
  const frameCount = 60;
  for (let i = 0; i < frameCount; i++) {
    const data = new Uint8Array(320 * 240 * 4);

    // Create animated pattern
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 320; x++) {
        const idx = (y * 320 + x) * 4;
        data[idx] = ((x + i * 5) % 256);     // R - moving gradient
        data[idx + 1] = ((y + i * 3) % 256); // G - moving gradient
        data[idx + 2] = 128;                  // B
        data[idx + 3] = 255;                  // A
      }
    }

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 320,
      codedHeight: 240,
      timestamp: i * 33333,
    });

    // Keyframe every 30 frames
    encoder.encode(frame, { keyFrame: i % 30 === 0 });
    frame.close();
  }

  await encoder.flush();
  encoder.close();

  const totalBytes = encodedChunks.reduce((sum, c) => sum + c.data.byteLength, 0);
  const keyframes = encodedChunks.filter(c => c.type === 'key').length;

  console.log(`  Encoded ${encodedChunks.length} chunks (${keyframes} keyframes)`);
  console.log(`  Total size: ${totalBytes} bytes`);
  console.log(`  Avg chunk size: ${Math.round(totalBytes / encodedChunks.length)} bytes`);

  return {
    success: true,
    chunks: encodedChunks.length,
    bytes: totalBytes,
    keyframes,
  };
}

async function testUnsupportedMode() {
  console.log('\n--- Testing unsupported scalabilityMode: L2T2 ---');

  const encoder = new VideoEncoder({
    output: () => {},
    error: () => {},
  });

  try {
    encoder.configure({
      codec: 'vp09.00.10.08',
      width: 320,
      height: 240,
      bitrate: 500_000,
      scalabilityMode: 'L2T2',  // Spatial SVC not supported
    });
    console.log('  ERROR: Should have thrown for unsupported mode');
    encoder.close();
    return false;
  } catch (error) {
    console.log(`  Correctly rejected: ${error.message}`);
    return true;
  }
}

async function main() {
  console.log('Scalability Mode (SVC) Test Suite');
  console.log('==================================');

  const results = [];

  // Test VP9 with different temporal layer configs
  results.push({
    name: 'VP9 L1T1 (no SVC)',
    ...(await testScalabilityMode('vp09.00.10.08', 'L1T1')),
  });

  results.push({
    name: 'VP9 L1T2 (2 temporal layers)',
    ...(await testScalabilityMode('vp09.00.10.08', 'L1T2')),
  });

  results.push({
    name: 'VP9 L1T3 (3 temporal layers)',
    ...(await testScalabilityMode('vp09.00.10.08', 'L1T3')),
  });

  // Test VP8 with temporal layers
  results.push({
    name: 'VP8 L1T2 (2 temporal layers)',
    ...(await testScalabilityMode('vp8', 'L1T2')),
  });

  // Test unsupported mode rejection
  const unsupportedRejected = await testUnsupportedMode();

  // Summary
  console.log('\n\n========================================');
  console.log('Test Results:');
  console.log('========================================');

  for (const result of results) {
    const status = result.success ? 'PASS' : 'FAIL';
    console.log(`  ${result.name}: ${status}`);
    if (result.success) {
      console.log(`    -> ${result.chunks} chunks, ${result.bytes} bytes`);
    } else {
      console.log(`    -> ${result.error}`);
    }
  }

  console.log(`  Unsupported mode rejection: ${unsupportedRejected ? 'PASS' : 'FAIL'}`);

  const allPassed = results.every(r => r.success) && unsupportedRejected;
  console.log(`\nOverall: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  console.log('========================================\n');

  // Save sample output for analysis
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('Note: Temporal layer structure can be analyzed using:');
  console.log('  - VP9 bitstream analyzer');
  console.log('  - ffprobe with -show_frames');
}

main().catch(console.error);
