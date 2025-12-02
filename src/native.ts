/**
 * Centralized native binary loader for node-webcodecs
 * Supports both Node.js and Bun runtimes
 */

import path from 'path';
import fs from 'fs';

function loadNative() {
  const platform = process.platform;
  const arch = process.arch;

  // Get directory of this file
  const currentDir = __dirname;

  // Paths to check in order of preference
  const candidates = [
    // 1. Prebuilds (npm published packages)
    path.join(currentDir, '..', 'prebuilds', `${platform}-${arch}`, 'node-webcodecs.node'),
    // 2. Local development build (cmake-js)
    path.join(currentDir, '..', 'build', 'Release', 'webcodecs_node.node'),
    // 3. Alternative local build path
    path.join(currentDir, '..', 'build', 'Release', 'node-webcodecs.node'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return require(candidate);
      }
    } catch {
      // Continue to next candidate
    }
  }

  throw new Error(
    `node-webcodecs: No native binary found for ${platform}-${arch}.\n` +
    `Searched:\n${candidates.map(c => `  - ${c}`).join('\n')}\n\n` +
    `If you're developing locally, run: npm run build:native\n` +
    `If you installed from npm, please report this issue.`
  );
}

let native: any;
try {
  native = loadNative();
} catch (error) {
  // Store error to throw when native is actually accessed
  native = new Proxy({}, {
    get() {
      throw error;
    }
  });
}

export { native };
