#!/bin/sh
set -eu

TOOLCHAIN=${TOOLCHAIN:-/opt/xtensa-lx106}
FRAMEWORK=${FRAMEWORK:-/opt/esp8266}
ELF2BIN=${ELF2BIN:-/usr/local/bin/wanix-elf2bin}
WORKSPACE=${WORKSPACE:-/workspace}
BUILD_ID=${BUILD_ID:-manual}
APP_SOURCE=${APP_SOURCE:-$WORKSPACE/src/main.cpp}
RESULT_DIR="$WORKSPACE/artifacts/$BUILD_ID"

if [ -z "${BUILD_DIR:-}" ]; then
    if [ -r /proc/mounts ]; then
        mkdir -p /tmp
        if ! grep -q '[[:space:]]/tmp[[:space:]]' /proc/mounts; then
            mount -t tmpfs tmpfs /tmp
        fi
        BUILD_DIR="/tmp/wanix-firmware-$BUILD_ID"
    else
        BUILD_DIR="$WORKSPACE/.direct-build"
    fi
fi

mkdir -p "$RESULT_DIR" "$BUILD_DIR"

finished() {
    code=$?
    if [ "$code" -ne 0 ]; then
        printf '{"ok":false,"exitCode":%s}\n' "$code" > "$RESULT_DIR/result.json"
    fi
    rm -rf "$BUILD_DIR"
}
trap finished EXIT

PATH="$TOOLCHAIN/bin:$PATH"
export PATH

build_start=$(date +%s)

printf '[wanix] 1/3 compile personalized main.cpp\n'
xtensa-lx106-elf-g++ -B"$TOOLCHAIN/bin/" -o "$BUILD_DIR/main.cpp.o" -c \
    -fno-rtti -std=c++11 -Os -mlongcalls -mtext-section-literals \
    -falign-functions=4 -U__STRICT_ANSI__ -ffunction-sections \
    -fdata-sections -fno-exceptions -Wall \
    -DPLATFORMIO=60119 -DESP8266 -DARDUINO_ARCH_ESP8266 \
    -DARDUINO_ESP8266_WEMOS_D1MINIPRO -DF_CPU=80000000L -D__ets__ \
    -DICACHE_FLASH -DARDUINO=10805 \
    -DARDUINO_BOARD=\"PLATFORMIO_D1_MINI_PRO\" -DFLASHMODE_DIO \
    -DLWIP_OPEN_SRC -DNONOSDK22x_190703=1 -DTCP_MSS=536 \
    -DLWIP_FEATURES=1 -DLWIP_IPV6=0 -DVTABLES_IN_FLASH \
    -I"$FRAMEWORK/cores/esp8266" -I"$FRAMEWORK/sdk/include" \
    -I"$FRAMEWORK/sdk/libc/xtensa-lx106-elf/include" \
    -I"$FRAMEWORK/sdk/lwip2/include" -I"$FRAMEWORK/variants/d1_mini" \
    "$APP_SOURCE"

printf '[wanix] 2/3 link a complete ESP8266 firmware.elf\n'
xtensa-lx106-elf-g++ -B"$TOOLCHAIN/bin/" -o "$BUILD_DIR/firmware.elf" \
    -T eagle.flash.16m14m.ld -Os -nostdlib -Wl,--no-check-sections \
    -Wl,-static -Wl,--gc-sections -Wl,-wrap,system_restart_local \
    -Wl,-wrap,spi_flash_read -u app_entry -u _printf_float \
    -u _scanf_float -u _DebugExceptionVector -u _DoubleExceptionVector \
    -u _KernelExceptionVector -u _NMIExceptionVector -u _UserExceptionVector \
    "$BUILD_DIR/main.cpp.o" -L"$FRAMEWORK/ld" -L"$FRAMEWORK/lib" \
    -Wl,--start-group "$FRAMEWORK/lib/libFrameworkArduinoVariant.a" \
    "$FRAMEWORK/lib/libFrameworkArduino.a" -lhal -lphy -lpp -lnet80211 \
    -lwpa -lcrypto -lmain -lwps -lbearssl -laxtls -lespnow -lsmartconfig \
    -lairkiss -lwpa2 -lstdc++ -lm -lc -lgcc -llwip2-536-feat \
    -Wl,--end-group

printf '[wanix] 3/3 turn the ELF into flashable firmware.bin\n'
"$ELF2BIN" \
    -eboot "$FRAMEWORK/bootloaders/eboot/eboot.elf" \
    -app "$BUILD_DIR/firmware.elf" \
    -out "$BUILD_DIR/firmware.bin"

cp "$BUILD_DIR/firmware.bin" "$RESULT_DIR/firmware.bin"
build_end=$(date +%s)

firmware_bytes=$(wc -c < "$BUILD_DIR/firmware.bin" | tr -d ' ')
elf_bytes=$(wc -c < "$BUILD_DIR/firmware.elf" | tr -d ' ')
source_bytes=$(wc -c < "$APP_SOURCE" | tr -d ' ')
build_seconds=$((build_end - build_start))
printf '{"ok":true,"buildSeconds":%s,"sourceBytes":%s,"elfBytes":%s,"firmwareBytes":%s}\n' \
    "$build_seconds" "$source_bytes" "$elf_bytes" "$firmware_bytes" \
    > "$RESULT_DIR/result.json"
