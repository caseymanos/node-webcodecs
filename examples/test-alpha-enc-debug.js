const native = require('../build/Release/webcodecs_node.node');

// Create encoder directly with native API to see what happens
const encoder = new native.VideoEncoder(
  (chunk) => { console.log('Got chunk:', chunk.byteLength); },
  (error) => { console.error('Error:', error); }
);

encoder.configure({
  codec: 'vp09.00.10.08',
  width: 64,
  height: 64,
  bitrate: 500000,
  framerate: 30,
  alpha: 'keep'
});

console.log('Encoder configured with alpha: keep');

// Create a frame with RGBA
const frame = new native.VideoFrame(
  new Uint8Array(64 * 64 * 4).fill(128),
  {
    format: 'RGBA',
    codedWidth: 64,
    codedHeight: 64,
    timestamp: 0
  }
);

console.log('Frame created with format:', frame.format);

encoder.encode(frame, false);
frame.close();

encoder.flush().then(() => {
  console.log('Flush complete');
  encoder.close();
});
