#include "color.h"
#include <map>

namespace ColorSpace {

AVColorPrimaries parsePrimaries(const std::string& primaries) {
    static const std::map<std::string, AVColorPrimaries> mapping = {
        {"bt709", AVCOL_PRI_BT709},
        {"bt470bg", AVCOL_PRI_BT470BG},
        {"smpte170m", AVCOL_PRI_SMPTE170M},
        {"bt2020", AVCOL_PRI_BT2020},
        {"smpte432", AVCOL_PRI_SMPTE432},  // Display P3
        {"smpte-rp-431", AVCOL_PRI_SMPTE431},  // DCI P3
    };
    auto it = mapping.find(primaries);
    return it != mapping.end() ? it->second : AVCOL_PRI_UNSPECIFIED;
}

AVColorTransferCharacteristic parseTransfer(const std::string& transfer) {
    static const std::map<std::string, AVColorTransferCharacteristic> mapping = {
        {"bt709", AVCOL_TRC_BT709},
        {"smpte170m", AVCOL_TRC_SMPTE170M},
        {"iec61966-2-1", AVCOL_TRC_IEC61966_2_1},  // sRGB
        {"linear", AVCOL_TRC_LINEAR},
        {"pq", AVCOL_TRC_SMPTE2084},      // HDR PQ (BT.2100)
        {"hlg", AVCOL_TRC_ARIB_STD_B67},  // HDR HLG (BT.2100)
        {"smpte2084", AVCOL_TRC_SMPTE2084},  // Alternative name for PQ
        {"arib-std-b67", AVCOL_TRC_ARIB_STD_B67},  // Alternative name for HLG
        {"gamma22", AVCOL_TRC_GAMMA22},
        {"gamma28", AVCOL_TRC_GAMMA28},
    };
    auto it = mapping.find(transfer);
    return it != mapping.end() ? it->second : AVCOL_TRC_UNSPECIFIED;
}

AVColorSpace parseMatrix(const std::string& matrix) {
    static const std::map<std::string, AVColorSpace> mapping = {
        {"rgb", AVCOL_SPC_RGB},
        {"bt709", AVCOL_SPC_BT709},
        {"bt470bg", AVCOL_SPC_BT470BG},
        {"smpte170m", AVCOL_SPC_SMPTE170M},
        {"bt2020-ncl", AVCOL_SPC_BT2020_NCL},
        {"bt2020-cl", AVCOL_SPC_BT2020_CL},
        {"smpte240m", AVCOL_SPC_SMPTE240M},
        {"ycgco", AVCOL_SPC_YCGCO},
    };
    auto it = mapping.find(matrix);
    return it != mapping.end() ? it->second : AVCOL_SPC_UNSPECIFIED;
}

std::string primariesToString(AVColorPrimaries primaries) {
    switch (primaries) {
        case AVCOL_PRI_BT709: return "bt709";
        case AVCOL_PRI_BT470BG: return "bt470bg";
        case AVCOL_PRI_SMPTE170M: return "smpte170m";
        case AVCOL_PRI_BT2020: return "bt2020";
        case AVCOL_PRI_SMPTE432: return "smpte432";
        case AVCOL_PRI_SMPTE431: return "smpte-rp-431";
        default: return "";
    }
}

std::string transferToString(AVColorTransferCharacteristic transfer) {
    switch (transfer) {
        case AVCOL_TRC_BT709: return "bt709";
        case AVCOL_TRC_SMPTE170M: return "smpte170m";
        case AVCOL_TRC_IEC61966_2_1: return "iec61966-2-1";
        case AVCOL_TRC_LINEAR: return "linear";
        case AVCOL_TRC_SMPTE2084: return "pq";
        case AVCOL_TRC_ARIB_STD_B67: return "hlg";
        case AVCOL_TRC_GAMMA22: return "gamma22";
        case AVCOL_TRC_GAMMA28: return "gamma28";
        default: return "";
    }
}

std::string matrixToString(AVColorSpace matrix) {
    switch (matrix) {
        case AVCOL_SPC_RGB: return "rgb";
        case AVCOL_SPC_BT709: return "bt709";
        case AVCOL_SPC_BT470BG: return "bt470bg";
        case AVCOL_SPC_SMPTE170M: return "smpte170m";
        case AVCOL_SPC_BT2020_NCL: return "bt2020-ncl";
        case AVCOL_SPC_BT2020_CL: return "bt2020-cl";
        case AVCOL_SPC_SMPTE240M: return "smpte240m";
        case AVCOL_SPC_YCGCO: return "ycgco";
        default: return "";
    }
}

} // namespace ColorSpace
