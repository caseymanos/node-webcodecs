# Changelog

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
