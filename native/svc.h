#ifndef SVC_H
#define SVC_H

#include <string>

/**
 * Scalability configuration parsed from WebCodecs scalabilityMode strings.
 *
 * Format: [L|S]<spatial>T<temporal>[h][_KEY][_SHIFT]
 * Examples:
 *   L1T2 - 1 spatial layer, 2 temporal layers
 *   L1T3 - 1 spatial layer, 3 temporal layers
 *   L2T1 - 2 spatial layers, 1 temporal layer
 *   L3T3 - 3 spatial layers, 3 temporal layers
 *   S2T1 - Simulcast with 2 streams
 *   L2T1h - 2 spatial layers with 1.5x ratio (instead of 2x)
 */
struct ScalabilityConfig {
    int spatialLayers;      // Number of spatial layers (1-3)
    int temporalLayers;     // Number of temporal layers (1-3)
    bool isSimulcast;       // True if 'S' prefix (simulcast mode)
    float ratioH;           // 1.5 for 'h' suffix, 2.0 otherwise
    bool hasKey;            // True if _KEY suffix
    bool hasShift;          // True if _SHIFT suffix
};

/**
 * Parse a WebCodecs scalabilityMode string into a ScalabilityConfig.
 * Returns default config (1 spatial, 1 temporal) for invalid/empty strings.
 */
ScalabilityConfig parseScalabilityMode(const std::string& mode);

/**
 * Check if a scalability mode is supported.
 * Currently supports L1T1, L1T2, L1T3 for temporal-only SVC.
 */
bool isScalabilityModeSupported(const std::string& mode);

#endif // SVC_H
