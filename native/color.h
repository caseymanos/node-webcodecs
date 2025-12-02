#ifndef COLOR_H
#define COLOR_H

#include <string>

extern "C" {
#include <libavutil/pixfmt.h>
}

namespace ColorSpace {
    // Map WebCodecs primaries to FFmpeg
    AVColorPrimaries parsePrimaries(const std::string& primaries);
    // Map WebCodecs transfer to FFmpeg
    AVColorTransferCharacteristic parseTransfer(const std::string& transfer);
    // Map WebCodecs matrix to FFmpeg
    AVColorSpace parseMatrix(const std::string& matrix);
    // Map FFmpeg to WebCodecs strings (reverse)
    std::string primariesToString(AVColorPrimaries primaries);
    std::string transferToString(AVColorTransferCharacteristic transfer);
    std::string matrixToString(AVColorSpace matrix);
}

#endif
