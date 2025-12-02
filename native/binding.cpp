#include <napi.h>
#include "frame.h"
#include "audio.h"
#include "encoder.h"
#include "decoder.h"
#include "image_decoder.h"
#include "async_encoder.h"
#include "async_decoder.h"
#include "capability_probe.h"

// Forward declaration
void InitUtil(Napi::Env env, Napi::Object exports);

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Initialize frame classes
    VideoFrameNative::Init(env, exports);

    // Initialize audio classes
    AudioDataNative::Init(env, exports);
    AudioDecoderNative::Init(env, exports);
    AudioEncoderNative::Init(env, exports);

    // Initialize video encoder/decoder (sync versions)
    VideoEncoderNative::Init(env, exports);
    VideoDecoderNative::Init(env, exports);

    // Initialize async video encoder/decoder (non-blocking versions)
    VideoEncoderAsync::Init(env, exports);
    VideoDecoderAsync::Init(env, exports);

    // Initialize image decoder
    ImageDecoderNative::Init(env, exports);

    // Initialize capability probe for isConfigSupported
    CapabilityProbe::Init(env, exports);

    // Add factory functions
    exports.Set("createVideoFrame", Napi::Function::New(env, CreateVideoFrame));
    exports.Set("createAudioData", Napi::Function::New(env, CreateAudioData));

    // Initialize utilities
    InitUtil(env, exports);

    return exports;
}

NODE_API_MODULE(webcodecs_node, Init)
