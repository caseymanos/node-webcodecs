/**
 * Centralized native binary loader for node-webcodecs
 *
 * Resolution order:
 *   1. dynamic prebuild / local build (node-gyp-build: links system FFmpeg)
 *   2. static prebuild (@node-webcodecs/static-<platform>-<arch>: bundled FFmpeg)
 *   3. nothing — install script falls back to a source build, which then
 *      resolves via node-gyp-build (build/Release)
 *
 * NODE_WEBCODECS_FORCE=dynamic|static|source overrides the order.
 */

import path from 'path';

// node-gyp-build handles:
// - Finding prebuilds in prebuilds/ directory
// - NAPI version compatibility
// - Platform/arch detection (darwin-arm64, linux-x64, etc.)
// - libc variant detection (glibc vs musl)
// - Fallback to build/Release for local development
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeGypBuild = require('node-gyp-build');

export type NativeVariant = 'dynamic' | 'static' | 'source';

const packageRoot = path.join(__dirname, '..');
const staticPackage = `@node-webcodecs/static-${process.platform}-${process.arch}`;

let loadedVariant: NativeVariant | undefined;

function loadNodeGypBuild(requireSource: boolean): any {
  const resolved = nodeGypBuild.path(packageRoot);
  const isPrebuild = resolved.includes(`${path.sep}prebuilds${path.sep}`);
  if (requireSource && isPrebuild) {
    throw new Error('no local build found — run: npx cmake-js compile');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const binding = require(resolved);
  loadedVariant = isPrebuild ? 'dynamic' : 'source';
  return binding;
}

function loadStatic(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const binding = require(staticPackage);
  loadedVariant = 'static';
  return binding;
}

function load(): any {
  const force = process.env.NODE_WEBCODECS_FORCE;
  const attempts: Array<[string, () => any]> =
    force === 'static' ? [['static', loadStatic]]
    : force === 'dynamic' ? [['dynamic', () => loadNodeGypBuild(false)]]
    : force === 'source' ? [['source', () => loadNodeGypBuild(true)]]
    : [
        ['dynamic', () => loadNodeGypBuild(false)],
        ['static', loadStatic],
      ];

  const errors: string[] = [];
  for (const [name, attempt] of attempts) {
    try {
      return attempt();
    } catch (error) {
      errors.push(`  ${name}: ${(error as Error).message}`);
    }
  }
  throw new Error(
    `node-webcodecs: failed to load native binding for ${process.platform}-${process.arch}\n` +
    `${errors.join('\n')}\n` +
    'Install FFmpeg dev libraries and run: npx cmake-js compile'
  );
}

let native: any;
try {
  native = load();
} catch (error) {
  // Store error to throw when native is actually accessed
  // This allows the module to load even if native isn't available
  native = new Proxy({}, {
    get() {
      throw error;
    }
  });
}

/** Which binding variant is serving this process (undefined if load failed). */
export function getNativeVariant(): NativeVariant | undefined {
  return loadedVariant;
}

export { native };
