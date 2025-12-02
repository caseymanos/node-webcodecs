/**
 * Color Space Verification Test
 *
 * Tests multiple color space configurations:
 * 1. SDR (BT.709)
 * 2. HDR PQ (BT.2020 + PQ)
 * 3. HDR HLG (BT.2020 + HLG)
 */

const { VideoEncoder, VideoFrame } = require('../dist/index.js');
const fs = require('fs');
const path = require('path');

async function encodeWithColorSpace(name, colorSpace) {
  console.log(`\n--- Testing: ${name} ---`);
  console.log('Config:', JSON.stringify(colorSpace, null, 2));

  const encodedChunks = [];

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      encodedChunks.push(data);
    },
    error: (error) => {
      console.error('Encoder error:', error);
    },
  });

  const config = {
    codec: 'avc1.640028',
    width: 640,
    height: 480,
    bitrate: 2_000_000,
    framerate: 30,
  };

  if (colorSpace) {
    config.colorSpace = colorSpace;
  }

  encoder.configure(config);

  // Encode 5 frames
  for (let i = 0; i < 5; i++) {
    const data = new Uint8Array(640 * 480 * 4);
    for (let j = 0; j < data.length; j += 4) {
      data[j] = 128;
      data[j + 1] = 128;
      data[j + 2] = 128;
      data[j + 3] = 255;
    }

    const frame = new VideoFrame(data, {
      format: 'RGBA',
      codedWidth: 640,
      codedHeight: 480,
      timestamp: i * 33333,
    });

    encoder.encode(frame, { keyFrame: i === 0 });
    frame.close();
  }

  await encoder.flush();
  encoder.close();

  // Write to file
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = `colorspace_${name.toLowerCase().replace(/[\s()]/g, '_')}.h264`;
  const outputPath = path.join(outputDir, filename);

  const totalSize = encodedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const outputData = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of encodedChunks) {
    outputData.set(chunk, offset);
    offset += chunk.byteLength;
  }

  fs.writeFileSync(outputPath, outputData);
  console.log(`Written to: ${filename}`);

  return outputPath;
}

async function main() {
  console.log('Color Space Verification Suite');
  console.log('==============================');

  const tests = [
    {
      name: 'SDR_BT709',
      colorSpace: {
        primaries: 'bt709',
        transfer: 'bt709',
        matrix: 'bt709',
        fullRange: false,
      },
      expected: {
        primaries: 'bt709',
        transfer: 'bt709',
        space: 'bt709',
        range: 'tv',
      },
    },
    {
      name: 'HDR_PQ',
      colorSpace: {
        primaries: 'bt2020',
        transfer: 'pq',
        matrix: 'bt2020-ncl',
        fullRange: false,
      },
      expected: {
        primaries: 'bt2020',
        transfer: 'smpte2084',
        space: 'bt2020nc',
        range: 'tv',
      },
    },
    {
      name: 'HDR_HLG',
      colorSpace: {
        primaries: 'bt2020',
        transfer: 'hlg',
        matrix: 'bt2020-ncl',
        fullRange: false,
      },
      expected: {
        primaries: 'bt2020',
        transfer: 'arib-std-b67',
        space: 'bt2020nc',
        range: 'tv',
      },
    },
    {
      name: 'FullRange',
      colorSpace: {
        primaries: 'bt709',
        transfer: 'bt709',
        matrix: 'bt709',
        fullRange: true,
      },
      expected: {
        primaries: 'bt709',
        transfer: 'bt709',
        space: 'bt709',
        range: 'pc',
      },
    },
    {
      name: 'DisplayP3',
      colorSpace: {
        primaries: 'smpte432',
        transfer: 'iec61966-2-1',  // sRGB
        matrix: 'bt709',
        fullRange: false,
      },
      expected: {
        primaries: 'smpte432',
        transfer: 'iec61966-2-1',
        space: 'bt709',
        range: 'tv',
      },
    },
  ];

  const results = [];

  for (const test of tests) {
    const outputPath = await encodeWithColorSpace(test.name, test.colorSpace);
    results.push({ name: test.name, path: outputPath, expected: test.expected });
  }

  console.log('\n\n=== Verification with ffprobe ===\n');

  const { execSync } = require('child_process');

  for (const result of results) {
    console.log(`\n${result.name}:`);
    try {
      const output = execSync(
        `ffprobe -v quiet -show_entries stream=color_primaries,color_transfer,color_space,color_range "${result.path}"`,
        { encoding: 'utf8' }
      );

      const lines = output.trim().split('\n');
      const values = {};
      for (const line of lines) {
        const match = line.match(/^(color_\w+)=(.+)$/);
        if (match) {
          values[match[1]] = match[2];
        }
      }

      console.log('  Actual:');
      console.log(`    primaries: ${values.color_primaries || 'unknown'}`);
      console.log(`    transfer:  ${values.color_transfer || 'unknown'}`);
      console.log(`    space:     ${values.color_space || 'unknown'}`);
      console.log(`    range:     ${values.color_range || 'unknown'}`);

      // Check against expected
      const checks = [];
      if (values.color_primaries === result.expected.primaries) checks.push('primaries OK');
      else checks.push(`primaries MISMATCH (expected ${result.expected.primaries})`);

      if (values.color_transfer === result.expected.transfer) checks.push('transfer OK');
      else checks.push(`transfer MISMATCH (expected ${result.expected.transfer})`);

      if (values.color_space === result.expected.space) checks.push('space OK');
      else checks.push(`space MISMATCH (expected ${result.expected.space})`);

      if (values.color_range === result.expected.range) checks.push('range OK');
      else checks.push(`range MISMATCH (expected ${result.expected.range})`);

      console.log('  Result:', checks.join(', '));
    } catch (e) {
      console.log('  Error running ffprobe:', e.message);
    }
  }

  console.log('\n\nTest complete!');
}

main().catch(console.error);
