#ifndef CAPABILITY_PROBE_H
#define CAPABILITY_PROBE_H

#include <napi.h>
#include <string>

/**
 * CapabilityProbe - Probes FFmpeg/hardware capabilities for isConfigSupported
 *
 * This module actually attempts to open codecs to verify support,
 * rather than just checking codec string format.
 */
class CapabilityProbe {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);

    /**
     * Probe if a video encoder configuration is supported
     * Actually tries to open the codec with the given parameters
     */
    static Napi::Value ProbeVideoEncoder(const Napi::CallbackInfo& info);

    /**
     * Probe if a video decoder configuration is supported
     */
    static Napi::Value ProbeVideoDecoder(const Napi::CallbackInfo& info);

    /**
     * Probe if an audio encoder configuration is supported
     */
    static Napi::Value ProbeAudioEncoder(const Napi::CallbackInfo& info);

    /**
     * Probe if an audio decoder configuration is supported
     */
    static Napi::Value ProbeAudioDecoder(const Napi::CallbackInfo& info);
};

#endif // CAPABILITY_PROBE_H
