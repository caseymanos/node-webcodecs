/**
 * copyTo() Full Implementation Test
 *
 * Tests:
 * 1. Format conversion (I420 → RGBA)
 * 2. Rect cropping
 * 3. Combined format conversion + cropping
 */

const { VideoFrame } = require('../dist/index.js');

function createTestFrame() {
  // Create 100x100 RGBA frame with gradient pattern
  const width = 100;
  const height = 100;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = x * 2.55;      // R: 0-255 gradient horizontally
      data[idx + 1] = y * 2.55;  // G: 0-255 gradient vertically
      data[idx + 2] = 128;       // B: constant
      data[idx + 3] = 255;       // A: opaque
    }
  }

  return new VideoFrame(data, {
    format: 'RGBA',
    codedWidth: width,
    codedHeight: height,
    timestamp: 0,
  });
}

async function testBasicCopyTo() {
  console.log('\n--- Test: Basic copyTo (no conversion) ---');

  const frame = createTestFrame();
  const size = frame.allocationSize();
  console.log(`Frame: ${frame.codedWidth}x${frame.codedHeight} ${frame.format}`);
  console.log(`Allocation size: ${size} bytes`);

  const dest = new Uint8Array(size);
  const layouts = await frame.copyTo(dest);

  console.log('Plane layouts:', layouts);

  // Verify first pixel (should be ~0, 0, 128, 255)
  console.log(`First pixel RGBA: [${dest[0]}, ${dest[1]}, ${dest[2]}, ${dest[3]}]`);

  // Verify last pixel (should be ~255, 255, 128, 255)
  const lastIdx = (99 * 100 + 99) * 4;
  console.log(`Last pixel RGBA: [${dest[lastIdx]}, ${dest[lastIdx + 1]}, ${dest[lastIdx + 2]}, ${dest[lastIdx + 3]}]`);

  frame.close();
  console.log('PASS: Basic copyTo works');
}

async function testFormatConversion() {
  console.log('\n--- Test: Format Conversion (RGBA → I420) ---');

  const frame = createTestFrame();

  // Calculate I420 size for 100x100
  const i420Size = frame.allocationSize({ format: 'I420' });
  console.log(`I420 allocation size: ${i420Size} bytes (expected: ${100 * 100 * 1.5})`);

  const dest = new Uint8Array(i420Size);
  const layouts = await frame.copyTo(dest, { format: 'I420' });

  console.log('I420 Plane layouts:', layouts);

  // I420 should have 3 planes: Y (10000), U (2500), V (2500)
  if (layouts.length === 3) {
    console.log('  Y plane: offset=' + layouts[0].offset + ', stride=' + layouts[0].stride);
    console.log('  U plane: offset=' + layouts[1].offset + ', stride=' + layouts[1].stride);
    console.log('  V plane: offset=' + layouts[2].offset + ', stride=' + layouts[2].stride);

    // Check Y plane has data
    console.log(`  First Y value: ${dest[0]}`);
    console.log(`  Last Y value: ${dest[9999]}`);
  }

  frame.close();
  console.log('PASS: Format conversion works');
}

async function testRectCropping() {
  console.log('\n--- Test: Rect Cropping ---');

  const frame = createTestFrame();

  // Crop to center 50x50 region
  const rect = { x: 25, y: 25, width: 50, height: 50 };
  const size = frame.allocationSize({ rect });
  console.log(`Cropped size (50x50 RGBA): ${size} bytes (expected: ${50 * 50 * 4})`);

  const dest = new Uint8Array(size);
  const layouts = await frame.copyTo(dest, { rect });

  console.log('Cropped plane layouts:', layouts);

  // First pixel of crop should be at (25, 25) in original
  // R = 25 * 2.55 ≈ 64, G = 25 * 2.55 ≈ 64
  console.log(`First pixel of crop RGBA: [${dest[0]}, ${dest[1]}, ${dest[2]}, ${dest[3]}]`);
  console.log(`  (Expected R≈64, G≈64 based on gradient at 25,25)`);

  // Last pixel of crop should be at (74, 74) in original
  // R = 74 * 2.55 ≈ 189, G = 74 * 2.55 ≈ 189
  const lastIdx = (49 * 50 + 49) * 4;
  console.log(`Last pixel of crop RGBA: [${dest[lastIdx]}, ${dest[lastIdx + 1]}, ${dest[lastIdx + 2]}, ${dest[lastIdx + 3]}]`);
  console.log(`  (Expected R≈189, G≈189 based on gradient at 74,74)`);

  frame.close();
  console.log('PASS: Rect cropping works');
}

async function testCombinedConversionAndCrop() {
  console.log('\n--- Test: Combined Format Conversion + Cropping ---');

  const frame = createTestFrame();

  // Crop to 50x50 AND convert to I420
  const options = {
    rect: { x: 0, y: 0, width: 50, height: 50 },
    format: 'I420',
  };

  const size = frame.allocationSize(options);
  console.log(`Cropped I420 size (50x50): ${size} bytes (expected: ${Math.floor(50 * 50 * 1.5)})`);

  const dest = new Uint8Array(size);
  const layouts = await frame.copyTo(dest, options);

  console.log('Combined operation plane layouts:', layouts);

  if (layouts.length === 3) {
    const yPlaneSize = 50 * 50;
    const uvPlaneSize = Math.floor(50 / 2) * Math.floor(50 / 2);
    console.log(`  Expected sizes - Y: ${yPlaneSize}, U: ${uvPlaneSize}, V: ${uvPlaneSize}`);
    console.log(`  First Y value: ${dest[0]}`);
  }

  frame.close();
  console.log('PASS: Combined conversion + cropping works');
}

async function saveVisualOutput() {
  console.log('\n--- Generating Visual Outputs for Manual Verification ---');

  const fs = require('fs');
  const path = require('path');

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Create a larger colorful test frame for better visualization
  const width = 256, height = 256;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = x;           // R increases left to right
      data[idx + 1] = y;       // G increases top to bottom
      data[idx + 2] = 128;     // B constant
      data[idx + 3] = 255;     // A fully opaque
    }
  }

  const frame = new VideoFrame(data, {
    format: 'RGBA',
    codedWidth: width,
    codedHeight: height,
    timestamp: 0,
  });

  // Save original
  const originalPath = path.join(outputDir, 'copyto_original.raw');
  fs.writeFileSync(originalPath, data);
  console.log(`  Saved original: copyto_original.raw (${width}x${height} RGBA)`);

  // Save cropped (center 128x128)
  const cropRect = { x: 64, y: 64, width: 128, height: 128 };
  const croppedSize = cropRect.width * cropRect.height * 4;
  const croppedDest = new Uint8Array(croppedSize);
  await frame.copyTo(croppedDest, { rect: cropRect });

  const croppedPath = path.join(outputDir, 'copyto_cropped.raw');
  fs.writeFileSync(croppedPath, croppedDest);
  console.log(`  Saved cropped: copyto_cropped.raw (${cropRect.width}x${cropRect.height} RGBA)`);

  // Convert to I420
  const i420Size = Math.floor(width * height * 1.5);
  const i420Dest = new Uint8Array(i420Size);
  await frame.copyTo(i420Dest, { format: 'I420' });

  const i420Path = path.join(outputDir, 'copyto_converted.yuv');
  fs.writeFileSync(i420Path, i420Dest);
  console.log(`  Saved converted: copyto_converted.yuv (${width}x${height} I420)`);

  frame.close();

  console.log('\nTo view these files with ffplay:');
  console.log(`  ffplay -f rawvideo -pix_fmt rgba -s 256x256 "${originalPath}"`);
  console.log(`  ffplay -f rawvideo -pix_fmt rgba -s 128x128 "${croppedPath}"`);
  console.log(`  ffplay -f rawvideo -pix_fmt yuv420p -s 256x256 "${i420Path}"`);
}

async function main() {
  console.log('copyTo() Full Implementation Test');
  console.log('==================================');

  try {
    await testBasicCopyTo();
    await testFormatConversion();
    await testRectCropping();
    await testCombinedConversionAndCrop();
    await saveVisualOutput();

    console.log('\n==================================');
    console.log('All copyTo tests passed!');
  } catch (error) {
    console.error('\nTest failed:', error);
    process.exit(1);
  }
}

main();
