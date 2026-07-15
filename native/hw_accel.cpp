#include "hw_accel.h"
#include <map>
#include <algorithm>

extern "C" {
#include <libavutil/opt.h>
}

namespace HWAccel {

// Encoder priority per platform (first = highest priority)
struct EncoderMapping {
    const char* hwEncoder;
    Type type;
    AVPixelFormat preferredFormat;
};

// H.264 encoders by priority
static const std::vector<EncoderMapping> h264Encoders = {
#ifdef __APPLE__
    {"h264_videotoolbox", Type::VideoToolbox, AV_PIX_FMT_NV12},
#endif
#ifdef _WIN32
    {"h264_mf", Type::MediaFoundation, AV_PIX_FMT_NV12},
    {"h264_amf", Type::AMF, AV_PIX_FMT_NV12},
    {"h264_nvenc", Type::NVENC, AV_PIX_FMT_NV12},
    {"h264_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
#ifdef __linux__
    {"h264_nvenc", Type::NVENC, AV_PIX_FMT_NV12},
    {"h264_vaapi", Type::VAAPI, AV_PIX_FMT_VAAPI},
    {"h264_qsv", Type::QSV, AV_PIX_FMT_NV12},
    {"h264_v4l2m2m", Type::V4L2M2M, AV_PIX_FMT_YUV420P},
#endif
    {"libx264", Type::None, AV_PIX_FMT_YUV420P},  // Software fallback
    {"libopenh264", Type::None, AV_PIX_FMT_YUV420P},  // LGPL static builds (no x264)
};

// HEVC encoders by priority
static const std::vector<EncoderMapping> hevcEncoders = {
#ifdef __APPLE__
    {"hevc_videotoolbox", Type::VideoToolbox, AV_PIX_FMT_NV12},
#endif
#ifdef _WIN32
    {"hevc_mf", Type::MediaFoundation, AV_PIX_FMT_NV12},
    {"hevc_amf", Type::AMF, AV_PIX_FMT_NV12},
    {"hevc_nvenc", Type::NVENC, AV_PIX_FMT_NV12},
    {"hevc_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
#ifdef __linux__
    {"hevc_nvenc", Type::NVENC, AV_PIX_FMT_NV12},
    {"hevc_vaapi", Type::VAAPI, AV_PIX_FMT_VAAPI},
    {"hevc_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
    {"libx265", Type::None, AV_PIX_FMT_YUV420P},
};

// VP8 encoders
static const std::vector<EncoderMapping> vp8Encoders = {
    {"libvpx", Type::None, AV_PIX_FMT_YUV420P},
};

// VP9 encoders
static const std::vector<EncoderMapping> vp9Encoders = {
#ifdef __linux__
    {"vp9_vaapi", Type::VAAPI, AV_PIX_FMT_VAAPI},
    {"vp9_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
    {"libvpx-vp9", Type::None, AV_PIX_FMT_YUV420P},
};

// AV1 encoders
static const std::vector<EncoderMapping> av1Encoders = {
#ifdef _WIN32
    {"av1_nvenc", Type::NVENC, AV_PIX_FMT_NV12},
    {"av1_amf", Type::AMF, AV_PIX_FMT_NV12},
    {"av1_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
#ifdef __linux__
    {"av1_nvenc", Type::NVENC, AV_PIX_FMT_NV12},
    {"av1_vaapi", Type::VAAPI, AV_PIX_FMT_VAAPI},
    {"av1_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
    {"libsvtav1", Type::None, AV_PIX_FMT_YUV420P},
    {"libaom-av1", Type::None, AV_PIX_FMT_YUV420P},
};

// H.264 decoders by priority
static const std::vector<EncoderMapping> h264Decoders = {
#ifdef __APPLE__
    {"h264_videotoolbox", Type::VideoToolbox, AV_PIX_FMT_NV12},
#endif
#ifdef _WIN32
    {"h264_cuvid", Type::CUVID, AV_PIX_FMT_NV12},
    {"h264_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
#ifdef __linux__
    {"h264_cuvid", Type::CUVID, AV_PIX_FMT_NV12},
    {"h264_vaapi", Type::VAAPI, AV_PIX_FMT_VAAPI},
    {"h264_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
    {"h264", Type::None, AV_PIX_FMT_YUV420P},
};

// HEVC decoders
static const std::vector<EncoderMapping> hevcDecoders = {
#ifdef __APPLE__
    {"hevc_videotoolbox", Type::VideoToolbox, AV_PIX_FMT_NV12},
#endif
#ifdef _WIN32
    {"hevc_cuvid", Type::CUVID, AV_PIX_FMT_NV12},
    {"hevc_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
#ifdef __linux__
    {"hevc_cuvid", Type::CUVID, AV_PIX_FMT_NV12},
    {"hevc_vaapi", Type::VAAPI, AV_PIX_FMT_VAAPI},
    {"hevc_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
    {"hevc", Type::None, AV_PIX_FMT_YUV420P},
};

// VP9 decoders
static const std::vector<EncoderMapping> vp9Decoders = {
#ifdef __linux__
    {"vp9_cuvid", Type::CUVID, AV_PIX_FMT_NV12},
    {"vp9_vaapi", Type::VAAPI, AV_PIX_FMT_VAAPI},
    {"vp9_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
    {"vp9", Type::None, AV_PIX_FMT_YUV420P},
};

// AV1 decoders
static const std::vector<EncoderMapping> av1Decoders = {
#ifdef _WIN32
    {"av1_cuvid", Type::CUVID, AV_PIX_FMT_NV12},
    {"av1_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
#ifdef __linux__
    {"av1_cuvid", Type::CUVID, AV_PIX_FMT_NV12},
    {"av1_vaapi", Type::VAAPI, AV_PIX_FMT_VAAPI},
    {"av1_qsv", Type::QSV, AV_PIX_FMT_NV12},
#endif
    {"libdav1d", Type::None, AV_PIX_FMT_YUV420P},
    {"libaom-av1", Type::None, AV_PIX_FMT_YUV420P},
};

// Get codec type from WebCodecs string or FFmpeg name
static std::string getCodecType(const std::string& codecString) {
    // WebCodecs format
    if (codecString.find("avc1") == 0 || codecString.find("avc3") == 0) {
        return "h264";
    } else if (codecString.find("hvc1") == 0 || codecString.find("hev1") == 0) {
        return "hevc";
    } else if (codecString == "vp8") {
        return "vp8";
    } else if (codecString.find("vp09") == 0 || codecString == "vp9") {
        return "vp9";
    } else if (codecString.find("av01") == 0) {
        return "av1";
    }

    // FFmpeg encoder names
    if (codecString == "libx264" || codecString == "libopenh264" ||
        codecString == "h264" || codecString.find("h264_") == 0) {
        return "h264";
    } else if (codecString == "libx265" || codecString == "hevc" ||
               codecString.find("hevc_") == 0) {
        return "hevc";
    } else if (codecString == "libvpx" || codecString.find("vp8") != std::string::npos) {
        return "vp8";
    } else if (codecString == "libvpx-vp9" || codecString.find("vp9") != std::string::npos) {
        return "vp9";
    } else if (codecString == "libaom-av1" || codecString == "libsvtav1" ||
               codecString.find("av1") != std::string::npos) {
        return "av1";
    }

    return codecString;
}

// Get encoder list for a codec type
static const std::vector<EncoderMapping>& getEncoderList(const std::string& codecType) {
    static const std::vector<EncoderMapping> empty;

    if (codecType == "h264") return h264Encoders;
    if (codecType == "hevc") return hevcEncoders;
    if (codecType == "vp8") return vp8Encoders;
    if (codecType == "vp9") return vp9Encoders;
    if (codecType == "av1") return av1Encoders;

    return empty;
}

// Get decoder list for a codec type
static const std::vector<EncoderMapping>& getDecoderList(const std::string& codecType) {
    static const std::vector<EncoderMapping> empty;

    if (codecType == "h264") return h264Decoders;
    if (codecType == "hevc") return hevcDecoders;
    if (codecType == "vp9") return vp9Decoders;
    if (codecType == "av1") return av1Decoders;

    return empty;
}

bool isEncoderAvailable(const std::string& encoderName) {
    // Just check if the encoder exists in FFmpeg's registry
    // Don't try to open it here as that can cause crashes with some HW encoders
    const AVCodec* codec = avcodec_find_encoder_by_name(encoderName.c_str());
    return codec != nullptr;
}

bool isDecoderAvailable(const std::string& decoderName) {
    const AVCodec* codec = avcodec_find_decoder_by_name(decoderName.c_str());
    return codec != nullptr;
}

std::vector<std::string> getAvailableEncoders(const std::string& codecType) {
    std::vector<std::string> available;
    const auto& encoders = getEncoderList(codecType);

    for (const auto& enc : encoders) {
        if (isEncoderAvailable(enc.hwEncoder)) {
            available.push_back(enc.hwEncoder);
        }
    }

    return available;
}

std::vector<std::string> getAvailableDecoders(const std::string& codecType) {
    std::vector<std::string> available;
    const auto& decoders = getDecoderList(codecType);

    for (const auto& dec : decoders) {
        if (isDecoderAvailable(dec.hwEncoder)) {
            available.push_back(dec.hwEncoder);
        }
    }

    return available;
}

EncoderInfo selectEncoder(
    const std::string& codecString,
    Preference preference,
    int width,
    int height
) {
    EncoderInfo info = {};
    info.codec = nullptr;
    info.hwType = Type::None;
    info.inputFormat = AV_PIX_FMT_YUV420P;
    info.swFormat = AV_PIX_FMT_YUV420P;
    info.requiresHWFrames = false;

    std::string codecType = getCodecType(codecString);
    const auto& encoders = getEncoderList(codecType);

    if (encoders.empty()) {
        return info;  // Unknown codec
    }

    // If prefer software, start from the end (software encoders)
    if (preference == Preference::PreferSoftware) {
        for (auto it = encoders.rbegin(); it != encoders.rend(); ++it) {
            if (it->type == Type::None && isEncoderAvailable(it->hwEncoder)) {
                info.codec = avcodec_find_encoder_by_name(it->hwEncoder);
                info.hwType = Type::None;
                info.inputFormat = it->preferredFormat;
                info.name = it->hwEncoder;
                return info;
            }
        }
    }

    // Try encoders in priority order
    for (const auto& enc : encoders) {
        // Skip HW encoders if we want software only
        if (preference == Preference::PreferSoftware && enc.type != Type::None) {
            continue;
        }

        if (isEncoderAvailable(enc.hwEncoder)) {
            info.codec = avcodec_find_encoder_by_name(enc.hwEncoder);
            info.hwType = enc.type;
            info.inputFormat = enc.preferredFormat;
            info.requiresHWFrames = (enc.type == Type::VAAPI);
            info.name = enc.hwEncoder;

            // Check resolution limits for some encoders
            // (most HW encoders support up to 4K or 8K)

            return info;
        }
    }

    return info;  // Nothing found
}

DecoderInfo selectDecoder(
    const std::string& codecString,
    Preference preference,
    int width,
    int height
) {
    DecoderInfo info = {};
    info.codec = nullptr;
    info.hwType = Type::None;
    info.outputFormat = AV_PIX_FMT_YUV420P;
    info.usesHWFrames = false;

    std::string codecType = getCodecType(codecString);
    const auto& decoders = getDecoderList(codecType);

    if (decoders.empty()) {
        // Fall back to generic decoder
        info.codec = avcodec_find_decoder_by_name(codecString.c_str());
        if (info.codec) {
            info.name = codecString;
        }
        return info;
    }

    // If prefer software, start from the end
    if (preference == Preference::PreferSoftware) {
        for (auto it = decoders.rbegin(); it != decoders.rend(); ++it) {
            if (it->type == Type::None && isDecoderAvailable(it->hwEncoder)) {
                info.codec = avcodec_find_decoder_by_name(it->hwEncoder);
                info.hwType = Type::None;
                info.outputFormat = it->preferredFormat;
                info.name = it->hwEncoder;
                return info;
            }
        }
    }

    // Try decoders in priority order
    for (const auto& dec : decoders) {
        if (preference == Preference::PreferSoftware && dec.type != Type::None) {
            continue;
        }

        if (isDecoderAvailable(dec.hwEncoder)) {
            info.codec = avcodec_find_decoder_by_name(dec.hwEncoder);
            info.hwType = dec.type;
            info.outputFormat = dec.preferredFormat;
            info.usesHWFrames = (dec.type != Type::None);
            info.name = dec.hwEncoder;
            return info;
        }
    }

    return info;
}

AVHWDeviceType getHWDeviceType(Type type) {
    switch (type) {
        case Type::VideoToolbox: return AV_HWDEVICE_TYPE_VIDEOTOOLBOX;
        case Type::NVENC:
        case Type::CUVID:        return AV_HWDEVICE_TYPE_CUDA;
        case Type::QSV:          return AV_HWDEVICE_TYPE_QSV;
        case Type::VAAPI:        return AV_HWDEVICE_TYPE_VAAPI;
#ifdef _WIN32
        case Type::AMF:          return AV_HWDEVICE_TYPE_D3D11VA;
#endif
        default:                 return AV_HWDEVICE_TYPE_NONE;
    }
}

AVBufferRef* createHWDeviceContext(Type type) {
    AVHWDeviceType deviceType = getHWDeviceType(type);
    if (deviceType == AV_HWDEVICE_TYPE_NONE) {
        return nullptr;
    }

    AVBufferRef* hwDeviceCtx = nullptr;
    int ret = av_hwdevice_ctx_create(&hwDeviceCtx, deviceType, nullptr, nullptr, 0);

    if (ret < 0) {
        return nullptr;
    }

    return hwDeviceCtx;
}

const char* getTypeName(Type type) {
    switch (type) {
        case Type::VideoToolbox: return "VideoToolbox";
        case Type::NVENC:        return "NVENC";
        case Type::CUVID:        return "CUVID";
        case Type::QSV:          return "QuickSync";
        case Type::VAAPI:        return "VA-API";
        case Type::AMF:          return "AMF";
        case Type::MediaFoundation: return "MediaFoundation";
        case Type::V4L2M2M:      return "V4L2M2M";
        default:                 return "Software";
    }
}

Preference parsePreference(const std::string& pref) {
    if (pref == "prefer-hardware") {
        return Preference::PreferHardware;
    } else if (pref == "prefer-software") {
        return Preference::PreferSoftware;
    }
    return Preference::NoPreference;
}

} // namespace HWAccel
