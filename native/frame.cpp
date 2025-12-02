#include "frame.h"
#include <cstring>

Napi::FunctionReference VideoFrameNative::constructor;

Napi::Object VideoFrameNative::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "VideoFrameNative", {
        InstanceMethod("allocationSize", &VideoFrameNative::AllocationSize),
        InstanceMethod("copyTo", &VideoFrameNative::CopyTo),
        InstanceMethod("clone", &VideoFrameNative::Clone),
        InstanceMethod("close", &VideoFrameNative::Close),
        InstanceAccessor("width", &VideoFrameNative::GetWidth, nullptr),
        InstanceAccessor("height", &VideoFrameNative::GetHeight, nullptr),
        InstanceAccessor("format", &VideoFrameNative::GetFormat, nullptr),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("VideoFrameNative", func);
    return exports;
}

VideoFrameNative::VideoFrameNative(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<VideoFrameNative>(info), frame_(nullptr), closed_(false), ownsFrame_(true) {

    Napi::Env env = info.Env();

    // Constructor can be called:
    // 1. With no args (for NewInstance with external frame)
    // 2. With buffer, format, width, height
    if (info.Length() == 0) {
        // Will be set via SetFrame
        return;
    }

    if (info.Length() < 4) {
        Napi::TypeError::New(env, "Expected 4 arguments: buffer, format, width, height").ThrowAsJavaScriptException();
        return;
    }

    // Get buffer data
    if (!info[0].IsBuffer()) {
        Napi::TypeError::New(env, "First argument must be a Buffer").ThrowAsJavaScriptException();
        return;
    }

    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    std::string format = info[1].As<Napi::String>().Utf8Value();
    int width = info[2].As<Napi::Number>().Int32Value();
    int height = info[3].As<Napi::Number>().Int32Value();

    AVPixelFormat pixFmt = StringToPixelFormat(format);
    if (pixFmt == AV_PIX_FMT_NONE) {
        Napi::TypeError::New(env, "Unsupported pixel format: " + format).ThrowAsJavaScriptException();
        return;
    }

    frame_ = av_frame_alloc();
    if (!frame_) {
        Napi::Error::New(env, "Failed to allocate frame").ThrowAsJavaScriptException();
        return;
    }

    frame_->format = pixFmt;
    frame_->width = width;
    frame_->height = height;

    int ret = av_frame_get_buffer(frame_, 0);
    if (ret < 0) {
        av_frame_free(&frame_);
        char errBuf[256];
        av_strerror(ret, errBuf, sizeof(errBuf));
        Napi::Error::New(env, std::string("Failed to allocate frame buffer: ") + errBuf).ThrowAsJavaScriptException();
        return;
    }

    // Copy data into frame based on pixel format
    const uint8_t* src = buffer.Data();
    size_t srcLen = buffer.Length();

    if (pixFmt == AV_PIX_FMT_RGBA || pixFmt == AV_PIX_FMT_BGRA ||
        pixFmt == AV_PIX_FMT_RGB0 || pixFmt == AV_PIX_FMT_BGR0) {
        // Packed RGBA/BGRA format - single plane
        size_t lineSize = width * 4;
        for (int y = 0; y < height && (size_t)(y * lineSize) < srcLen; y++) {
            memcpy(frame_->data[0] + y * frame_->linesize[0],
                   src + y * lineSize,
                   std::min(lineSize, (size_t)frame_->linesize[0]));
        }
    } else if (pixFmt == AV_PIX_FMT_YUV420P) {
        // I420 - Y, U, V planes
        size_t ySize = width * height;
        size_t uvWidth = (width + 1) / 2;
        size_t uvHeight = (height + 1) / 2;
        size_t uvSize = uvWidth * uvHeight;

        // Copy Y plane
        for (int y = 0; y < height; y++) {
            memcpy(frame_->data[0] + y * frame_->linesize[0],
                   src + y * width,
                   width);
        }

        // Copy U plane
        if (srcLen > ySize) {
            for (size_t y = 0; y < uvHeight; y++) {
                memcpy(frame_->data[1] + y * frame_->linesize[1],
                       src + ySize + y * uvWidth,
                       uvWidth);
            }
        }

        // Copy V plane
        if (srcLen > ySize + uvSize) {
            for (size_t y = 0; y < uvHeight; y++) {
                memcpy(frame_->data[2] + y * frame_->linesize[2],
                       src + ySize + uvSize + y * uvWidth,
                       uvWidth);
            }
        }
    } else if (pixFmt == AV_PIX_FMT_NV12) {
        // NV12 - Y plane, interleaved UV plane
        size_t ySize = width * height;
        size_t uvHeight = (height + 1) / 2;

        // Copy Y plane
        for (int y = 0; y < height; y++) {
            memcpy(frame_->data[0] + y * frame_->linesize[0],
                   src + y * width,
                   width);
        }

        // Copy UV plane (interleaved)
        if (srcLen > ySize) {
            for (size_t y = 0; y < uvHeight; y++) {
                memcpy(frame_->data[1] + y * frame_->linesize[1],
                       src + ySize + y * width,
                       width);
            }
        }
    } else if (pixFmt == AV_PIX_FMT_YUV422P) {
        // I422 - Y, U, V planes (4:2:2)
        size_t ySize = width * height;
        size_t uvWidth = (width + 1) / 2;
        size_t uvSize = uvWidth * height;

        // Copy Y plane
        for (int y = 0; y < height; y++) {
            memcpy(frame_->data[0] + y * frame_->linesize[0],
                   src + y * width,
                   width);
        }

        // Copy U plane
        if (srcLen > ySize) {
            for (int y = 0; y < height; y++) {
                memcpy(frame_->data[1] + y * frame_->linesize[1],
                       src + ySize + y * uvWidth,
                       uvWidth);
            }
        }

        // Copy V plane
        if (srcLen > ySize + uvSize) {
            for (int y = 0; y < height; y++) {
                memcpy(frame_->data[2] + y * frame_->linesize[2],
                       src + ySize + uvSize + y * uvWidth,
                       uvWidth);
            }
        }
    } else if (pixFmt == AV_PIX_FMT_YUV444P) {
        // I444 - Y, U, V planes (4:4:4)
        size_t planeSize = width * height;

        // Copy Y plane
        for (int y = 0; y < height; y++) {
            memcpy(frame_->data[0] + y * frame_->linesize[0],
                   src + y * width,
                   width);
        }

        // Copy U plane
        if (srcLen > planeSize) {
            for (int y = 0; y < height; y++) {
                memcpy(frame_->data[1] + y * frame_->linesize[1],
                       src + planeSize + y * width,
                       width);
            }
        }

        // Copy V plane
        if (srcLen > planeSize * 2) {
            for (int y = 0; y < height; y++) {
                memcpy(frame_->data[2] + y * frame_->linesize[2],
                       src + planeSize * 2 + y * width,
                       width);
            }
        }
    }
}

VideoFrameNative::~VideoFrameNative() {
    if (frame_ && !closed_ && ownsFrame_) {
        av_frame_free(&frame_);
    }
}

Napi::Value VideoFrameNative::AllocationSize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (closed_ || !frame_) {
        Napi::Error::New(env, "Frame is closed").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    int size = av_image_get_buffer_size(
        (AVPixelFormat)frame_->format,
        frame_->width,
        frame_->height,
        1
    );

    if (size < 0) {
        Napi::Error::New(env, "Failed to calculate allocation size").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return Napi::Number::New(env, size);
}

Napi::Value VideoFrameNative::CopyTo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (closed_ || !frame_) {
        Napi::Error::New(env, "Frame is closed").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (!info[0].IsBuffer()) {
        Napi::TypeError::New(env, "First argument must be a Buffer").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Buffer<uint8_t> dest = info[0].As<Napi::Buffer<uint8_t>>();

    // Parse options for format conversion and rect cropping
    AVPixelFormat targetFormat = static_cast<AVPixelFormat>(frame_->format);
    int rectX = 0, rectY = 0;
    int rectW = frame_->width, rectH = frame_->height;

    if (info.Length() > 1 && info[1].IsObject()) {
        Napi::Object options = info[1].As<Napi::Object>();

        // Format conversion
        if (options.Has("format") && options.Get("format").IsString()) {
            std::string fmt = options.Get("format").As<Napi::String>().Utf8Value();
            AVPixelFormat newFmt = StringToPixelFormat(fmt);
            if (newFmt != AV_PIX_FMT_NONE) {
                targetFormat = newFmt;
            }
        }

        // Rect cropping
        if (options.Has("rect") && options.Get("rect").IsObject()) {
            Napi::Object rect = options.Get("rect").As<Napi::Object>();
            if (rect.Has("x")) rectX = rect.Get("x").As<Napi::Number>().Int32Value();
            if (rect.Has("y")) rectY = rect.Get("y").As<Napi::Number>().Int32Value();
            if (rect.Has("width")) rectW = rect.Get("width").As<Napi::Number>().Int32Value();
            if (rect.Has("height")) rectH = rect.Get("height").As<Napi::Number>().Int32Value();

            // Clamp rect to frame bounds
            if (rectX < 0) rectX = 0;
            if (rectY < 0) rectY = 0;
            if (rectX + rectW > frame_->width) rectW = frame_->width - rectX;
            if (rectY + rectH > frame_->height) rectH = frame_->height - rectY;
        }
    }

    // Check if we need conversion/cropping
    bool needsConversion = (targetFormat != frame_->format) ||
                          (rectX != 0 || rectY != 0 ||
                           rectW != frame_->width || rectH != frame_->height);

    if (needsConversion) {
        // Use swscale for format conversion and/or cropping
        SwsContext* swsCtx = sws_getContext(
            rectW, rectH, static_cast<AVPixelFormat>(frame_->format),
            rectW, rectH, targetFormat,
            SWS_BILINEAR, nullptr, nullptr, nullptr
        );

        if (!swsCtx) {
            Napi::Error::New(env, "Failed to create conversion context").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Create output frame
        AVFrame* outFrame = av_frame_alloc();
        if (!outFrame) {
            sws_freeContext(swsCtx);
            Napi::Error::New(env, "Failed to allocate output frame").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        outFrame->format = targetFormat;
        outFrame->width = rectW;
        outFrame->height = rectH;

        int ret = av_frame_get_buffer(outFrame, 0);
        if (ret < 0) {
            av_frame_free(&outFrame);
            sws_freeContext(swsCtx);
            char errBuf[256];
            av_strerror(ret, errBuf, sizeof(errBuf));
            Napi::Error::New(env, std::string("Failed to allocate output buffer: ") + errBuf).ThrowAsJavaScriptException();
            return env.Undefined();
        }

        // Adjust source pointers for rect offset
        uint8_t* srcSlice[4] = {nullptr, nullptr, nullptr, nullptr};
        int srcStride[4] = {0, 0, 0, 0};

        AVPixelFormat srcFmt = static_cast<AVPixelFormat>(frame_->format);

        // Calculate byte offset for the crop region
        if (srcFmt == AV_PIX_FMT_YUV420P || srcFmt == AV_PIX_FMT_YUVA420P) {
            // YUV420P: Y is full res, U/V are half res
            srcSlice[0] = frame_->data[0] + rectY * frame_->linesize[0] + rectX;
            srcSlice[1] = frame_->data[1] + (rectY / 2) * frame_->linesize[1] + (rectX / 2);
            srcSlice[2] = frame_->data[2] + (rectY / 2) * frame_->linesize[2] + (rectX / 2);
            if (srcFmt == AV_PIX_FMT_YUVA420P && frame_->data[3]) {
                srcSlice[3] = frame_->data[3] + rectY * frame_->linesize[3] + rectX;
            }
            srcStride[0] = frame_->linesize[0];
            srcStride[1] = frame_->linesize[1];
            srcStride[2] = frame_->linesize[2];
            srcStride[3] = frame_->linesize[3];
        } else if (srcFmt == AV_PIX_FMT_YUV422P) {
            // YUV422P: Y is full res, U/V are half width, full height
            srcSlice[0] = frame_->data[0] + rectY * frame_->linesize[0] + rectX;
            srcSlice[1] = frame_->data[1] + rectY * frame_->linesize[1] + (rectX / 2);
            srcSlice[2] = frame_->data[2] + rectY * frame_->linesize[2] + (rectX / 2);
            srcStride[0] = frame_->linesize[0];
            srcStride[1] = frame_->linesize[1];
            srcStride[2] = frame_->linesize[2];
        } else if (srcFmt == AV_PIX_FMT_YUV444P) {
            // YUV444P: all planes are full res
            srcSlice[0] = frame_->data[0] + rectY * frame_->linesize[0] + rectX;
            srcSlice[1] = frame_->data[1] + rectY * frame_->linesize[1] + rectX;
            srcSlice[2] = frame_->data[2] + rectY * frame_->linesize[2] + rectX;
            srcStride[0] = frame_->linesize[0];
            srcStride[1] = frame_->linesize[1];
            srcStride[2] = frame_->linesize[2];
        } else if (srcFmt == AV_PIX_FMT_NV12) {
            // NV12: Y plane, interleaved UV plane (half res)
            srcSlice[0] = frame_->data[0] + rectY * frame_->linesize[0] + rectX;
            srcSlice[1] = frame_->data[1] + (rectY / 2) * frame_->linesize[1] + (rectX & ~1);
            srcStride[0] = frame_->linesize[0];
            srcStride[1] = frame_->linesize[1];
        } else {
            // Packed formats (RGBA, BGRA, etc.) - 4 bytes per pixel
            int bytesPerPixel = 4;
            srcSlice[0] = frame_->data[0] + rectY * frame_->linesize[0] + rectX * bytesPerPixel;
            srcStride[0] = frame_->linesize[0];
        }

        // Perform the conversion
        sws_scale(swsCtx, srcSlice, srcStride, 0, rectH,
                  outFrame->data, outFrame->linesize);

        // Copy converted frame to destination buffer
        int size = av_image_copy_to_buffer(
            dest.Data(),
            dest.Length(),
            outFrame->data,
            outFrame->linesize,
            targetFormat,
            rectW,
            rectH,
            1
        );

        av_frame_free(&outFrame);
        sws_freeContext(swsCtx);

        if (size < 0) {
            char errBuf[256];
            av_strerror(size, errBuf, sizeof(errBuf));
            Napi::Error::New(env, std::string("Failed to copy converted frame: ") + errBuf).ThrowAsJavaScriptException();
            return env.Undefined();
        }
    } else {
        // Direct copy - no conversion needed
        int size = av_image_copy_to_buffer(
            dest.Data(),
            dest.Length(),
            frame_->data,
            frame_->linesize,
            (AVPixelFormat)frame_->format,
            frame_->width,
            frame_->height,
            1
        );

        if (size < 0) {
            char errBuf[256];
            av_strerror(size, errBuf, sizeof(errBuf));
            Napi::Error::New(env, std::string("Failed to copy frame data: ") + errBuf).ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    return env.Undefined();
}

Napi::Value VideoFrameNative::Clone(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (closed_ || !frame_) {
        Napi::Error::New(env, "Frame is closed").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    AVFrame* cloned = av_frame_clone(frame_);
    if (!cloned) {
        Napi::Error::New(env, "Failed to clone frame").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return NewInstance(env, cloned);
}

void VideoFrameNative::Close(const Napi::CallbackInfo& info) {
    if (!closed_ && frame_ && ownsFrame_) {
        av_frame_free(&frame_);
        frame_ = nullptr;
        closed_ = true;
    }
}

Napi::Value VideoFrameNative::GetWidth(const Napi::CallbackInfo& info) {
    if (closed_ || !frame_) {
        return info.Env().Undefined();
    }
    return Napi::Number::New(info.Env(), frame_->width);
}

Napi::Value VideoFrameNative::GetHeight(const Napi::CallbackInfo& info) {
    if (closed_ || !frame_) {
        return info.Env().Undefined();
    }
    return Napi::Number::New(info.Env(), frame_->height);
}

Napi::Value VideoFrameNative::GetFormat(const Napi::CallbackInfo& info) {
    if (closed_ || !frame_) {
        return info.Env().Undefined();
    }
    return Napi::String::New(info.Env(), PixelFormatToString((AVPixelFormat)frame_->format));
}

Napi::Object VideoFrameNative::NewInstance(Napi::Env env, AVFrame* frame) {
    Napi::Object obj = constructor.New({});
    VideoFrameNative* instance = Napi::ObjectWrap<VideoFrameNative>::Unwrap(obj);
    instance->frame_ = frame;
    instance->ownsFrame_ = true;
    return obj;
}

AVPixelFormat StringToPixelFormat(const std::string& format) {
    if (format == "I420") return AV_PIX_FMT_YUV420P;
    if (format == "I420A") return AV_PIX_FMT_YUVA420P;
    if (format == "I422") return AV_PIX_FMT_YUV422P;
    if (format == "I444") return AV_PIX_FMT_YUV444P;
    if (format == "NV12") return AV_PIX_FMT_NV12;
    if (format == "RGBA") return AV_PIX_FMT_RGBA;
    if (format == "RGBX") return AV_PIX_FMT_RGB0;
    if (format == "BGRA") return AV_PIX_FMT_BGRA;
    if (format == "BGRX") return AV_PIX_FMT_BGR0;
    return AV_PIX_FMT_NONE;
}

std::string PixelFormatToString(AVPixelFormat format) {
    switch (format) {
        case AV_PIX_FMT_YUV420P: return "I420";
        case AV_PIX_FMT_YUVA420P: return "I420A";
        case AV_PIX_FMT_YUV422P: return "I422";
        case AV_PIX_FMT_YUV444P: return "I444";
        case AV_PIX_FMT_NV12: return "NV12";
        case AV_PIX_FMT_RGBA: return "RGBA";
        case AV_PIX_FMT_RGB0: return "RGBX";
        case AV_PIX_FMT_BGRA: return "BGRA";
        case AV_PIX_FMT_BGR0: return "BGRX";
        default: return "";
    }
}

Napi::Value CreateVideoFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4) {
        Napi::TypeError::New(env, "Expected 4 arguments: buffer, format, width, height").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Create new VideoFrameNative instance
    return VideoFrameNative::constructor.New({
        info[0],  // buffer
        info[1],  // format
        info[2],  // width
        info[3],  // height
    });
}
