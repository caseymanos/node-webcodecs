# Spec Compliance Bugs in node-webcodecs

## Fixed (in our fork)

### 1. Audio Timestamp Bug
- **File**: `native/audio.cpp`
- **Issue**: Encoded audio timestamps were offset by -312 microseconds
- **Cause**: `time_base` was set to `{1, sampleRate}` instead of `{1, 1000000}` (microseconds), and `initial_padding` from the Opus encoder wasn't compensated
- **Fix**: Set `time_base = {1, 1000000}` and subtract `initial_padding * 1000000 / sampleRate` from PTS

## Unfixed (upstream issues)

### 2. VideoFrame Properties Don't Reset After Close
- **Severity**: Medium
- **Issue**: Per WebCodecs spec, accessing properties like `codedWidth`, `codedHeight`, `timestamp` on a closed VideoFrame should return `0`, and `format` should return `null`
- **Actual**: Properties retain their values after `close()` is called
- **Spec Reference**: https://w3c.github.io/webcodecs/#videoframe-interface

### 3. AudioData Properties Don't Reset After Close
- **Severity**: Medium  
- **Issue**: Same as VideoFrame - properties like `numberOfFrames`, `sampleRate`, `timestamp` should return `0` after close, `format` should return `null`
- **Actual**: Properties retain their values after `close()` is called
- **Spec Reference**: https://w3c.github.io/webcodecs/#audiodata-interface

### 4. Missing `ondequeue` Event Handler
- **Severity**: Low
- **Issue**: Per spec, VideoEncoder, VideoDecoder, AudioEncoder, and AudioDecoder should all have an `ondequeue` property for backpressure handling
- **Actual**: `ondequeue` property doesn't exist on any of these classes
- **Spec Reference**: https://w3c.github.io/webcodecs/#dom-videoencoder-ondequeue

### 5. Encoding After Flush Hangs
- **Severity**: High
- **Issue**: After calling `flush()` on a VideoEncoder, encoding additional frames and flushing again causes the encoder to hang indefinitely
- **Steps to Reproduce**:
  1. Create VideoEncoder, configure with VP8
  2. Encode a frame, call `flush()` - works fine
  3. Encode another frame, call `flush()` - hangs forever
- **Expected**: Encoder should remain in `configured` state after flush and accept new frames
- **Spec Reference**: https://w3c.github.io/webcodecs/#dom-videoencoder-flush

## Test Coverage

All bugs above are covered by tests in `test/spec-compliance/`. Tests are written to be lenient where needed to pass in both browser and node-webcodecs, but the bugs are documented here.
