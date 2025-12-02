/**
 * Visual Test for copyTo() - Outputs PNG files for inspection
 *
 * Creates test patterns and saves them as PNG files to verify:
 * 1. Format conversion produces correct colors
 * 2. Rect cropping extracts the right region
 */

const { VideoFrame } = require('../dist/index.js');
const fs = require('fs');
const path = require('path');

// Simple PNG encoder (uncompressed for simplicity)
function writePNG(filename, width, height, rgbaData) {
  const { execSync } = require('child_process');

  // Write raw RGBA to temp file, then use ffmpeg to convert to PNG
  const rawPath = filename + '.raw';
  fs.writeFileSync(rawPath, Buffer.from(rgbaData));

  try {
    execSync(`ffmpeg -y -f rawvideo -pix_fmt rgba -s ${width}x${height} -i "${rawPath}" "${filename}" 2>/dev/null`);
    fs.unlinkSync(rawPath);
    console.log(`  Saved: ${path.basename(filename)}`);
  } catch (e) {
    console.error(`  Failed to save PNG: ${e.message}`);
  }
}

async function main() {
  console.log('copyTo() Visual Test');
  console.log('====================\n');

  const outputDir = path.join(__dirname, 'output', 'copyto-test');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Test 1: Create a colorful gradient pattern
  console.log('Test 1: Original Frame (200x200 color gradient)');
  const width = 200;
  const height = 200;
  const originalData = new Uint8Array(width * height * 4);

  // Create a color gradient:
  // - Red increases left to right
  // - Green increases top to bottom
  // - Blue is constant at 100
  // - Add colored quadrants for easy verification
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Base gradient
      let r = Math.floor((x / width) * 255);
      let g = Math.floor((y / height) * 255);
      let b = 100;

      // Add distinct colored corners for easy visual verification
      if (x < 50 && y < 50) {
        // Top-left: Red
        r = 255; g = 0; b = 0;
      } else if (x >= 150 && y < 50) {
        // Top-right: Green
        r = 0; g = 255; b = 0;
      } else if (x < 50 && y >= 150) {
        // Bottom-left: Blue
        r = 0; g = 0; b = 255;
      } else if (x >= 150 && y >= 150) {
        // Bottom-right: Yellow
        r = 255; g = 255; b = 0;
      }

      originalData[idx] = r;
      originalData[idx + 1] = g;
      originalData[idx + 2] = b;
      originalData[idx + 3] = 255;
    }
  }

  const frame = new VideoFrame(originalData, {
    format: 'RGBA',
    codedWidth: width,
    codedHeight: height,
    timestamp: 0,
  });

  // Save original
  writePNG(path.join(outputDir, '1_original.png'), width, height, originalData);

  // Test 2: Crop center region (should get gradient, no colored corners)
  console.log('\nTest 2: Center Crop (50,50 to 150,150) - should be gradient only');
  const cropRect = { x: 50, y: 50, width: 100, height: 100 };
  const cropSize = frame.allocationSize({ rect: cropRect });
  const croppedData = new Uint8Array(cropSize);
  await frame.copyTo(croppedData, { rect: cropRect });
  writePNG(path.join(outputDir, '2_center_crop.png'), 100, 100, croppedData);

  // Test 3: Crop top-left corner (should be red)
  console.log('\nTest 3: Top-Left Crop (0,0 to 50,50) - should be RED');
  const tlRect = { x: 0, y: 0, width: 50, height: 50 };
  const tlSize = frame.allocationSize({ rect: tlRect });
  const tlData = new Uint8Array(tlSize);
  await frame.copyTo(tlData, { rect: tlRect });
  writePNG(path.join(outputDir, '3_topleft_red.png'), 50, 50, tlData);

  // Test 4: Crop bottom-right corner (should be yellow)
  console.log('\nTest 4: Bottom-Right Crop (150,150 to 200,200) - should be YELLOW');
  const brRect = { x: 150, y: 150, width: 50, height: 50 };
  const brSize = frame.allocationSize({ rect: brRect });
  const brData = new Uint8Array(brSize);
  await frame.copyTo(brData, { rect: brRect });
  writePNG(path.join(outputDir, '4_bottomright_yellow.png'), 50, 50, brData);

  // Test 5: Format conversion RGBA -> I420 -> RGBA roundtrip
  console.log('\nTest 5: Format Conversion (RGBA -> I420 -> RGBA)');

  // Convert to I420
  const i420Size = frame.allocationSize({ format: 'I420' });
  const i420Data = new Uint8Array(i420Size);
  await frame.copyTo(i420Data, { format: 'I420' });

  // Create a new frame from I420 data
  const i420Frame = new VideoFrame(i420Data, {
    format: 'I420',
    codedWidth: width,
    codedHeight: height,
    timestamp: 0,
  });

  // Convert back to RGBA
  const rgbaSize = i420Frame.allocationSize({ format: 'RGBA' });
  const rgbaRoundtrip = new Uint8Array(rgbaSize);
  await i420Frame.copyTo(rgbaRoundtrip, { format: 'RGBA' });
  writePNG(path.join(outputDir, '5_roundtrip_i420.png'), width, height, rgbaRoundtrip);
  console.log('  (Colors may shift slightly due to YUV conversion - this is expected)');

  i420Frame.close();

  // Test 6: Combined crop + format conversion
  console.log('\nTest 6: Combined Crop + Format Conversion');
  console.log('  Crop center 100x100, convert RGBA->I420->RGBA');

  const combinedRect = { x: 50, y: 50, width: 100, height: 100 };
  const combinedI420Size = frame.allocationSize({ rect: combinedRect, format: 'I420' });
  const combinedI420 = new Uint8Array(combinedI420Size);
  await frame.copyTo(combinedI420, { rect: combinedRect, format: 'I420' });

  // Create frame and convert back
  const combinedFrame = new VideoFrame(combinedI420, {
    format: 'I420',
    codedWidth: 100,
    codedHeight: 100,
    timestamp: 0,
  });

  const combinedRgbaSize = combinedFrame.allocationSize({ format: 'RGBA' });
  const combinedRgba = new Uint8Array(combinedRgbaSize);
  await combinedFrame.copyTo(combinedRgba, { format: 'RGBA' });
  writePNG(path.join(outputDir, '6_combined_crop_convert.png'), 100, 100, combinedRgba);

  combinedFrame.close();
  frame.close();

  console.log('\n====================');
  console.log('Visual test files saved to:');
  console.log(`  ${outputDir}/`);
  console.log('\nExpected results:');
  console.log('  1_original.png         - 200x200, colored corners (R/G/B/Y), gradient center');
  console.log('  2_center_crop.png      - 100x100, gradient only (no colored corners)');
  console.log('  3_topleft_red.png      - 50x50, solid RED');
  console.log('  4_bottomright_yellow.png - 50x50, solid YELLOW');
  console.log('  5_roundtrip_i420.png   - 200x200, same as original (slight color shift OK)');
  console.log('  6_combined_crop_convert.png - 100x100, gradient (slight color shift OK)');
}

main().catch(console.error);
