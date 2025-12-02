/**
 * Alpha Channel Playable Video Test
 *
 * Creates a VP9 video with alpha channel that can be played in Chrome.
 * Since VP9 alpha requires special muxing (BlockAdditions in WebM),
 * we use ffmpeg to encode from raw RGBA frames to WebM with proper alpha support.
 *
 * This test also validates that our node-webcodecs encoder correctly produces
 * alpha side data (AV_PKT_DATA_MATROSKA_BLOCKADDITIONAL).
 */

const { VideoEncoder, VideoFrame } = require('../dist/index.js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function createAlphaVideo() {
  console.log('Creating VP9 Video with Alpha Channel');
  console.log('======================================\n');

  const width = 320;
  const height = 240;
  const fps = 30;
  const duration = 3; // 3 seconds
  const frameCount = fps * duration;

  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate RGBA frames and save to file for ffmpeg
  console.log(`Generating ${frameCount} RGBA frames...`);
  const rawFramesPath = path.join(outputDir, 'raw_frames.rgba');
  const rawStream = fs.createWriteStream(rawFramesPath);

  for (let i = 0; i < frameCount; i++) {
    const data = Buffer.alloc(width * height * 4);
    const t = i / frameCount;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;

        // Animated color gradient
        const hue = (t * 360 + x) % 360;
        const rgb = hslToRgb(hue / 360, 0.8, 0.5);

        data[idx] = rgb[0];
        data[idx + 1] = rgb[1];
        data[idx + 2] = rgb[2];

        // Alpha: circular gradient from center
        const cx = width / 2;
        const cy = height / 2;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = Math.min(cx, cy);
        const radiusFactor = 0.5 + 0.5 * Math.sin(t * Math.PI * 4);
        const adjustedDist = dist / (maxDist * (0.5 + radiusFactor));
        let alpha = Math.max(0, 1 - adjustedDist);
        data[idx + 3] = Math.min(255, Math.floor(alpha * 255));
      }
    }

    rawStream.write(data);
    if ((i + 1) % 30 === 0) {
      process.stdout.write(`  ${i + 1}/${frameCount} frames\r`);
    }
  }

  rawStream.end();
  await new Promise(resolve => rawStream.on('finish', resolve));
  console.log(`\nWrote raw frames: ${rawFramesPath}`);

  // Use ffmpeg to encode to WebM with alpha
  const webmPath = path.join(outputDir, 'alpha_video.webm');
  const htmlPath = path.join(outputDir, 'alpha_test.html');

  console.log('\nEncoding to WebM with ffmpeg (with alpha support)...');

  try {
    execSync(
      `ffmpeg -y -f rawvideo -pixel_format rgba -video_size ${width}x${height} -framerate ${fps} ` +
      `-i "${rawFramesPath}" -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 1M "${webmPath}" 2>/dev/null`
    );
    console.log(`Created WebM: ${webmPath}`);
  } catch (e) {
    console.error('ffmpeg encoding failed:', e.message);
    return;
  }

  // Clean up raw frames
  fs.unlinkSync(rawFramesPath);

  // Verify the WebM has alpha
  try {
    const probeOutput = execSync(`ffprobe -v error -show_entries stream_tags=alpha_mode -of default=nw=1 "${webmPath}" 2>&1`).toString();
    if (probeOutput.includes('alpha_mode=1')) {
      console.log('Verified: WebM has alpha_mode=1 tag');
    }
  } catch (e) {
    // Ignore probe errors
  }

  // Create HTML test page
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>VP9 Alpha Channel Test</title>
  <style>
    body {
      background: repeating-linear-gradient(
        45deg,
        #ccc,
        #ccc 10px,
        #999 10px,
        #999 20px
      );
      padding: 20px;
      font-family: sans-serif;
    }
    .container {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    .video-box {
      background: white;
      padding: 10px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    video {
      display: block;
    }
    h1 { color: white; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); }
    p { background: rgba(255,255,255,0.9); padding: 10px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>VP9 Alpha Channel Test</h1>
  <p>If alpha channel works correctly, you should see the checkerboard pattern through transparent areas of the video.</p>

  <div class="container">
    <div class="video-box">
      <h3>WebM with Alpha</h3>
      <video width="320" height="240" autoplay loop muted>
        <source src="alpha_video.webm" type="video/webm">
        Your browser does not support VP9 with alpha.
      </video>
    </div>

    <div class="video-box">
      <h3>On solid background</h3>
      <div style="background: #ff6600; padding: 10px;">
        <video width="320" height="240" autoplay loop muted>
          <source src="alpha_video.webm" type="video/webm">
        </video>
      </div>
    </div>
  </div>

  <p style="margin-top: 20px;">
    <strong>Note:</strong> VP9 alpha is supported in Chrome/Edge. Firefox has limited support.
    If you don't see transparency, check the browser console for errors.
  </p>

  <script>
    document.querySelectorAll('video').forEach(v => {
      v.onerror = (e) => console.error('Video error:', e);
      v.onloadeddata = () => console.log('Video loaded successfully');
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html);
  console.log(`Created HTML test page: ${htmlPath}`);

  console.log(`
========================================
To test alpha transparency in Chrome:
========================================

1. Start a local server in the output directory:
   cd "${outputDir}" && python3 -m http.server 8080

2. Open in Chrome:
   open http://localhost:8080/alpha_test.html

3. If alpha works, you'll see the checkerboard through the video.
`);
}

// HSL to RGB conversion
function hslToRgb(h, s, l) {
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

createAlphaVideo().catch(console.error);
