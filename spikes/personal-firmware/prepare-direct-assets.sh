#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
NATIVE="$ROOT/.native"
STAGE="$NATIVE/direct-overlay"
DOWNLOADS="$NATIVE/downloads"
ASSETS="$ROOT/assets"
VENDOR="$ROOT/vendor"
PIO=${PIO:-pio}
WANIX_DIST=${WANIX_DIST:-"$ROOT/../../dist"}

if [ ! -f "$WANIX_DIST/wanix.min.js" ] || \
   [ ! -f "$WANIX_DIST/wanix.debug.wasm" ]; then
    echo "Wanix browser assets are missing from $WANIX_DIST" >&2
    echo "Run 'make js wasm-go' at the Wanix repository root first." >&2
    exit 1
fi

mkdir -p "$NATIVE" "$DOWNLOADS" "$ASSETS" "$VENDOR"
cp "$WANIX_DIST/wanix.min.js" "$VENDOR/"
cp "$WANIX_DIST/wanix.debug.wasm" "$VENDOR/"

PIO_HOME="$NATIVE/pio-direct"
PLATFORMIO_CORE_DIR="$PIO_HOME" "$PIO" run -d "$ROOT"

framework="$PIO_HOME/packages/framework-arduinoespressif8266"
build_cache="$ROOT/.pio/build/d1_mini_pro"

toolchain_archive="$DOWNLOADS/toolchain-xtensa-linux_i686-2.40802.200502.tar.gz"
if [ ! -f "$toolchain_archive" ]; then
    curl -fL --retry 3 -o "$toolchain_archive" \
        https://dl.registry.platformio.org/download/platformio/tool/toolchain-xtensa/2.40802.200502/toolchain-xtensa-linux_i686-2.40802.200502.tar.gz
fi

linux_toolchain="$NATIVE/linux-i686-toolchain"
if [ ! -x "$linux_toolchain/bin/xtensa-lx106-elf-g++" ]; then
    rm -rf "$linux_toolchain"
    mkdir -p "$linux_toolchain"
    tar -xzf "$toolchain_archive" -C "$linux_toolchain"
fi

gcc_version=4.8.2
toolchain="$STAGE/opt/xtensa-lx106"
esp8266="$STAGE/opt/esp8266"

rm -rf "$STAGE"
mkdir -p \
    "$toolchain/bin" \
    "$toolchain/libexec/gcc/xtensa-lx106-elf/$gcc_version" \
    "$toolchain/lib" \
    "$toolchain/xtensa-lx106-elf" \
    "$esp8266/lib" \
    "$esp8266/ld" \
    "$esp8266/bootloaders" \
    "$STAGE/usr/local/bin"

for binary in gcc "gcc-$gcc_version" g++ as ld; do
    cp "$linux_toolchain/bin/xtensa-lx106-elf-$binary" "$toolchain/bin/"
done
ln -s xtensa-lx106-elf-as "$toolchain/bin/as"
ln -s xtensa-lx106-elf-ld "$toolchain/bin/ld"
cp "$linux_toolchain/libexec/gcc/xtensa-lx106-elf/$gcc_version/cc1plus" \
    "$linux_toolchain/libexec/gcc/xtensa-lx106-elf/$gcc_version/collect2" \
    "$toolchain/libexec/gcc/xtensa-lx106-elf/$gcc_version/"
cp -P "$linux_toolchain/libexec/gcc/xtensa-lx106-elf/$gcc_version"/liblto_plugin.so* \
    "$toolchain/libexec/gcc/xtensa-lx106-elf/$gcc_version/"
cp -R "$linux_toolchain/lib/gcc" "$toolchain/lib/"
cp -R "$linux_toolchain/xtensa-lx106-elf/include" \
    "$toolchain/xtensa-lx106-elf/"

mkdir -p "$esp8266/cores" "$esp8266/variants"
cp -R "$framework/cores/esp8266" "$esp8266/cores/"
cp -R "$framework/variants/d1_mini" "$esp8266/variants/"
cp -R "$framework/variants/generic" "$esp8266/variants/"
cp -R "$framework/variants/nodemcu" "$esp8266/variants/"
mkdir -p "$esp8266/sdk" "$esp8266/sdk/libc" "$esp8266/sdk/lwip2"
cp -R "$framework/tools/sdk/include" "$esp8266/sdk/"
cp -R "$framework/tools/sdk/libc/xtensa-lx106-elf" "$esp8266/sdk/libc/"
cp -R "$framework/tools/sdk/lwip2/include" "$esp8266/sdk/lwip2/"

cp "$build_cache/libFrameworkArduino.a" \
    "$build_cache/libFrameworkArduinoVariant.a" \
    "$esp8266/lib/"

for library in hal axtls bearssl lwip2-536-feat stdc++ gcc; do
    cp "$framework/tools/sdk/lib/lib$library.a" "$esp8266/lib/"
done
for library in c m; do
    cp "$framework/tools/sdk/libc/xtensa-lx106-elf/lib/lib$library.a" \
        "$esp8266/lib/"
done
for library in phy pp net80211 wpa crypto main wps espnow smartconfig airkiss wpa2; do
    cp "$framework/tools/sdk/lib/NONOSDK22x_190703/lib$library.a" \
        "$esp8266/lib/"
done

cp "$framework/tools/sdk/ld/eagle.flash.16m14m.ld" \
    "$framework/tools/sdk/ld/eagle.flash.4m1m.ld" \
    "$framework/tools/sdk/ld/eagle.rom.addr.v6.ld" \
    "$build_cache/ld/local.eagle.app.v6.common.ld" \
    "$esp8266/ld/"
cp -R "$framework/bootloaders/eboot" "$esp8266/bootloaders/"

go build -trimpath -o "$NATIVE/elf2bin-host" "$ROOT/tools/elf2bin"
"$NATIVE/elf2bin-host" \
    -eboot "$framework/bootloaders/eboot/eboot.elf" \
    -app "$build_cache/firmware.elf" \
    -out "$NATIVE/firmware-elf2bin-check.bin"
cmp "$NATIVE/firmware-elf2bin-check.bin" "$build_cache/firmware.bin"

CGO_ENABLED=0 GOOS=linux GOARCH=386 go build -trimpath -ldflags='-s -w' \
    -o "$STAGE/usr/local/bin/wanix-elf2bin" "$ROOT/tools/elf2bin"

download_apk() {
    repo=$1
    package=$2
    apk="$DOWNLOADS/$package"
    if [ ! -f "$apk" ]; then
        curl -fL --retry 3 -o "$apk" \
            "https://dl-cdn.alpinelinux.org/alpine/v3.22/$repo/x86/$package"
    fi
    tar -xzf "$apk" -C "$STAGE"
}

download_apk main gcompat-1.1.0-r4.apk
download_apk main musl-obstack-1.2.3-r2.apk
download_apk main libucontext-1.3.2-r0.apk
download_apk main libgcc-14.2.0-r6.apk
download_apk main libstdc++-14.2.0-r6.apk

tar -C "$STAGE" -czf "$ASSETS/wanix-esp8266-toolchain.tgz" .
du -h "$ASSETS/wanix-esp8266-toolchain.tgz"
