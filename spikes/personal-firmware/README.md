# Wanix Flash Lab

Wanix Flash Lab is an explorable Wanix lesson that builds a complete ESP8266 application inside the browser and prepares it for Web Serial installation on a selected development board.

A visitor changes a name and the built-in LED's flash rate. Browser JavaScript generates `main.cpp`; Wanix boots an Alpine Linux guest in v86; the guest compiles and links the application with the real 32-bit Xtensa toolchain; and the resulting `firmware.bin` returns through the Wanix filesystem.

The web host serves static HTML, JavaScript, WebAssembly and toolchain archives. There is no application backend, build API, remote container or server-side compiler. Generated source, shell commands, compiler output and firmware never leave the visitor's browser.

The page is deliberately about Wanix rather than browser flashing in general. It makes these ideas visible:

- archives, RAM, files and devices composed into one namespace with `wanix-bind`;
- a Linux VM exposed through `#vm`;
- source and artifacts shared through a browser-backed filesystem;
- a terminal treated as a readable and writable file;
- automation and a human interactively taking turns on the same guest terminal;
- an ordinary native command-line toolchain becoming part of a local-first web application.

## What is built

Every click compiles a newly generated `main.cpp`, links a complete `firmware.elf`, and converts it into a complete flashable `firmware.bin`. The firmware starts at flash offset `0x000000`; there is no separately compiled configuration block.

The packaged Arduino core is precompiled as `libFrameworkArduino.a`. That is a toolchain input analogous to a standard library, not a prebuilt user application. The visitor's source, object, linked ELF and final firmware are new on every run.

The generated source includes constants like:

```cpp
constexpr char kOwner[] = "Luke";
constexpr uint32_t kBlinkHalfPeriodMs = 500;
```

Both values affect the target application. The serial greeting confirms the name and selected board profile, while the built-in active-low LED makes the selected timing directly visible.

## Board profiles

The browser passes one whitelisted profile name to the guest build. `direct-build.sh` owns the corresponding compiler macro, pin variant, linker layout and flash capacity; the UI cannot inject arbitrary compiler flags.

| Profile | Flash | Build inputs | Validation |
| --- | ---: | --- | --- |
| Wemos D1 mini Pro | 16 MiB | `d1_mini`, `eagle.flash.16m14m.ld` | Physically verified |
| Wemos/LOLIN D1 mini or D1 R2 | 4 MiB | `d1_mini`, `eagle.flash.4m1m.ld` | Community test |
| NodeMCU 1.0 / ESP-12E | 4 MiB | `nodemcu`, `eagle.flash.4m1m.ld` | Community test |

All three use the ESP8266 ROM bootloader through ESP Web Tools. ESP Web Tools can verify that the selected chip is an ESP8266, but it cannot distinguish these physical board models; choosing the correct profile remains the visitor's responsibility.

## The three computers

1. The browser host runs the UI, Wanix and Web Serial.
2. A 32-bit Alpine Linux guest runs under v86 with the Xtensa LX106 compiler, Arduino headers and SDK libraries.
3. The ESP8266 executes the resulting application on the physical board.

Wanix connects them by presenting resources as paths. The important runtime paths are:

```text
/
├── opt/xtensa-lx106   compiler archive
├── opt/esp8266        Arduino SDK, linker inputs and precompiled core
├── workspace          #ramfs/new
│   ├── main.cpp       written by browser JavaScript
│   ├── build.sh       bound from an HTTP-served file
│   └── artifacts      written by the Linux guest
└── vm                 #vm
```

## Runtime flow

1. `index.html` composes Linux, the ESP8266 toolchain, a RAM workspace and v86 into a Wanix namespace.
2. `app.js` writes the personalized `main.cpp` into `/workspace`.
3. JavaScript opens the VM terminal's `/data` file, sends the build command and reads the transcript.
4. `direct-build.sh` resolves the selected board through a strict profile table, compiles `main.cpp`, links it against the packaged Arduino core and SDK, and runs `wanix-elf2bin`.
5. The guest writes `firmware.bin` and `result.json` back into `/workspace/artifacts`.
6. Browser JavaScript reads the firmware through the same Wanix namespace, hashes it and creates an ESP Web Tools manifest.
7. The visitor can attach `wanix-term` to the same guest, inspect the source and artifacts, and run the compiler themselves.
8. A human selects the USB serial device and confirms installation.

The interactive terminal is detached while a build is running so the build controller has exclusive ownership of the guest console. It can be reopened immediately afterward; the VM and its files remain in place.

## Components

- `index.html` is the lesson, Wanix namespace declaration and Web Serial boundary.
- `style.css` implements the Tiny Computer Workshop and field-manual visual system.
- `app.js` generates source, drives the guest terminal, displays build stages, returns artifacts and attaches the interactive shell.
- `direct-build.sh` is the guest-side compile, link and packaging pipeline.
- `prepare-direct-assets.sh` builds the native Arduino core and packages the trimmed 32-bit Linux toolchain environment.
- `tools/elf2bin` is a small Go implementation of the ESP8266 Arduino image format. Preparation verifies its output byte-for-byte against Arduino's `elf2bin.py`.
- `platformio.ini` pins PlatformIO Espressif8266 2.6.3, Arduino-ESP8266 2.7.4 and Xtensa GCC 4.8.2 for the three board profiles.

Generated assets, local artifacts and device backups are ignored by Git.

## Measurements

Measured on Luke's Mac and in the in-app browser on August 4, 2026:

| Operation | Result |
| --- | ---: |
| Wanix namespace, 24 MiB toolchain and v86 boot | 6.1–7.0 s |
| Full Wanix/v86 compile, link and package | 36 s guest / 36.8–37.5 s browser |
| Personalized application ELF | 947,160 bytes |
| Personalized flashable firmware | 266,448 bytes |
| Compressed Linux toolchain and Arduino environment | 24 MiB |

Changing the LED cycle from 1,000 ms to 3,000 ms produced a different firmware hash, confirming that the selected timing reaches the newly linked application.

The earlier config-only experiment built in roughly 2.3 seconds with an 8.7 MiB environment. The full build is substantially slower and larger, but it demonstrates the more compelling claim: Wanix runs the complete user-application build rather than patching a cached application.

## Running it

Create the local PlatformIO environment if it does not already exist:

```sh
python3 -m venv .native/venv
.native/venv/bin/pip install platformio==6.1.19
```

Build the native Arduino core and package the browser's Linux toolchain:

```sh
cd ../..
make js wasm-go
cd spikes/personal-firmware
PIO="$PWD/.native/venv/bin/pio" sh prepare-direct-assets.sh
```

Serve the Wanix repository root:

```sh
cd /path/to/wanix
python3 -m http.server 7071 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:7071/spikes/personal-firmware/index.html
```

The build works without attached hardware. Web Serial installation requires desktop Chrome or Edge on HTTPS or localhost and a human selection in the serial-device chooser.

## Physical validation and recovery

The D1 mini Pro path has been physically exercised. The D1 mini/D1 R2 and NodeMCU profiles have build-level coverage but remain explicitly marked as community-test profiles until someone reports a successful physical flash and LED result.

Before the earlier flash, the first 4 MiB of the board were saved to:

```text
.native/device-backups/wemos-d1-mini-pro-first-4m-before-wanix.bin
```

That is not a full-chip backup: the upper 12 MiB of the 16 MiB device were not preserved. The public lesson must clearly identify the supported board, show that installation writes from `0x000000`, require the browser's human confirmation and retain recovery instructions.
