# Changelog

## [1.3.1] - 2026-07-18

### Fixed
- Intermittent crash at process exit (SIGSEGV/SIGABRT during teardown). Each codec instance registered an env cleanup hook pointing into itself and never removed it; instances collected during the process's lifetime left dangling hooks that corrupted Node's cleanup queue when run at exit. One process-level flag now serves all instances, and codec objects are pinned while work is in flight so queued completion callbacks can never outlive them. Also the likely cause of the ubuntu CI flake since v1.2.0 and the FFmpeg-7.x static-build aborts.

## [1.3.0] - 2026-07-15

### Added
- **Zero-dependency installs**: statically-linked FFmpeg prebuilds for linux-x64, linux-arm64, and darwin-arm64, shipped as platform-specific `@node-webcodecs/static-*` optional dependencies (~15 MB each, only your platform downloads). `npm install node-webcodecs` now works in any Docker base image (including `node:22`), Lambda, and Fly with no FFmpeg installed.
- Loader resolution order: dynamic prebuild (system FFmpeg, preferred) → static prebuild → source build. Override with `NODE_WEBCODECS_FORCE=dynamic|static|source`; inspect with the new `getNativeVariant()` export.
- The static build is LGPL-only (FFmpeg `--disable-gpl` + BSD codec libs): H.264 encode via openh264, AV1 encode via SVT-AV1, AV1 decode via dav1d, VP8/VP9 via libvpx, plus native AAC/FLAC/PCM, libopus, and libmp3lame. Software HEVC encode is unavailable in the static variant (no x265); hardware HEVC (VideoToolbox, NVENC) still works.


## [1.2.2] - 2026-07-14

### Added
- Linux arm64 prebuilt binaries (Graviton, Docker on Apple Silicon)

## [1.2.1] - 2026-07-14

### Fixed
- Source builds work again on platforms without prebuilds (install fallback ran cmake-js, a devDependency; now via npx) and on FFmpeg 5.x (AVFrame.duration version guard) — notably the default `node:22` Docker image
- Encoder capability probe now falls back to software when the hardware candidate fails to open (e.g. no GPU in a container); previously `isConfigSupported` wrongly reported H.264 unsupported on GPU-less Linux, causing Mediabunny to fall back to AV1
- Deep imports (`node-webcodecs/dist/*`) work again alongside the new exports map

## [1.2.0] - 2026-07-14

### Added
- `node-webcodecs/register` — installs the WebCodecs classes on `globalThis`, so browser-first libraries (e.g. Mediabunny) run unmodified in Node
- `node-webcodecs/mediabunny` — one-line Mediabunny integration: globals plus a `VideoSample` transformer so `Conversion` resizing works without a canvas
- `VideoFrame._scale()` — native multithreaded scaling (used by the transformer)

### Fixed
- Decoder and encoder were unusable after `flush()` (FFmpeg left in EOF state); per the WebCodecs spec they now accept new work after a flush. This also fixes Mediabunny's frame-accurate seeking.
- `optimizeForLatency` was accepted but ignored; it now restricts the decoder to slice threading with `AV_CODEC_FLAG_LOW_DELAY`
- Processes no longer hang after codec work completes: the event loop is held only while encodes/decodes/flushes are in flight

## [1.1.5] - 2026-07-14

### Improved
- Multithreaded pixel format conversion in encoders (sws_getContext is single-threaded; now threads=auto). RGBA->YUV at 1080p drops ~5ms to ~2.5ms per frame; VP9 encode from RGBA goes 35 -> 60 fps.

## [1.1.4] - 2026-07-14

### Highlights
- **Up to 6x faster decoding** - FFmpeg threading was never enabled (thread_count defaulted to 1); decoders and the non-realtime encoder path now auto-detect core count
- **Zero-copy decode output** - decoded frames are adopted directly instead of being copied twice per frame on the JS thread

Benchmarks (1080p, 150 frames, M4 Pro, median of 3): H.264 decode 310 → 1839 fps, VP9 decode 470 → 1577 fps, VP9 encode 15 → 49 fps.

### Fixed
- `AudioDecoder.flush()` resolved before deferred outputs were emitted, so outputs read after `await flush()` appeared empty
- VP9/VP8 encoding never enabled `row-mt` (and VP9 got no tile columns), preventing multithreaded encoding

### Improved
- `VideoFrame` buffer constructor no longer keeps a redundant JS-side copy when a native frame exists (~8 MB less memcpy/GC per 1080p RGBA frame)
- Publish and CI now gate on the spec-compliance suite in addition to unit tests

## [1.0.0] - 2025-12-30

### Highlights
- **100% vjeux harness compliance** - All 84 tests passing
- **Production ready** - Stable API, comprehensive test coverage

### Fixed
- Audio timestamp handling for AAC, Opus, Vorbis
- FLAC metadata description
- MP3 encoder configuration
- Video conversion timeouts (AVC, HEVC, VP9, AV1)
- Decoder queue size tracking
- VideoEncoder color space metadata
- AudioDecoder closed state format

### Improved
- Test execution time reduced from 41.79s to ~14s
- Adaptive encoder presets based on resolution
- Frame handling optimization with av_frame_ref

## [0.4.2] - 2025-12-17

- Documentation improvements
- Mintlify docs setup

## [0.4.1] - 2025-12-10

- Bug fixes and stability improvements

## [0.4.0] - 2025-12-05

- Initial public release
- Video encoding/decoding (H.264, HEVC, VP8, VP9, AV1)
- Audio encoding/decoding (AAC, Opus, FLAC, MP3)
- Hardware acceleration support (VideoToolbox, NVENC, QuickSync, VA-API)
- ImageDecoder for static images
