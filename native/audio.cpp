#include "audio.h"
#include <cstring>
#include <vector>

// ==================== AudioDataNative ====================

Napi::FunctionReference AudioDataNative::constructor;

Napi::Object AudioDataNative::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "AudioDataNative", {
        InstanceMethod("allocationSize", &AudioDataNative::AllocationSize),
        InstanceMethod("copyTo", &AudioDataNative::CopyTo),
        InstanceMethod("close", &AudioDataNative::Close),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("AudioDataNative", func);
    return exports;
}

AudioDataNative::AudioDataNative(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<AudioDataNative>(info)
    , frame_(nullptr)
    , closed_(false)
    , sampleRate_(0)
    , numberOfFrames_(0)
    , numberOfChannels_(0) {

    Napi::Env env = info.Env();

    if (info.Length() < 6) {
        Napi::TypeError::New(env, "Expected 6 arguments").ThrowAsJavaScriptException();
        return;
    }

    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    format_ = info[1].As<Napi::String>().Utf8Value();
    sampleRate_ = info[2].As<Napi::Number>().Int32Value();
    numberOfFrames_ = info[3].As<Napi::Number>().Int32Value();
    numberOfChannels_ = info[4].As<Napi::Number>().Int32Value();
    int64_t timestamp = info[5].As<Napi::Number>().Int64Value();

    frame_ = av_frame_alloc();
    if (!frame_) {
        Napi::Error::New(env, "Failed to allocate audio frame").ThrowAsJavaScriptException();
        return;
    }

    // Determine sample format
    AVSampleFormat sampleFormat;
    if (format_ == "f32" || format_ == "f32-planar") {
        sampleFormat = format_ == "f32" ? AV_SAMPLE_FMT_FLT : AV_SAMPLE_FMT_FLTP;
    } else if (format_ == "s16" || format_ == "s16-planar") {
        sampleFormat = format_ == "s16" ? AV_SAMPLE_FMT_S16 : AV_SAMPLE_FMT_S16P;
    } else if (format_ == "s32" || format_ == "s32-planar") {
        sampleFormat = format_ == "s32" ? AV_SAMPLE_FMT_S32 : AV_SAMPLE_FMT_S32P;
    } else if (format_ == "u8" || format_ == "u8-planar") {
        sampleFormat = format_ == "u8" ? AV_SAMPLE_FMT_U8 : AV_SAMPLE_FMT_U8P;
    } else {
        sampleFormat = AV_SAMPLE_FMT_FLTP;  // Default
    }

    frame_->format = sampleFormat;
    frame_->sample_rate = sampleRate_;
    frame_->nb_samples = numberOfFrames_;

    // Set channel layout
    AVChannelLayout layout;
    av_channel_layout_default(&layout, numberOfChannels_);
    av_channel_layout_copy(&frame_->ch_layout, &layout);
    av_channel_layout_uninit(&layout);

    frame_->pts = timestamp;

    int ret = av_frame_get_buffer(frame_, 0);
    if (ret < 0) {
        av_frame_free(&frame_);
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        Napi::Error::New(env, std::string("Failed to allocate audio buffer: ") + errBuf).ThrowAsJavaScriptException();
        return;
    }

    // Copy data
    size_t dataSize = buffer.Length();
    if (av_sample_fmt_is_planar(sampleFormat)) {
        // Planar format
        size_t planeSize = numberOfFrames_ * av_get_bytes_per_sample(sampleFormat);
        for (int ch = 0; ch < numberOfChannels_ && (size_t)(ch * planeSize) < dataSize; ch++) {
            memcpy(frame_->data[ch], buffer.Data() + ch * planeSize,
                   std::min(planeSize, dataSize - ch * planeSize));
        }
    } else {
        // Interleaved format
        memcpy(frame_->data[0], buffer.Data(), std::min(dataSize, (size_t)frame_->linesize[0]));
    }
}

AudioDataNative::~AudioDataNative() {
    if (frame_ && !closed_) {
        av_frame_free(&frame_);
    }
}

Napi::Value AudioDataNative::AllocationSize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (closed_ || !frame_) {
        Napi::Error::New(env, "AudioData is closed").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object options = info[0].As<Napi::Object>();
    int planeIndex = options.Get("planeIndex").As<Napi::Number>().Int32Value();

    int bytesPerSample = av_get_bytes_per_sample((AVSampleFormat)frame_->format);

    if (av_sample_fmt_is_planar((AVSampleFormat)frame_->format)) {
        return Napi::Number::New(env, frame_->nb_samples * bytesPerSample);
    } else {
        return Napi::Number::New(env, frame_->nb_samples * frame_->ch_layout.nb_channels * bytesPerSample);
    }
}

void AudioDataNative::CopyTo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (closed_ || !frame_) {
        Napi::Error::New(env, "AudioData is closed").ThrowAsJavaScriptException();
        return;
    }

    Napi::Buffer<uint8_t> dest = info[0].As<Napi::Buffer<uint8_t>>();
    Napi::Object options = info[1].As<Napi::Object>();
    int planeIndex = options.Get("planeIndex").As<Napi::Number>().Int32Value();

    int bytesPerSample = av_get_bytes_per_sample((AVSampleFormat)frame_->format);

    if (av_sample_fmt_is_planar((AVSampleFormat)frame_->format)) {
        if (planeIndex >= frame_->ch_layout.nb_channels) {
            Napi::RangeError::New(env, "planeIndex out of range").ThrowAsJavaScriptException();
            return;
        }
        size_t planeSize = frame_->nb_samples * bytesPerSample;
        memcpy(dest.Data(), frame_->data[planeIndex], std::min((size_t)dest.Length(), planeSize));
    } else {
        size_t dataSize = frame_->nb_samples * frame_->ch_layout.nb_channels * bytesPerSample;
        memcpy(dest.Data(), frame_->data[0], std::min((size_t)dest.Length(), dataSize));
    }
}

void AudioDataNative::Close(const Napi::CallbackInfo& info) {
    if (!closed_ && frame_) {
        av_frame_free(&frame_);
        frame_ = nullptr;
        closed_ = true;
    }
}

Napi::Value CreateAudioData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 6) {
        Napi::TypeError::New(env, "Expected 6 arguments").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return AudioDataNative::constructor.New({
        info[0],  // buffer
        info[1],  // format
        info[2],  // sampleRate
        info[3],  // numberOfFrames
        info[4],  // numberOfChannels
        info[5],  // timestamp
    });
}

// ==================== AudioDecoderNative ====================

Napi::FunctionReference AudioDecoderNative::constructor;

Napi::Object AudioDecoderNative::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "AudioDecoderNative", {
        InstanceMethod("configure", &AudioDecoderNative::Configure),
        InstanceMethod("decode", &AudioDecoderNative::Decode),
        InstanceMethod("flush", &AudioDecoderNative::Flush),
        InstanceMethod("reset", &AudioDecoderNative::Reset),
        InstanceMethod("close", &AudioDecoderNative::Close),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("AudioDecoderNative", func);
    return exports;
}

AudioDecoderNative::AudioDecoderNative(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<AudioDecoderNative>(info)
    , codecCtx_(nullptr)
    , codec_(nullptr)
    , swrCtx_(nullptr)
    , configured_(false)
    , sampleRate_(0)
    , channels_(0) {

    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 callbacks").ThrowAsJavaScriptException();
        return;
    }

    // Store callbacks directly for synchronous operations
    outputCallback_ = Napi::Persistent(info[0].As<Napi::Function>());
    errorCallback_ = Napi::Persistent(info[1].As<Napi::Function>());
}

AudioDecoderNative::~AudioDecoderNative() {
    if (swrCtx_) {
        swr_free(&swrCtx_);
    }
    if (codecCtx_) {
        avcodec_free_context(&codecCtx_);
    }
}

void AudioDecoderNative::Configure(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "Config must be an object").ThrowAsJavaScriptException();
        return;
    }

    Napi::Object config = info[0].As<Napi::Object>();
    std::string codecName = config.Get("codec").As<Napi::String>().Utf8Value();
    sampleRate_ = config.Get("sampleRate").As<Napi::Number>().Int32Value();
    channels_ = config.Get("channels").As<Napi::Number>().Int32Value();

    codec_ = avcodec_find_decoder_by_name(codecName.c_str());
    if (!codec_) {
        // Try common aliases
        if (codecName == "aac") {
            codec_ = avcodec_find_decoder(AV_CODEC_ID_AAC);
        } else if (codecName == "opus" || codecName == "libopus") {
            codec_ = avcodec_find_decoder(AV_CODEC_ID_OPUS);
        } else if (codecName == "mp3" || codecName == "libmp3lame") {
            codec_ = avcodec_find_decoder(AV_CODEC_ID_MP3);
        } else if (codecName == "flac") {
            codec_ = avcodec_find_decoder(AV_CODEC_ID_FLAC);
        }
    }

    if (!codec_) {
        Napi::Error::New(env, "Codec not found: " + codecName).ThrowAsJavaScriptException();
        return;
    }

    codecCtx_ = avcodec_alloc_context3(codec_);
    if (!codecCtx_) {
        Napi::Error::New(env, "Failed to allocate codec context").ThrowAsJavaScriptException();
        return;
    }

    codecCtx_->sample_rate = sampleRate_;

    AVChannelLayout layout;
    av_channel_layout_default(&layout, channels_);
    av_channel_layout_copy(&codecCtx_->ch_layout, &layout);
    av_channel_layout_uninit(&layout);

    // Set extradata if provided
    if (config.Has("extradata")) {
        Napi::Buffer<uint8_t> extradata = config.Get("extradata").As<Napi::Buffer<uint8_t>>();
        codecCtx_->extradata_size = extradata.Length();
        codecCtx_->extradata = (uint8_t*)av_malloc(extradata.Length() + AV_INPUT_BUFFER_PADDING_SIZE);
        memcpy(codecCtx_->extradata, extradata.Data(), extradata.Length());
        memset(codecCtx_->extradata + extradata.Length(), 0, AV_INPUT_BUFFER_PADDING_SIZE);
    }

    int ret = avcodec_open2(codecCtx_, codec_, nullptr);
    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        avcodec_free_context(&codecCtx_);
        Napi::Error::New(env, std::string("Failed to open codec: ") + errBuf).ThrowAsJavaScriptException();
        return;
    }

    configured_ = true;
}

void AudioDecoderNative::Decode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!configured_) {
        Napi::Error::New(env, "Decoder not configured").ThrowAsJavaScriptException();
        return;
    }

    Napi::Buffer<uint8_t> data = info[0].As<Napi::Buffer<uint8_t>>();
    bool isKeyframe = info[1].As<Napi::Boolean>().Value();
    int64_t timestamp = info[2].As<Napi::Number>().Int64Value();
    int64_t duration = info[3].As<Napi::Number>().Int64Value();

    // Create packet
    AVPacket* packet = av_packet_alloc();
    packet->data = data.Data();
    packet->size = data.Length();
    packet->pts = timestamp;
    packet->dts = timestamp;
    packet->duration = duration;

    int ret = avcodec_send_packet(codecCtx_, packet);
    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        EmitError(env, std::string("Decode error: ") + errBuf);
        av_packet_free(&packet);
        return;
    }

    AVFrame* frame = av_frame_alloc();
    while (ret >= 0) {
        ret = avcodec_receive_frame(codecCtx_, frame);
        if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
            break;
        } else if (ret < 0) {
            char errBuf[256];
            av_strerror(ret, errBuf, sizeof(errBuf));
            EmitError(env, std::string("Decode error: ") + errBuf);
            break;
        }

        EmitData(env, frame, timestamp);
        av_frame_unref(frame);
    }

    av_frame_free(&frame);
    av_packet_free(&packet);
}

void AudioDecoderNative::EmitData(Napi::Env env, AVFrame* frame, int64_t timestamp) {
    // Convert to float32 interleaved
    int numChannels = frame->ch_layout.nb_channels;
    int numSamples = frame->nb_samples;

    std::vector<float> outputData(numSamples * numChannels);

    // Resample if needed
    if (!swrCtx_) {
        AVChannelLayout outLayout;
        av_channel_layout_copy(&outLayout, &frame->ch_layout);

        swr_alloc_set_opts2(&swrCtx_,
            &outLayout, AV_SAMPLE_FMT_FLT, frame->sample_rate,
            &frame->ch_layout, (AVSampleFormat)frame->format, frame->sample_rate,
            0, nullptr);

        av_channel_layout_uninit(&outLayout);

        if (swr_init(swrCtx_) < 0) {
            EmitError(env, "Failed to initialize resampler");
            return;
        }
    }

    uint8_t* outPtr = (uint8_t*)outputData.data();
    int outSamples = swr_convert(swrCtx_,
        &outPtr, numSamples,
        (const uint8_t**)frame->data, numSamples);

    if (outSamples < 0) {
        EmitError(env, "Resampling failed");
        return;
    }

    Napi::Float32Array buffer = Napi::Float32Array::New(env, outputData.size());
    memcpy(buffer.Data(), outputData.data(), outputData.size() * sizeof(float));

    outputCallback_.Value().Call({
        buffer,
        Napi::String::New(env, "f32"),
        Napi::Number::New(env, frame->sample_rate),
        Napi::Number::New(env, numSamples),
        Napi::Number::New(env, numChannels),
        Napi::Number::New(env, timestamp)
    });
}

void AudioDecoderNative::EmitError(Napi::Env env, const std::string& message) {
    errorCallback_.Value().Call({ Napi::String::New(env, message) });
}

Napi::Value AudioDecoderNative::Flush(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (configured_ && codecCtx_) {
        avcodec_send_packet(codecCtx_, nullptr);

        AVFrame* frame = av_frame_alloc();
        int ret;
        while ((ret = avcodec_receive_frame(codecCtx_, frame)) >= 0) {
            EmitData(env, frame, frame->pts);
            av_frame_unref(frame);
        }
        av_frame_free(&frame);
    }

    Napi::Function callback = info[0].As<Napi::Function>();
    callback.Call({ env.Null() });

    return env.Undefined();
}

void AudioDecoderNative::Reset(const Napi::CallbackInfo& info) {
    if (codecCtx_) {
        avcodec_flush_buffers(codecCtx_);
    }
}

void AudioDecoderNative::Close(const Napi::CallbackInfo& info) {
    if (swrCtx_) {
        swr_free(&swrCtx_);
        swrCtx_ = nullptr;
    }

    if (codecCtx_) {
        avcodec_free_context(&codecCtx_);
        codecCtx_ = nullptr;
    }

    configured_ = false;
}

// ==================== AudioEncoderNative ====================

Napi::FunctionReference AudioEncoderNative::constructor;

Napi::Object AudioEncoderNative::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "AudioEncoderNative", {
        InstanceMethod("configure", &AudioEncoderNative::Configure),
        InstanceMethod("encode", &AudioEncoderNative::Encode),
        InstanceMethod("flush", &AudioEncoderNative::Flush),
        InstanceMethod("reset", &AudioEncoderNative::Reset),
        InstanceMethod("close", &AudioEncoderNative::Close),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("AudioEncoderNative", func);
    return exports;
}

AudioEncoderNative::AudioEncoderNative(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<AudioEncoderNative>(info)
    , codecCtx_(nullptr)
    , codec_(nullptr)
    , swrCtx_(nullptr)
    , configured_(false)
    , sampleRate_(0)
    , channels_(0)
    , frameSize_(1024) {

    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 callbacks").ThrowAsJavaScriptException();
        return;
    }

    // Store callbacks directly for synchronous operations
    outputCallback_ = Napi::Persistent(info[0].As<Napi::Function>());
    errorCallback_ = Napi::Persistent(info[1].As<Napi::Function>());
}

AudioEncoderNative::~AudioEncoderNative() {
    if (swrCtx_) {
        swr_free(&swrCtx_);
    }
    if (codecCtx_) {
        avcodec_free_context(&codecCtx_);
    }
}

void AudioEncoderNative::Configure(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!info[0].IsObject()) {
        Napi::TypeError::New(env, "Config must be an object").ThrowAsJavaScriptException();
        return;
    }

    Napi::Object config = info[0].As<Napi::Object>();
    std::string codecName = config.Get("codec").As<Napi::String>().Utf8Value();
    sampleRate_ = config.Get("sampleRate").As<Napi::Number>().Int32Value();
    channels_ = config.Get("channels").As<Napi::Number>().Int32Value();

    codec_ = avcodec_find_encoder_by_name(codecName.c_str());
    if (!codec_) {
        Napi::Error::New(env, "Codec not found: " + codecName).ThrowAsJavaScriptException();
        return;
    }

    codecCtx_ = avcodec_alloc_context3(codec_);
    if (!codecCtx_) {
        Napi::Error::New(env, "Failed to allocate codec context").ThrowAsJavaScriptException();
        return;
    }

    codecCtx_->sample_rate = sampleRate_;
    // WebCodecs timestamps are in microseconds, so use microsecond time_base
    codecCtx_->time_base = { 1, 1000000 };

    // Select appropriate sample format for codec
    // Each codec has different requirements
    if (codecName == "libopus") {
        codecCtx_->sample_fmt = AV_SAMPLE_FMT_FLT;  // Opus uses float non-planar
    } else if (codecName == "flac") {
        codecCtx_->sample_fmt = AV_SAMPLE_FMT_S16;  // FLAC uses s16
    } else if (codecName == "libmp3lame") {
        codecCtx_->sample_fmt = AV_SAMPLE_FMT_FLTP; // MP3 uses float planar
        // MP3 only supports mono or stereo - limit channels if needed
        if (channels_ > 2) {
            channels_ = 2;  // Downmix to stereo
        }
    } else if (codecName == "libvorbis") {
        codecCtx_->sample_fmt = AV_SAMPLE_FMT_FLTP; // Vorbis uses float planar
    } else {
        // AAC and most others use float planar
        codecCtx_->sample_fmt = AV_SAMPLE_FMT_FLTP;
    }

    AVChannelLayout layout;
    av_channel_layout_default(&layout, channels_);
    av_channel_layout_copy(&codecCtx_->ch_layout, &layout);
    av_channel_layout_uninit(&layout);

    if (config.Has("bitrate")) {
        codecCtx_->bit_rate = config.Get("bitrate").As<Napi::Number>().Int64Value();
    } else {
        codecCtx_->bit_rate = 128000;  // 128 kbps default
    }

    int ret = avcodec_open2(codecCtx_, codec_, nullptr);
    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        std::string errMsg = std::string("Failed to open codec: ") + errBuf +
            " (codec=" + codecName + ", sampleRate=" + std::to_string(sampleRate_) +
            ", channels=" + std::to_string(channels_) + ", bitrate=" + std::to_string(codecCtx_->bit_rate) + ")";
        avcodec_free_context(&codecCtx_);
        Napi::Error::New(env, errMsg).ThrowAsJavaScriptException();
        return;
    }

    frameSize_ = codecCtx_->frame_size > 0 ? codecCtx_->frame_size : 1024;
    configured_ = true;
}

void AudioEncoderNative::Encode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!configured_) {
        Napi::Error::New(env, "Encoder not configured").ThrowAsJavaScriptException();
        return;
    }

    Napi::Float32Array data = info[0].As<Napi::Float32Array>();
    std::string format = info[1].As<Napi::String>().Utf8Value();
    int sampleRate = info[2].As<Napi::Number>().Int32Value();
    int numberOfFrames = info[3].As<Napi::Number>().Int32Value();
    int numberOfChannels = info[4].As<Napi::Number>().Int32Value();
    int64_t timestamp = info[5].As<Napi::Number>().Int64Value();

    // Setup frame
    AVFrame* frame = av_frame_alloc();
    frame->format = codecCtx_->sample_fmt;
    frame->sample_rate = codecCtx_->sample_rate;
    av_channel_layout_copy(&frame->ch_layout, &codecCtx_->ch_layout);
    frame->nb_samples = std::min(numberOfFrames, frameSize_);
    frame->pts = timestamp;

    int ret = av_frame_get_buffer(frame, 0);
    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        av_frame_free(&frame);
        EmitError(env, std::string("Failed to allocate frame: ") + errBuf);
        return;
    }

    // Convert input to encoder format
    if (!swrCtx_) {
        AVChannelLayout inLayout, outLayout;
        av_channel_layout_default(&inLayout, numberOfChannels);
        av_channel_layout_copy(&outLayout, &codecCtx_->ch_layout);

        int swrRet = swr_alloc_set_opts2(&swrCtx_,
            &outLayout, codecCtx_->sample_fmt, codecCtx_->sample_rate,
            &inLayout, AV_SAMPLE_FMT_FLT, sampleRate,
            0, nullptr);

        av_channel_layout_uninit(&inLayout);
        av_channel_layout_uninit(&outLayout);

        if (swrRet < 0 || swr_init(swrCtx_) < 0) {
            av_frame_free(&frame);
            EmitError(env, "Failed to initialize resampler");
            return;
        }
    }

    const uint8_t* inPtr = (const uint8_t*)data.Data();
    int outSamples = swr_convert(swrCtx_,
        frame->data, frame->nb_samples,
        &inPtr, numberOfFrames);

    if (outSamples < 0) {
        av_frame_free(&frame);
        EmitError(env, "Resampling failed");
        return;
    }

    frame->nb_samples = outSamples;

    ret = avcodec_send_frame(codecCtx_, frame);
    av_frame_free(&frame);

    if (ret < 0) {
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        EmitError(env, std::string("Encode error: ") + errBuf);
        return;
    }

    AVPacket* packet = av_packet_alloc();
    while (ret >= 0) {
        ret = avcodec_receive_packet(codecCtx_, packet);
        if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
            break;
        } else if (ret < 0) {
            char errBuf[256];
            av_strerror(ret, errBuf, sizeof(errBuf));
            EmitError(env, std::string("Encode error: ") + errBuf);
            break;
        }

        EmitChunk(env, packet);
        av_packet_unref(packet);
    }
    av_packet_free(&packet);
}

void AudioEncoderNative::EmitChunk(Napi::Env env, AVPacket* packet) {
    Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(env, packet->data, packet->size);

    Napi::Value extradataValue = env.Undefined();
    if (codecCtx_->extradata && codecCtx_->extradata_size > 0) {
        // For FLAC, we need to wrap the STREAMINFO with "fLaC" header
        // FLAC stream format: "fLaC" + metadata block header + STREAMINFO
        if (codec_->id == AV_CODEC_ID_FLAC) {
            // Build proper FLAC header: "fLaC" (4) + block header (4) + STREAMINFO (34)
            size_t fullSize = 4 + 4 + codecCtx_->extradata_size;
            std::vector<uint8_t> flacHeader(fullSize);

            // "fLaC" stream marker
            flacHeader[0] = 'f';
            flacHeader[1] = 'L';
            flacHeader[2] = 'a';
            flacHeader[3] = 'C';

            // Metadata block header: last-flag (1 bit) + type (7 bits) + size (24 bits)
            // 0x80 = last block flag, 0x00 = STREAMINFO type
            // Combined: 0x80 for "last STREAMINFO block"
            flacHeader[4] = 0x80;  // Last block flag + STREAMINFO type (0)
            // Size in big-endian (3 bytes): typically 34 for STREAMINFO
            flacHeader[5] = (codecCtx_->extradata_size >> 16) & 0xFF;
            flacHeader[6] = (codecCtx_->extradata_size >> 8) & 0xFF;
            flacHeader[7] = codecCtx_->extradata_size & 0xFF;

            // Copy STREAMINFO data
            memcpy(flacHeader.data() + 8, codecCtx_->extradata, codecCtx_->extradata_size);

            extradataValue = Napi::Buffer<uint8_t>::Copy(env, flacHeader.data(), fullSize);
        } else {
            extradataValue = Napi::Buffer<uint8_t>::Copy(env, codecCtx_->extradata, codecCtx_->extradata_size);
        }
    }

    // WebCodecs spec: output timestamps should match input timestamps (in microseconds).
    // time_base is now {1, 1000000} so packet->pts is already in microseconds.
    // FFmpeg adjusts timestamps by subtracting initial_padding (encoder priming delay).
    // We need to add back the delay converted to microseconds.
    int64_t timestampUs = packet->pts;
    if (codecCtx_->initial_padding > 0) {
        // Convert initial_padding from samples to microseconds
        int64_t paddingUs = (int64_t)codecCtx_->initial_padding * 1000000 / codecCtx_->sample_rate;
        timestampUs += paddingUs;
    }
    // Ensure timestamps are never negative (can happen with some codecs)
    if (timestampUs < 0) {
        timestampUs = 0;
    }

    outputCallback_.Value().Call({
        buffer,
        Napi::Number::New(env, timestampUs),
        Napi::Number::New(env, packet->duration),
        extradataValue
    });
}

void AudioEncoderNative::EmitError(Napi::Env env, const std::string& message) {
    errorCallback_.Value().Call({ Napi::String::New(env, message) });
}

Napi::Value AudioEncoderNative::Flush(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (configured_ && codecCtx_) {
        avcodec_send_frame(codecCtx_, nullptr);

        AVPacket* packet = av_packet_alloc();
        int ret;
        while ((ret = avcodec_receive_packet(codecCtx_, packet)) >= 0) {
            EmitChunk(env, packet);
            av_packet_unref(packet);
        }
        av_packet_free(&packet);
    }

    Napi::Function callback = info[0].As<Napi::Function>();
    callback.Call({ env.Null() });

    return env.Undefined();
}

void AudioEncoderNative::Reset(const Napi::CallbackInfo& info) {
    if (codecCtx_) {
        avcodec_flush_buffers(codecCtx_);
    }
}

void AudioEncoderNative::Close(const Napi::CallbackInfo& info) {
    if (swrCtx_) {
        swr_free(&swrCtx_);
        swrCtx_ = nullptr;
    }

    if (codecCtx_) {
        avcodec_free_context(&codecCtx_);
        codecCtx_ = nullptr;
    }

    configured_ = false;
}
