#!/usr/bin/env node
// Generates a per-platform @node-webcodecs/static-* package (napi-rs style)
// around a statically-linked webcodecs.node.
//
// Usage: node scripts/make-static-package.js <platform> <arch> <webcodecs.node> [outDir]
'use strict';

const fs = require('fs');
const path = require('path');

const [platform, arch, nodeBinary, outBase] = process.argv.slice(2);
if (!platform || !arch || !nodeBinary) {
  console.error('usage: make-static-package.js <platform> <arch> <webcodecs.node> [outDir]');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const main = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `@node-webcodecs/static-${platform}-${arch}`;
const outDir = path.resolve(outBase || path.join(root, 'npm-static', `${platform}-${arch}`));

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(nodeBinary, path.join(outDir, 'webcodecs.node'));

fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({
  name,
  version: main.version,
  description: `Statically-linked FFmpeg build of node-webcodecs for ${platform}-${arch}`,
  main: 'index.js',
  files: ['index.js', 'webcodecs.node', 'THIRD_PARTY_NOTICES.md'],
  // binary statically embeds LGPL/BSD components; see THIRD_PARTY_NOTICES.md
  license: 'MIT AND LGPL-2.1-or-later AND BSD-2-Clause AND BSD-3-Clause',
  repository: main.repository,
  os: [platform],
  cpu: [arch],
  engines: main.engines,
}, null, 2) + '\n');

fs.writeFileSync(path.join(outDir, 'index.js'),
  "module.exports = require('./webcodecs.node');\n");

fs.writeFileSync(path.join(outDir, 'THIRD_PARTY_NOTICES.md'), `# Third-party notices

This binary statically links the following libraries:

- FFmpeg (libavcodec, libavutil, libswscale, libswresample) — LGPL-2.1-or-later,
  built with \`--disable-gpl\` (no GPL components). Source: https://ffmpeg.org
- openh264 — BSD-2-Clause © Cisco Systems. https://github.com/cisco/openh264
  (compiled from source; H.264 patent licensing is the responsibility of the user)
- libvpx — BSD-3-Clause. https://github.com/webmproject/libvpx
- SVT-AV1 — BSD-3-Clause-Clear + Alliance for Open Media Patent License 1.0.
  https://gitlab.com/AOMediaCodec/SVT-AV1
- dav1d — BSD-2-Clause © VideoLAN. https://code.videolan.org/videolan/dav1d
- opus — BSD-3-Clause © Xiph.Org. https://opus-codec.org
- LAME — LGPL-2.1-or-later. https://lame.sourceforge.io
- zlib — zlib license. https://zlib.net

Exact versions and build flags: scripts/ffmpeg-static/build.sh in
https://github.com/caseymanos/node-webcodecs (tag v${main.version}).
LGPL compliance: the LGPL libraries are unmodified upstream releases; you can
relink against modified versions by rebuilding with that script.
`);

fs.writeFileSync(path.join(outDir, 'README.md'), `# ${name}

Statically-linked FFmpeg prebuild of [node-webcodecs](https://www.npmjs.com/package/node-webcodecs) for ${platform}-${arch}.
Installed automatically as an optionalDependency — don't depend on this directly.

Codecs: H.264 (decode native / encode openh264), HEVC/VP8/VP9 decode, VP8/VP9
encode (libvpx), AV1 (decode dav1d / encode SVT-AV1), AAC, Opus, FLAC, MP3,
PCM, images (PNG/JPEG/WebP/GIF/BMP/TIFF). No GPL components: software HEVC
encode is unavailable (hardware HEVC still works where present).
`);

console.log(`wrote ${name}@${main.version} -> ${outDir}`);
