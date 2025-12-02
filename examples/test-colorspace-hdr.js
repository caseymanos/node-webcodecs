/**
 * HDR Color Space Test
 *
 * Tests encoding video with HDR color space settings (BT.2020 + PQ).
 * Outputs to a file that can be verified with ffprobe/mediainfo.
 */

const { VideoEncoder, VideoFrame } = require('../dist/index.js');
const fs = require('fs');
const path = require('path');

async function testHDRColorSpace() {
  console.log('HDR Color Space Encoding Test');
  console.log('==============================\n');

  const encodedChunks = [];
  let decoderConfig = null;

  // Create encoder with callbacks
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      console.log(`Encoded chunk: ${chunk.byteLength} bytes, type: ${chunk.type}`);
      encodedChunks.push({
        data: new Uint8Array(chunk.byteLength),
        type: chunk.type,
        timestamp: chunk.timestamp,
        duration: chunk.duration,
      });
      // Copy the data
      chunk.copyTo(encodedChunks[encodedChunks.length - 1].data);

      if (metadata?.decoderConfig) {
        decoderConfig = metadata.decoderConfig;
        console.log('Decoder config received:', JSON.stringify(decoderConfig, null, 2));
      }
    },
    error: (error) => {
      console.error('Encoder error:', error);
    },
  });

  // Configure encoder with HDR color space (BT.2020 + PQ)
  const config = {
    codec: 'avc1.640028',  // H.264 High Profile Level 4.0
    width: 1920,
    height: 1080,
    bitrate: 10_000_000,   // 10 Mbps
    framerate: 30,
    colorSpace: {
      primaries: 'bt2020',
      transfer: 'pq',           // HDR PQ transfer function
      matrix: 'bt2020-ncl',
      fullRange: false,
    },
  };

  console.log('Configuring encoder with HDR settings:');
  console.log(JSON.stringify(config, null, 2));
  console.log();

  encoder.configure(config);

  console.log('Encoder configured. State:', encoder.state);
  console.log();

  // Encode 30 frames (1 second at 30fps)
  const frameDuration = 33333;  // ~30fps in microseconds

  for (let i = 0; i < 30; i++) {
    // Create frame data (RGBA) - simulate HDR-like content
    const data = new Uint8Array(1920 * 1080 * 4);

    // Create a gradient pattern
    for (let y = 0; y < 1080; y++) {
      for (let x = 0; x < 1920; x++) {
        const idx = (y * 1920 + x) * 4;
        // Simulate HDR brightness levels
        const brightness = Math.floor(((x / 1920) + (i / 30)) * 255) % 256;
        data[idx] = brightness;      // R
        data[idx + 1] = Math.floor(brightness * 0.8);  // G
        data[idx + 2] = Math.floor(brightness * 0.6);  // B
        data[idx + 3] = 255;         // A
      }
    }

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 1920,
      codedHeight: 1080,
      timestamp: i * frameDuration,
    });

    // First frame is a keyframe
    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
  }

  console.log('30 frames sent for encoding...\n');

  // Flush encoder to get remaining frames
  await encoder.flush();
  encoder.close();

  // Summary
  console.log('\n--- Encoding Summary ---');
  console.log(`Total chunks produced: ${encodedChunks.length}`);

  const totalBytes = encodedChunks.reduce((sum, chunk) => sum + chunk.data.byteLength, 0);
  console.log(`Total encoded size: ${totalBytes} bytes`);

  // Write raw H.264 stream to file for ffprobe analysis
  const outputPath = path.join(__dirname, 'output', 'hdr_test.h264');

  // Ensure output directory exists
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Concatenate all chunks
  const outputData = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of encodedChunks) {
    outputData.set(chunk.data, offset);
    offset += chunk.data.byteLength;
  }

  fs.writeFileSync(outputPath, outputData);
  console.log(`\nWrote H.264 stream to: ${outputPath}`);

  console.log('\nTo verify color space metadata, run:');
  console.log(`  ffprobe -show_streams "${outputPath}"`);
  console.log('\nLook for:');
  console.log('  color_primaries=bt2020');
  console.log('  color_transfer=smpte2084 (PQ)');
  console.log('  color_space=bt2020nc');

  console.log('\nTest complete!');
}

testHDRColorSpace().catch(console.error);
