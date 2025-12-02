const { VideoEncoder, VideoFrame } = require('../dist/index.js');

async function test() {
  const width = 64;
  const height = 64;
  
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      console.log('Got chunk:', chunk.type, chunk.byteLength, 'bytes');
    },
    error: (error) => {
      console.error('Encoder error:', error);
    },
  });

  encoder.configure({
    codec: 'vp09.00.10.08',
    width,
    height,
    bitrate: 500_000,
    framerate: 30,
    alpha: 'keep',
  });

  console.log('Encoder state:', encoder.state);
  
  // Create RGBA frame with alpha
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 255;     // R
    data[i * 4 + 1] = 0;   // G
    data[i * 4 + 2] = 0;   // B
    data[i * 4 + 3] = 128; // A = 50% transparent
  }
  
  console.log('Creating RGBA frame with alpha...');
  const frame = new VideoFrame(data, {
    format: 'RGBA',
    codedWidth: width,
    codedHeight: height,
    timestamp: 0,
  });
  
  console.log('Frame format:', frame.format);
  console.log('Encoding...');
  encoder.encode(frame, { keyFrame: true });
  frame.close();
  
  console.log('Flushing...');
  await encoder.flush();
  encoder.close();
  console.log('Done');
}

test().catch(console.error);
