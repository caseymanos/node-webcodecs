#include "capability_probe.h"
#include "hw_accel.h"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/opt.h>
}

Napi::Object CapabilityProbe::Init(Napi::Env env, Napi::Object exports) {
    Napi::Object probe = Napi::Object::New(env);

    probe.Set("probeVideoEncoder", Napi::Function::New(env, ProbeVideoEncoder));
    probe.Set("probeVideoDecoder", Napi::Function::New(env, ProbeVideoDecoder));
    probe.Set("probeAudioEncoder", Napi::Function::New(env, ProbeAudioEncoder));
    probe.Set("probeAudioDecoder", Napi::Function::New(env, ProbeAudioDecoder));

    exports.Set("CapabilityProbe", probe);
    return exports;
}

Napi::Value CapabilityProbe::ProbeVideoEncoder(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "Config object required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object config = info[0].As<Napi::Object>();

    // Get required parameters
    std::string codecName = config.Get("codec").As<Napi::String>().Utf8Value();
    int width = config.Get("width").As<Napi::Number>().Int32Value();
    int height = config.Get("height").As<Napi::Number>().Int32Value();

    // Get optional hardware preference
    std::string hwPrefStr = "no-preference";
    if (config.Has("hardwareAcceleration") && config.Get("hardwareAcceleration").IsString()) {
        hwPrefStr = config.Get("hardwareAcceleration").As<Napi::String>().Utf8Value();
    }

    HWAccel::Preference hwPref = HWAccel::parsePreference(hwPrefStr);

    // Prepare result object
    Napi::Object result = Napi::Object::New(env);
    result.Set("supported", Napi::Boolean::New(env, false));
    result.Set("hardwareAccelerated", Napi::Boolean::New(env, false));

    // Try to find an encoder
    HWAccel::EncoderInfo encInfo = HWAccel::selectEncoder(codecName, hwPref, width, height);

    if (!encInfo.codec) {
        result.Set("error", Napi::String::New(env, "No encoder found for codec: " + codecName));
        return result;
    }

    // Try to actually open the codec
    AVCodecContext* ctx = avcodec_alloc_context3(encInfo.codec);
    if (!ctx) {
        result.Set("error", Napi::String::New(env, "Failed to allocate codec context"));
        return result;
    }

    ctx->width = width;
    ctx->height = height;
    ctx->time_base = {1, 1000000};
    ctx->pix_fmt = encInfo.inputFormat;

    // Set a default bitrate
    ctx->bit_rate = 2000000;

    // GOP size
    ctx->gop_size = 30;
    ctx->framerate = {30, 1};
    ctx->max_b_frames = 0;

    // Setup hardware device if needed
    AVBufferRef* hwDeviceCtx = nullptr;
    if (encInfo.hwType != HWAccel::Type::None) {
        hwDeviceCtx = HWAccel::createHWDeviceContext(encInfo.hwType);
        if (hwDeviceCtx) {
            ctx->hw_device_ctx = av_buffer_ref(hwDeviceCtx);
            result.Set("hardwareAccelerated", Napi::Boolean::New(env, true));
        }
    }

    // Try to open the codec
    int ret = avcodec_open2(ctx, encInfo.codec, nullptr);

    if (ret >= 0) {
        result.Set("supported", Napi::Boolean::New(env, true));
        result.Set("encoderName", Napi::String::New(env, encInfo.codec->name));

        // Report actual capabilities if available
        if (ctx->coded_width > 0 && ctx->coded_height > 0) {
            result.Set("codedWidth", Napi::Number::New(env, ctx->coded_width));
            result.Set("codedHeight", Napi::Number::New(env, ctx->coded_height));
        }
        // avcodec_free_context below handles cleanup
    } else {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        result.Set("error", Napi::String::New(env, errBuf));
    }

    if (hwDeviceCtx) {
        av_buffer_unref(&hwDeviceCtx);
    }
    avcodec_free_context(&ctx);

    return result;
}

Napi::Value CapabilityProbe::ProbeVideoDecoder(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "Config object required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object config = info[0].As<Napi::Object>();

    std::string codecName = config.Get("codec").As<Napi::String>().Utf8Value();

    Napi::Object result = Napi::Object::New(env);
    result.Set("supported", Napi::Boolean::New(env, false));
    result.Set("hardwareAccelerated", Napi::Boolean::New(env, false));

    // Find decoder
    const AVCodec* codec = avcodec_find_decoder_by_name(codecName.c_str());

    // Try common decoder names if not found
    if (!codec) {
        if (codecName == "h264" || codecName == "libx264") {
            codec = avcodec_find_decoder(AV_CODEC_ID_H264);
        } else if (codecName == "vp8" || codecName == "libvpx") {
            codec = avcodec_find_decoder(AV_CODEC_ID_VP8);
        } else if (codecName == "vp9" || codecName == "libvpx-vp9") {
            codec = avcodec_find_decoder(AV_CODEC_ID_VP9);
        } else if (codecName == "hevc" || codecName == "libx265") {
            codec = avcodec_find_decoder(AV_CODEC_ID_HEVC);
        } else if (codecName == "av1" || codecName == "libaom-av1" || codecName == "libdav1d") {
            codec = avcodec_find_decoder(AV_CODEC_ID_AV1);
        }
    }

    if (!codec) {
        result.Set("error", Napi::String::New(env, "No decoder found for codec: " + codecName));
        return result;
    }

    // Try to open the codec
    AVCodecContext* ctx = avcodec_alloc_context3(codec);
    if (!ctx) {
        result.Set("error", Napi::String::New(env, "Failed to allocate codec context"));
        return result;
    }

    // Set dimensions if provided
    if (config.Has("width") && config.Get("width").IsNumber()) {
        ctx->width = config.Get("width").As<Napi::Number>().Int32Value();
    }
    if (config.Has("height") && config.Get("height").IsNumber()) {
        ctx->height = config.Get("height").As<Napi::Number>().Int32Value();
    }

    int ret = avcodec_open2(ctx, codec, nullptr);

    if (ret >= 0) {
        result.Set("supported", Napi::Boolean::New(env, true));
        result.Set("decoderName", Napi::String::New(env, codec->name));
        // avcodec_free_context below handles cleanup
    } else {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        result.Set("error", Napi::String::New(env, errBuf));
    }

    avcodec_free_context(&ctx);

    return result;
}

Napi::Value CapabilityProbe::ProbeAudioEncoder(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "Config object required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object config = info[0].As<Napi::Object>();

    std::string codecName = config.Get("codec").As<Napi::String>().Utf8Value();

    Napi::Object result = Napi::Object::New(env);
    result.Set("supported", Napi::Boolean::New(env, false));

    // Find encoder
    const AVCodec* codec = avcodec_find_encoder_by_name(codecName.c_str());

    if (!codec) {
        result.Set("error", Napi::String::New(env, "No encoder found for codec: " + codecName));
        return result;
    }

    // Try to open
    AVCodecContext* ctx = avcodec_alloc_context3(codec);
    if (!ctx) {
        result.Set("error", Napi::String::New(env, "Failed to allocate codec context"));
        return result;
    }

    // Set required audio parameters
    if (config.Has("sampleRate") && config.Get("sampleRate").IsNumber()) {
        ctx->sample_rate = config.Get("sampleRate").As<Napi::Number>().Int32Value();
    } else {
        ctx->sample_rate = 48000;
    }

    if (config.Has("numberOfChannels") && config.Get("numberOfChannels").IsNumber()) {
        int channels = config.Get("numberOfChannels").As<Napi::Number>().Int32Value();
        av_channel_layout_default(&ctx->ch_layout, channels);
    } else {
        av_channel_layout_default(&ctx->ch_layout, 2);
    }

    // Set sample format - prefer float planar
    ctx->sample_fmt = AV_SAMPLE_FMT_FLTP;

    ctx->bit_rate = 128000;

    int ret = avcodec_open2(ctx, codec, nullptr);

    if (ret >= 0) {
        result.Set("supported", Napi::Boolean::New(env, true));
        result.Set("encoderName", Napi::String::New(env, codec->name));
        // avcodec_free_context below handles cleanup
    } else {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        result.Set("error", Napi::String::New(env, errBuf));
    }

    avcodec_free_context(&ctx);

    return result;
}

Napi::Value CapabilityProbe::ProbeAudioDecoder(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "Config object required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object config = info[0].As<Napi::Object>();

    std::string codecName = config.Get("codec").As<Napi::String>().Utf8Value();

    Napi::Object result = Napi::Object::New(env);
    result.Set("supported", Napi::Boolean::New(env, false));

    // Find decoder
    const AVCodec* codec = avcodec_find_decoder_by_name(codecName.c_str());

    if (!codec) {
        result.Set("error", Napi::String::New(env, "No decoder found for codec: " + codecName));
        return result;
    }

    // Try to open
    AVCodecContext* ctx = avcodec_alloc_context3(codec);
    if (!ctx) {
        result.Set("error", Napi::String::New(env, "Failed to allocate codec context"));
        return result;
    }

    int ret = avcodec_open2(ctx, codec, nullptr);

    if (ret >= 0) {
        result.Set("supported", Napi::Boolean::New(env, true));
        result.Set("decoderName", Napi::String::New(env, codec->name));
        // avcodec_free_context below handles cleanup
    } else {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        result.Set("error", Napi::String::New(env, errBuf));
    }

    avcodec_free_context(&ctx);

    return result;
}
