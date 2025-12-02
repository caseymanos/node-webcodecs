#include "svc.h"
#include <regex>

ScalabilityConfig parseScalabilityMode(const std::string& mode) {
    ScalabilityConfig config = {1, 1, false, 2.0f, false, false};

    if (mode.empty()) {
        return config;
    }

    // Pattern: [L|S]<spatial>T<temporal>[h][_KEY][_SHIFT]
    // Examples: L1T2, L1T3, L2T1, L3T3h, S2T1, L1T2_KEY
    std::regex pattern("([LS])(\\d)T(\\d)(h)?(_KEY)?(_SHIFT)?");
    std::smatch match;

    if (std::regex_match(mode, match, pattern)) {
        config.isSimulcast = (match[1].str() == "S");
        config.spatialLayers = std::stoi(match[2].str());
        config.temporalLayers = std::stoi(match[3].str());
        config.ratioH = match[4].matched ? 1.5f : 2.0f;
        config.hasKey = match[5].matched;
        config.hasShift = match[6].matched;
    }

    return config;
}

bool isScalabilityModeSupported(const std::string& mode) {
    if (mode.empty()) {
        return true;  // No SVC is always supported
    }

    ScalabilityConfig config = parseScalabilityMode(mode);

    // Currently only support temporal-only SVC (L1Tx)
    // Spatial SVC and simulcast require more complex configuration
    if (config.spatialLayers > 1 || config.isSimulcast) {
        return false;
    }

    // Support up to 3 temporal layers
    if (config.temporalLayers < 1 || config.temporalLayers > 3) {
        return false;
    }

    return true;
}
