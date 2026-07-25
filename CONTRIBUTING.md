# Contributing

Thank you for contributing! Here are some tips to get started quickly. If you 
run into anything in this process, be sure to submit an issue or let us know in Discord.

We want contributing and first-time experiences to be as smooth as possible.

## Building from source

### Prerequisites

You will need Docker 20.10+ (or Podman 5.5+) to build some project dependencies
and the complete examples.

- [Docker 20.10+](https://docs.docker.com/get-docker/)

Building the runtime and command requires Go, Node.js with npm, and `make`.
TinyGo is optional but recommended for producing the optimized Wasm module.

- [Go 1.26+](https://golang.org/dl/)
- [Node.js](https://nodejs.org/)
- [TinyGo 0.40+](https://tinygo.org/getting-started/install/) (optional)

### Our Makefile

Wanix *is* a more advanced project with a number of components working together,
so we do lean on containers and `make` to streamline the contributor experience.

We keep our `Makefile` as simple, organized, and self-documenting as possible. 
You can quickly see possible tasks with descriptions simply by running:

```sh
make
```

Below, we document all you should need to know to get started. However, don't 
be afraid to skim the `Makefile` to see what's going on.


### Building Wanix

#### Setup symlink

We recommend setting up a symlink in your PATH for command builds:

```sh
make link
```

This creates a `wanix` symlink in `/usr/local/bin` (configurable with
`LINK_BIN`) that points to where we put built binaries so that building
`wanix` is all that's needed to make it available in your PATH.

This task is totally optional and may require `sudo` on some systems.

#### Build Wanix runtime and command

Build the JavaScript runtime, Wasm modules, and the `wanix` command:

```sh
make all
```

The JavaScript and Wasm runtime artifacts are output to `dist/`. The command
binary is output to `.local/bin/wanix`; if you ran `make link`, it will also be
available as `wanix` in your `PATH`.

By default, the Wasm build produces `dist/wanix.debug.wasm` with Go. If TinyGo
is installed, it also produces the smaller optimized `dist/wanix.wasm`;
otherwise the TinyGo build is skipped.

You can build either Wasm module directly with `make wasm-go` or
`make wasm-tinygo`.

#### Other build tasks

From here you can run specific `make` tasks for specific components; run
`make` to see what's available. For example, build just the `wanix` command
with `make cmd`, the JavaScript and Wasm runtime with `make js wasm`, or either
Wasm module with the targets above.

To build the command and runtime entirely in a container, use
`make build-docker`.


## Directory Layout

```
wanix/
├── api/        # Wanix filesystem API over Duplex
├── cmd/        # Wanix command-line tool
├── elements/   # Wanix web components
├── examples/   # Runnable local examples
├── extras/     # Package of support files for CDN
├── fs/         # General filesystem API and toolkit
├── gojs/       # Web worker for `gojs` tasks
├── misc/       # Support packages
├── rc/         # Wanix shell based on Plan 9 shell
├── term/       # Terminal device package
├── test/       # Various test suites
├── vm/         # Virtual machine device package
├── wasi/       # Web worker for `wasi` tasks
├── wasm/       # Default Wasm module for Wanix
├── web/        # Web namespace packages
└── workbench/  # VSCode based work environment
```

---
Something missing? Let us know via GitHub issue or Discord.
