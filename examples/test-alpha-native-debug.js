// Test to verify the native frame format
const native = require('../build/Release/webcodecs_node.node');
const { VideoEncoder, VideoFrame } = require('../dist/index.js');

// Create a simple test
const width = 64;
const height = 64;
const data = new Uint8Array(width * height * 4);

// Fill with semi-transparent red
for (let i = 0; i < width * height; i++) {
  data[i * 4] = 255;     // R
  data[i * 4 + 1] = 0;   // G
  data[i * 4 + 2] = 0;   // B
  data[i * 4 + 3] = 128; // A = 50% transparent
}

const frame = new VideoFrame(data, {
  format: 'RGBA',
  codedWidth: width,
  codedHeight: height,
  timestamp: 0,
});

console.log('JS Frame format:', frame.format);

// Check if the native frame has proper RGBA format (format ID 26 = AV_PIX_FMT_RGBA)
// We can check by copying back
const buffer = new Uint8Array(width * height * 4);
frame.copyTo(buffer, { format: 'RGBA' });

console.log('First pixel after round-trip:');
console.log('  R:', buffer[0], '(expected 255)');
console.log('  G:', buffer[1], '(expected 0)');
console.log('  B:', buffer[2], '(expected 0)');
console.log('  A:', buffer[3], '(expected 128)');

frame.close();
