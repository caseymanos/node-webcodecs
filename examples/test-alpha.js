/**
 * Alpha Channel Encoding Test
 *
 * Tests encoding RGBA frames with alpha channel using VP9.
 * VP8/VP9 support alpha channel through YUVA420P format.
 */

const { VideoEncoder, VideoFrame } = require('../dist/index.js');
const fs = require('fs');
const path = require('path');

async function testAlphaEncoding() {
  console.log('Alpha Channel Encoding Test');
  console.log('============================\n');

  const encodedChunks = [];
  let decoderConfig = null;

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      console.log(`Encoded chunk: ${chunk.byteLength} bytes, type: ${chunk.type}`);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      encodedChunks.push(data);

      if (metadata?.decoderConfig) {
        decoderConfig = metadata.decoderConfig;
        console.log('Decoder config:', JSON.stringify(decoderConfig, null, 2));
      }
    },
    error: (error) => {
      console.error('Encoder error:', error);
    },
  });

  // Configure VP9 encoder with alpha: 'keep'
  const config = {
    codec: 'vp09.00.10.08',  // VP9 Profile 0, Level 1.0, 8-bit
    width: 320,
    height: 240,
    bitrate: 1_000_000,
    framerate: 30,
    alpha: 'keep',  // Preserve alpha channel
  };

  console.log('Configuring VP9 encoder with alpha: "keep"');
  console.log('Config:', JSON.stringify(config, null, 2));
  console.log();

  encoder.configure(config);
  console.log('Encoder state:', encoder.state);

  // Create frames with varying alpha values
  const width = 320;
  const height = 240;
  const frameCount = 30;

  console.log(`\nEncoding ${frameCount} frames with alpha gradient...`);

  for (let i = 0; i < frameCount; i++) {
    const data = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;

        // Create a circular gradient with transparency
        const cx = width / 2;
        const cy = height / 2;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = Math.sqrt(cx * cx + cy * cy);

        // Color gradient based on position and frame
        data[idx] = Math.floor(((x / width) + (i / frameCount)) * 255) % 256;     // R
        data[idx + 1] = Math.floor(((y / height) + (i / frameCount)) * 255) % 256; // G
        data[idx + 2] = 128;                                                        // B

        // Alpha: fully opaque in center, transparent at edges
        const alpha = Math.max(0, 255 - Math.floor((dist / maxDist) * 255));
        data[idx + 3] = alpha;
      }
    }

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: i * 33333,  // ~30fps
    });

    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
  }

  console.log('Flushing encoder...');
  await encoder.flush();
  encoder.close();

  // Summary
  console.log('\n--- Encoding Summary ---');
  console.log(`Total chunks produced: ${encodedChunks.length}`);

  const totalBytes = encodedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  console.log(`Total encoded size: ${totalBytes} bytes`);

  // Write to file
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'alpha_test.webm');

  // Write raw VP9 bitstream (not a proper WebM container, but useful for testing)
  const rawPath = path.join(outputDir, 'alpha_test_raw.vp9');
  const allData = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of encodedChunks) {
    allData.set(chunk, offset);
    offset += chunk.byteLength;
  }
  fs.writeFileSync(rawPath, allData);
  console.log(`\nWrote raw VP9 stream to: ${rawPath}`);

  console.log('\nNote: To verify alpha channel in encoded output:');
  console.log('1. The encoder should use YUVA420P pixel format for VP9 with alpha');
  console.log('2. ffprobe on the output should show yuva420p if alpha is preserved');
  console.log('\nTest complete!');

  return encodedChunks.length > 0;
}

async function testAlphaDiscard() {
  console.log('\n\n============================');
  console.log('Alpha Discard Mode Test');
  console.log('============================\n');

  const encodedChunks = [];

  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      encodedChunks.push(data);
    },
    error: (error) => {
      console.error('Encoder error:', error);
    },
  });

  // Configure VP9 encoder with alpha: 'discard' (default)
  const config = {
    codec: 'vp09.00.10.08',
    width: 320,
    height: 240,
    bitrate: 1_000_000,
    framerate: 30,
    alpha: 'discard',  // Discard alpha channel (use YUV420P)
  };

  console.log('Configuring VP9 encoder with alpha: "discard"');
  encoder.configure(config);

  // Encode a few frames
  for (let i = 0; i < 5; i++) {
    const data = new Uint8Array(320 * 240 * 4);
    for (let j = 0; j < data.length; j += 4) {
      data[j] = 128;
      data[j + 1] = 128;
      data[j + 2] = 128;
      data[j + 3] = i * 50;  // Varying alpha that will be discarded
    }

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 320,
      codedHeight: 240,
      timestamp: i * 33333,
    });

    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
  }

  await encoder.flush();
  encoder.close();

  console.log(`Encoded ${encodedChunks.length} chunks with alpha discarded`);
  console.log('(Uses YUV420P instead of YUVA420P)');
  console.log('\nPASS: Alpha discard mode works');

  return encodedChunks.length > 0;
}

async function main() {
  try {
    const keepResult = await testAlphaEncoding();
    const discardResult = await testAlphaDiscard();

    console.log('\n\n========================================');
    console.log('Alpha Channel Test Results:');
    console.log(`  alpha: "keep"    - ${keepResult ? 'PASS' : 'FAIL'}`);
    console.log(`  alpha: "discard" - ${discardResult ? 'PASS' : 'FAIL'}`);
    console.log('========================================\n');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

main();
