#!/usr/bin/env node
// npm install-time check, mirroring the resolution order in src/native.ts:
// dynamic prebuild -> static package -> source build via cmake-js.
// "Loads" (not just resolves) each candidate so a prebuild whose system
// FFmpeg is missing falls through instead of breaking at first require().
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const force = process.env.NODE_WEBCODECS_FORCE;

function tryDynamic() {
  require(require('node-gyp-build').path(root));
  return true;
}

function tryStatic() {
  require(`@node-webcodecs/static-${process.platform}-${process.arch}`);
  return true;
}

function ok(fn) {
  try { return fn(); } catch { return false; }
}

if (force === 'source') {
  // fall through to compile
} else if (force === 'static') {
  if (ok(tryStatic)) process.exit(0);
  console.error('node-webcodecs: NODE_WEBCODECS_FORCE=static but no static package loadable');
  process.exit(1);
} else if (ok(tryDynamic) || (!force && ok(tryStatic))) {
  process.exit(0);
}

console.log('node-webcodecs: no usable prebuild, compiling from source (requires FFmpeg dev libraries)');
const result = spawnSync('npx', ['--yes', 'cmake-js', 'compile'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
