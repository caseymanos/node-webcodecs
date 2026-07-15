#!/usr/bin/env bash
# Builds a static, LGPL-only FFmpeg (plus BSD codec libs) into a local prefix
# for the @node-webcodecs/static-* prebuilds. No GPL components (no x264/x265):
# H.264 encode comes from openh264 (BSD), AV1 encode from SVT-AV1 (BSD-3),
# AV1 decode from dav1d (BSD-2). The resulting .node is MIT + LGPL notices.
#
# Usage: build.sh [PREFIX]   (default: <repo>/.ffmpeg-static/<platform>-<arch>)
# CI caches the prefix keyed on the hash of this file — bump a version below
# to invalidate.
set -euo pipefail

FFMPEG_VERSION=8.0.3
OPENH264_VERSION=2.6.0
LIBVPX_VERSION=1.16.0
SVTAV1_VERSION=4.2.0
DAV1D_VERSION=1.5.4
OPUS_VERSION=1.6.1
LAME_VERSION=3.100
ZLIB_VERSION=1.3.1
NVCODEC_VERSION=12.2.72.0

FFMPEG_SHA256=6136812ea6d4e68bdba27e33c2a94382711cdf4f8602ffef056ff792bd6f9818
OPENH264_SHA256=558544ad358283a7ab2930d69a9ceddf913f4a51ee9bf1bfb9e377322af81a69
LIBVPX_SHA256=7a479a3c66b9f5d5542a4c6a1b7d3768a983b1e5c14c60a9396edc9b649e015c
SVTAV1_SHA256=c7b13c4a84bd3751aa35fcc72be13e6875467e7c2216879251a486e5b1e4e740
DAV1D_SHA256=686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5
OPUS_SHA256=6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1
LAME_SHA256=ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e
ZLIB_SHA256=9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23
NVCODEC_SHA256=dbeaec433d93b850714760282f1d0992b1254fc3b5a6cb7d76fc1340a1e47563

OS=$(uname -s)
ARCH=$(uname -m)
case "$ARCH" in
  aarch64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
esac
case "$OS" in
  Darwin) PLATFORM=darwin ;;
  Linux) PLATFORM=linux ;;
  *) echo "unsupported OS: $OS" >&2; exit 1 ;;
esac

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PREFIX=${1:-"$REPO_ROOT/.ffmpeg-static/$PLATFORM-$ARCH"}
BUILD_DIR=${FFMPEG_STATIC_BUILD_DIR:-"$REPO_ROOT/.ffmpeg-static/build"}
JOBS=${JOBS:-$(getconf _NPROCESSORS_ONLN)}

mkdir -p "$PREFIX" "$BUILD_DIR"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
if [ "$PLATFORM" = darwin ]; then
  export MACOSX_DEPLOYMENT_TARGET=11.0
fi

fetch() { # fetch <url> <sha256> <strip-dir-name>
  local url=$1 sha=$2 dir=$3
  local tarball="$BUILD_DIR/$(basename "$url")"
  if [ ! -f "$tarball" ]; then
    curl -sfLo "$tarball" "$url"
  fi
  echo "$sha  $tarball" | shasum -a 256 -c - >/dev/null
  rm -rf "$BUILD_DIR/$dir"
  mkdir -p "$BUILD_DIR/$dir"
  tar -xf "$tarball" -C "$BUILD_DIR/$dir" --strip-components=1
  cd "$BUILD_DIR/$dir"
}

echo "== zlib $ZLIB_VERSION"
fetch "https://github.com/madler/zlib/releases/download/v$ZLIB_VERSION/zlib-$ZLIB_VERSION.tar.gz" "$ZLIB_SHA256" zlib
CFLAGS=-fPIC ./configure --prefix="$PREFIX" --static
make -j"$JOBS" install

echo "== openh264 $OPENH264_VERSION"
fetch "https://github.com/cisco/openh264/archive/refs/tags/v$OPENH264_VERSION.tar.gz" "$OPENH264_SHA256" openh264
make -j"$JOBS" PREFIX="$PREFIX" install-static

echo "== libvpx $LIBVPX_VERSION"
fetch "https://github.com/webmproject/libvpx/archive/refs/tags/v$LIBVPX_VERSION.tar.gz" "$LIBVPX_SHA256" libvpx
./configure --prefix="$PREFIX" --disable-shared --enable-static --enable-pic \
  --disable-examples --disable-tools --disable-docs --disable-unit-tests \
  --enable-vp8 --enable-vp9
make -j"$JOBS" install

echo "== SVT-AV1 $SVTAV1_VERSION"
fetch "https://gitlab.com/AOMediaCodec/SVT-AV1/-/archive/v$SVTAV1_VERSION/SVT-AV1-v$SVTAV1_VERSION.tar.gz" "$SVTAV1_SHA256" svt-av1
cmake -B build-static -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_APPS=OFF -DBUILD_TESTING=OFF \
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_INSTALL_LIBDIR=lib
cmake --build build-static -j"$JOBS" --target install

echo "== dav1d $DAV1D_VERSION"
fetch "https://downloads.videolan.org/pub/videolan/dav1d/$DAV1D_VERSION/dav1d-$DAV1D_VERSION.tar.xz" "$DAV1D_SHA256" dav1d
meson setup build-static --default-library=static --buildtype=release \
  --prefix="$PREFIX" --libdir=lib -Denable_tools=false -Denable_tests=false
ninja -C build-static -j"$JOBS" install

echo "== opus $OPUS_VERSION"
fetch "https://downloads.xiph.org/releases/opus/opus-$OPUS_VERSION.tar.gz" "$OPUS_SHA256" opus
./configure --prefix="$PREFIX" --disable-shared --enable-static --with-pic \
  --disable-doc --disable-extra-programs
make -j"$JOBS" install

echo "== lame $LAME_VERSION"
fetch "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz" "$LAME_SHA256" lame
./configure --prefix="$PREFIX" --disable-shared --enable-static --with-pic \
  --disable-frontend --disable-decoder
make -j"$JOBS" install

HW_FLAGS=()
if [ "$PLATFORM" = linux ]; then
  echo "== nv-codec-headers $NVCODEC_VERSION"
  fetch "https://github.com/FFmpeg/nv-codec-headers/archive/refs/tags/n$NVCODEC_VERSION.tar.gz" "$NVCODEC_SHA256" nv-codec-headers
  make PREFIX="$PREFIX" install
  # NVENC/NVDEC dlopen libcuda at runtime — no hard dependency, safe in the
  # static build; encoder open failure falls back to software.
  HW_FLAGS=(
    --enable-ffnvcodec --enable-nvenc --enable-nvdec --enable-cuvid
    --enable-encoder=h264_nvenc,hevc_nvenc,av1_nvenc
    --enable-decoder=h264_cuvid,hevc_cuvid,vp8_cuvid,vp9_cuvid,av1_cuvid
    --enable-hwaccel=h264_nvdec,hevc_nvdec,vp8_nvdec,vp9_nvdec,av1_nvdec
  )
else
  HW_FLAGS=(
    --enable-videotoolbox
    --enable-encoder=h264_videotoolbox,hevc_videotoolbox
    --enable-hwaccel=h264_videotoolbox,hevc_videotoolbox,vp9_videotoolbox,av1_videotoolbox
  )
fi

echo "== FFmpeg $FFMPEG_VERSION"
fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" "$FFMPEG_SHA256" ffmpeg
./configure \
  --prefix="$PREFIX" \
  --pkg-config-flags=--static \
  --extra-cflags="-I$PREFIX/include" \
  --extra-ldflags="-L$PREFIX/lib" \
  --enable-static --disable-shared --enable-pic \
  --disable-programs --disable-doc --disable-debug \
  --disable-avdevice --disable-avformat --disable-avfilter \
  --disable-network --disable-autodetect \
  --disable-everything \
  --enable-zlib \
  --enable-libopenh264 --enable-libvpx --enable-libsvtav1 --enable-libdav1d \
  --enable-libopus --enable-libmp3lame \
  --enable-decoder=h264,hevc,vp8,vp9,libdav1d,aac,mp3,opus,flac,vorbis \
  --enable-decoder=mjpeg,png,webp,gif,bmp,tiff \
  --enable-decoder=pcm_u8,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le \
  --enable-encoder=libopenh264,libvpx_vp8,libvpx_vp9,libsvtav1,aac,libopus,libmp3lame,flac \
  --enable-encoder=pcm_u8,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le \
  "${HW_FLAGS[@]}"
make -j"$JOBS" install

echo "== done: $PREFIX"
ls -la "$PREFIX/lib"
