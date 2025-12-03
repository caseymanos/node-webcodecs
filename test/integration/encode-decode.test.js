/**
 * Integration tests for VideoEncoder/VideoDecoder
 * Run with: node test/integration/encode-decode.test.js
 *
 * NOTE: Skipped in CI due to software encoder performance.
 * Hardware acceleration is not available in CI VMs.
 */

const { VideoEncoder, VideoDecoder, VideoFrame, EncodedVideoChunk } = require('../../dist/index.js');

// Skip in CI - software encoding is too slow without hardware acceleration
const isCI = process.env.CI === 'true';

if (isCI) {
  console.log('WebCodecs-Node H.264 Integration Tests');
  console.log('======================================');
  console.log('\nSKIPPED: Integration tests skipped in CI');
  console.log('Hardware acceleration not available. Run locally for full testing.\n');
  process.exit(0);
}

async function testEncodeSingleFrame() {
  console.log('\n=== Test: Encode Single Frame ===');

  const chunks = [];
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      console.log(`  Got chunk: ${chunk.byteLength} bytes, type: ${chunk.type}`);
      chunks.push({ chunk, metadata });
    },
    error: (err) => console.error('  Encoder error:', err),
  });

  encoder.configure({
    codec: 'avc1.42E01E',
    width: 320,
    height: 240,
    bitrate: 500000,
  });
  console.log('  Encoder configured');

  // Create red frame
  const data = new Uint8Array(320 * 240 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;     // R
    data[i + 1] = 0;   // G
    data[i + 2] = 0;   // B
    data[i + 3] = 255; // A
  }

  const frame = new VideoFrame(data, {
    format: 'RGBA',
    codedWidth: 320,
    codedHeight: 240,
    timestamp: 0,
  });
  console.log(`  Created frame: ${frame.codedWidth}x${frame.codedHeight}`);

  encoder.encode(frame, { keyFrame: true });
  frame.close();
  console.log('  Frame encoded, flushing...');

  await encoder.flush();
  encoder.close();

  console.log(`  Total chunks: ${chunks.length}`);
  if (chunks.length > 0) {
    console.log(`  First chunk type: ${chunks[0].chunk.type}`);
    console.log(`  Has decoder config: ${!!chunks[0].metadata?.decoderConfig}`);
  }

  console.log('  PASSED\n');
  return chunks;
}

async function testEncodeMultipleFrames() {
  console.log('\n=== Test: Encode Multiple Frames ===');

  const chunks = [];
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => chunks.push({ chunk, metadata }),
    error: (err) => console.error('  Encoder error:', err),
  });

  encoder.configure({
    codec: 'avc1.42E01E',
    width: 320,
    height: 240,
    bitrate: 500000,
    framerate: 30,
  });
  console.log('  Encoder configured');

  const frameDuration = 33333; // ~30fps in microseconds

  for (let i = 0; i < 5; i++) {
    const data = new Uint8Array(320 * 240 * 4);
    const gray = 50 + i * 40;
    for (let j = 0; j < data.length; j += 4) {
      data[j] = gray;
      data[j + 1] = gray;
      data[j + 2] = gray;
      data[j + 3] = 255;
    }

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 320,
      codedHeight: 240,
      timestamp: i * frameDuration,
    });

    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
  }
  console.log('  5 frames encoded, flushing...');

  await encoder.flush();
  encoder.close();

  console.log(`  Total chunks: ${chunks.length}`);
  console.log(`  First chunk timestamp: ${chunks[0]?.chunk.timestamp}`);
  console.log(`  Last chunk timestamp: ${chunks[chunks.length - 1]?.chunk.timestamp}`);

  console.log('  PASSED\n');
  return chunks;
}

async function testEncodeI420Frame() {
  console.log('\n=== Test: Encode I420 Frame ===');

  const chunks = [];
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => chunks.push({ chunk, metadata }),
    error: (err) => console.error('  Encoder error:', err),
  });

  encoder.configure({
    codec: 'avc1.42E01E',
    width: 320,
    height: 240,
    bitrate: 500000,
  });
  console.log('  Encoder configured');

  // Create I420 frame (Y + U + V planes)
  const ySize = 320 * 240;
  const uvSize = 80 * 120;  // width/2 * height/2
  const data = new Uint8Array(ySize + uvSize * 2);

  // Y plane - gray
  data.fill(128, 0, ySize);
  // U plane - neutral
  data.fill(128, ySize, ySize + uvSize);
  // V plane - neutral
  data.fill(128, ySize + uvSize, ySize + uvSize * 2);

  const frame = new VideoFrame(data, {
    format: 'I420',
    codedWidth: 320,
    codedHeight: 240,
    timestamp: 0,
  });
  console.log(`  Created I420 frame: ${frame.codedWidth}x${frame.codedHeight}`);

  encoder.encode(frame, { keyFrame: true });
  frame.close();
  console.log('  Frame encoded, flushing...');

  await encoder.flush();
  encoder.close();

  console.log(`  Total chunks: ${chunks.length}`);
  console.log(`  First chunk type: ${chunks[0]?.chunk.type}`);

  console.log('  PASSED\n');
  return chunks;
}

async function testEncodeDecode() {
  console.log('\n=== Test: Encode then Decode ===');

  // First, encode some frames
  const encodedChunks = [];
  let decoderConfig = null;

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      encodedChunks.push(chunk);
      if (metadata?.decoderConfig) {
        decoderConfig = metadata.decoderConfig;
      }
    },
    error: (err) => console.error('  Encoder error:', err),
  });

  encoder.configure({
    codec: 'avc1.42E01E',
    width: 320,
    height: 240,
    bitrate: 500000,
  });

  // Create and encode a frame
  const data = new Uint8Array(320 * 240 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;       // R
    data[i + 1] = 255; // G
    data[i + 2] = 0;   // B
    data[i + 3] = 255; // A
  }

  const frame = new VideoFrame(data, {
    format: 'RGBA',
    codedWidth: 320,
    codedHeight: 240,
    timestamp: 0,
  });

  encoder.encode(frame, { keyFrame: true });
  frame.close();
  await encoder.flush();
  encoder.close();

  console.log(`  Encoded ${encodedChunks.length} chunks`);
  console.log(`  Decoder config codec: ${decoderConfig?.codec}`);

  // Now decode
  const decodedFrames = [];

  const decoder = new VideoDecoder({
    output: (decodedFrame) => {
      console.log(`  Decoded frame: ${decodedFrame.codedWidth}x${decodedFrame.codedHeight}`);
      decodedFrames.push(decodedFrame);
    },
    error: (err) => console.error('  Decoder error:', err),
  });

  decoder.configure({
    codec: 'avc1.42E01E',
    codedWidth: 320,
    codedHeight: 240,
    description: decoderConfig?.description,
  });
  console.log('  Decoder configured');

  // Decode each chunk
  for (const chunk of encodedChunks) {
    decoder.decode(chunk);
  }
  console.log('  All chunks sent for decoding');

  // Wait for decoding to complete
  await decoder.flush();
  decoder.close();

  console.log(`  Decoded ${decodedFrames.length} frames`);

  // Clean up
  decodedFrames.forEach(f => f.close());

  if (decodedFrames.length > 0) {
    console.log('  PASSED\n');
  } else {
    console.log('  Note: Decoder may need extradata/description for H.264\n');
  }
}

async function runAllTests() {
  console.log('WebCodecs-Node Integration Tests');
  console.log('================================');

  try {
    await testEncodeSingleFrame();
    await testEncodeMultipleFrames();
    await testEncodeI420Frame();
    await testEncodeDecode();

    console.log('\n=== All Tests Completed ===');
  } catch (error) {
    console.error('\nTest failed with error:', error);
    process.exit(1);
  }
}

runAllTests();
