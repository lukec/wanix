const pageStarted = performance.now();

await Promise.all([
  customElements.whenDefined("wanix-namespace"),
  customElements.whenDefined("wanix-vm"),
]);

const system = document.querySelector("#linux");
const vm = document.querySelector("#builder");
const buildButton = document.querySelector("#build");
const ownerInput = document.querySelector("#owner");
const blinkInput = document.querySelector("#blink-period");
const blinkValue = document.querySelector("#blink-value");
const sourcePreview = document.querySelector("#source-preview");
const status = document.querySelector("#status");
const statusMessage = document.querySelector("#status-message");
const elapsed = document.querySelector("#elapsed");
const terminal = document.querySelector("#terminal");
const installer = document.querySelector("#installer");
const download = document.querySelector("#download");
const previewOutput = document.querySelector("#preview-output");
const deviceOutput = document.querySelector("#device-output");
const namespaceState = document.querySelector("#namespace-state");
const runtimeLocation = document.querySelector("#runtime-location");
const runtimeDetail = document.querySelector("#runtime-detail");
const firmwareSize = document.querySelector("#firmware-size");
const elfSize = document.querySelector("#elf-size");
const firmwareHash = document.querySelector("#firmware-hash");
const firmwareRegion = document.querySelector("#firmware-region");
const artifactSummary = document.querySelector("#artifact-summary");
const buildStages = Array.from(document.querySelectorAll(".build-stage"));
const openShellButton = document.querySelector("#open-shell");
const shellMount = document.querySelector("#guest-shell-mount");
const shellStatus = document.querySelector("#shell-status");
const terminalPath = document.querySelector("#terminal-path");
const artifactCommand = document.querySelector("#artifact-command");
const buildLabel = document.querySelector("#build-label");
const openShellLabel = document.querySelector("#open-shell-label");
const flashButton = document.querySelector("#flash-activate");
const flashNextCue = document.querySelector("#flash-next-cue");
const actionGuide = document.querySelector("#action-guide");
const actionGuideStatus = document.querySelector("#action-guide-status");
const actionGuideNext = document.querySelector("#action-guide-next");
const actionGuideNextLabel = document.querySelector("#action-guide-next-label");
const actionProgressBar = document.querySelector("#action-progress-bar");
const actionSteps = Array.from(document.querySelectorAll("[data-action-step]"));

let firmwareURL;
let manifestURL;
let latestBuild;
let guestShell;

updatePersonalization();
setActionGuide("booting");
ownerInput.addEventListener("input", updatePersonalization);
blinkInput.addEventListener("input", updatePersonalization);
actionGuideNext.addEventListener("click", (event) => {
  if (actionGuideNext.getAttribute("aria-disabled") === "true") event.preventDefault();
});

system.addEventListener("error", (event) => {
  setStatus(`Wanix namespace failed: ${event.detail.error.message}`);
  setActionGuide("error", "Wanix could not start. Reload the page to try again.");
  namespaceState.textContent = "failed";
});

vm.addEventListener("error", (event) => {
  setStatus(`Linux guest failed: ${event.detail.error.message}`);
  setActionGuide("error", "Linux could not start. Reload the page to try again.");
});

vm._nsReady.then(async () => {
  namespaceState.textContent = "mounted";
  setRuntime("Linux guest", "Wanix is waiting for v86 to expose its task device.");
  setStatus("The namespace is ready. Linux is booting in v86…", true);
  setActionGuide("booting", "Wanix is ready; Linux is booting in this tab…");
  const taskPath = `${vm.path}/guest/#task`;
  await system.root.waitFor(taskPath, 120000);

  buildButton.disabled = false;
  buildButton.dataset.nextAction = "true";
  buildLabel.textContent = "Compile my firmware in Wanix";
  openShellButton.disabled = false;
  terminalPath.textContent = `${vm.term}/data`;
  shellStatus.textContent = "The guest is ready. Open it before or after a build.";
  const bootSeconds = ((performance.now() - pageStarted) / 1000).toFixed(1);
  elapsed.textContent = `builder ready in ${bootSeconds}s`;
  setStatus(`Ready. Wanix composed the namespace and booted Linux in ${bootSeconds}s.`);
  setActionGuide("customize");
  setRuntime("Browser host", "The UI is ready; Linux waits behind a Wanix terminal file.");
});

buildButton.addEventListener("click", async () => {
  const owner = ownerInput.value.trim() || "friend";
  const ownerBytes = new TextEncoder().encode(owner).length;
  if (ownerBytes > 64) {
    setStatus(`That name is ${ownerBytes} UTF-8 bytes; please keep it to 64.`);
    return;
  }

  const cycleMs = Number(blinkInput.value);
  const source = firmwareSource(owner, cycleMs);
  const buildID = `build-${Date.now()}`;
  const resultPath = `workspace/artifacts/${buildID}/result.json`;
  const firmwarePath = `workspace/artifacts/${buildID}/firmware.bin`;
  const sourcePath = "workspace/main.cpp";

  closeGuestShell("The interactive terminal is closed while the build controller owns the terminal file.");
  buildButton.disabled = true;
  delete buildButton.dataset.nextAction;
  buildLabel.textContent = "Compiling firmware inside Wanix…";
  openShellButton.disabled = true;
  ownerInput.disabled = true;
  blinkInput.disabled = true;
  installer.hidden = true;
  delete flashButton.dataset.nextAction;
  flashNextCue.hidden = true;
  document.querySelector(".flash-lesson").removeAttribute("data-next-action");
  download.hidden = true;
  previewOutput.disabled = true;
  deviceOutput.hidden = true;
  resetBuildStages();
  terminal.replaceChildren();

  const progress = document.createElement("pre");
  progress.textContent = "[browser] write main.cpp into the Wanix workspace\n";
  terminal.append(progress);
  setStatus(`Building a complete application for ${owner}…`, true);
  setActionGuide("compile", "Writing main.cpp, then compiling it inside Linux…");
  elapsed.textContent = "build running";
  setRuntime("Browser → Wanix", "JavaScript is writing /workspace/main.cpp.");

  const browserStart = performance.now();
  let terminalReader;
  let terminalWriter;
  let terminalOutput = "";

  try {
    await system.root.writeFile(sourcePath, source);
    progress.textContent += "[browser] open the Linux terminal through Wanix\n";
    setRuntime("Linux guest", "The shell is compiling source from the shared namespace.");

    const terminalData = await system.root.openReadable(`${vm.term}/data`);
    terminalReader = terminalData.getReader();
    const terminalInput = await system.root.openWritable(`${vm.term}/data`);
    terminalWriter = terminalInput.getWriter();
    const decoder = new TextDecoder();
    const doneMarker = `__WANIX_BUILD_${buildID}`;
    let settled = false;
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    void (async () => {
      while (true) {
        const chunk = await terminalReader.read();
        if (chunk.done) {
          if (!settled) rejectDone(new Error("Linux terminal closed before the build completed"));
          break;
        }
        terminalOutput += decoder.decode(chunk.value, { stream: true });
        progress.textContent = terminalOutput;
        updateBuildStages(terminalOutput);
        terminal.scrollTop = terminal.scrollHeight;

        const match = terminalOutput.match(new RegExp(`${doneMarker}:(\\d+)`));
        if (match && !settled) {
          settled = true;
          resolveDone(Number(match[1]));
        }
      }
    })().catch((error) => {
      if (!settled) {
        settled = true;
        rejectDone(error);
      }
    });

    const command = `BUILD_ID=${buildID} APP_SOURCE=/${sourcePath} /bin/sh /workspace/build.sh; printf '\\n${doneMarker}:%s\\n' "$?"\n`;
    await terminalWriter.write(new TextEncoder().encode(command));
    const exitCode = await withTimeout(done, 5 * 60 * 1000, "Wanix build timed out");
    if (exitCode !== 0) throw new Error(`Linux build exited with status ${exitCode}`);

    await system.root.waitFor(resultPath, 5000);
    const result = JSON.parse(await system.root.readText(resultPath));
    if (!result.ok) throw new Error(`compiler exited with status ${result.exitCode}`);

    const firmware = await system.root.readFile(firmwarePath);
    const digest = await crypto.subtle.digest("SHA-256", firmware);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const wallSeconds = ((performance.now() - browserStart) / 1000).toFixed(1);

    if (firmwareURL) URL.revokeObjectURL(firmwareURL);
    if (manifestURL) URL.revokeObjectURL(manifestURL);
    firmwareURL = URL.createObjectURL(new Blob([firmware], { type: "application/octet-stream" }));

    const manifest = {
      name: "Wanix Flash Lab",
      version: buildID,
      new_install_prompt_erase: true,
      builds: [{
        chipFamily: "ESP8266",
        parts: [{ path: firmwareURL, offset: 0 }],
      }],
    };
    manifestURL = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/json" }));
    installer.manifest = manifestURL;
    installer.hidden = false;

    download.href = firmwareURL;
    download.download = `wanix-${slug(owner)}-${cycleMs}ms.bin`;
    download.hidden = false;
    previewOutput.disabled = false;

    latestBuild = { owner, cycleMs, result, sha256 };
    artifactCommand.textContent = `cat /workspace/artifacts/${buildID}/result.json`;
    renderArtifact(latestBuild);
    completeBuildStages();
    elapsed.textContent = `${wallSeconds}s browser · ${result.buildSeconds}s guest`;
    setStatus(`Wanix returned a new ${formatBytes(result.firmwareBytes)} application. It is ready for Web Serial.`);
    setActionGuide("flash");
    flashButton.dataset.nextAction = "true";
    flashNextCue.hidden = false;
    document.querySelector(".flash-lesson").dataset.nextAction = "true";
    shellStatus.textContent = "Build complete. Reopen the same guest and inspect the files it produced.";
    setRuntime("Browser host", `Wanix returned /workspace/artifacts/${buildID}/firmware.bin.`);
  } catch (error) {
    progress.textContent = `${error}${terminalOutput ? `\n${terminalOutput}` : ""}`;
    elapsed.textContent = "build failed";
    setStatus(`Build failed: ${error.message}`);
    setActionGuide("error", "The build stopped. Inspect the transcript, then retry.");
    buildButton.dataset.nextAction = "true";
    shellStatus.textContent = "The guest is still available; open it to inspect the failed build.";
    setRuntime("Browser host", "The build stopped; inspect the Linux transcript.");
  } finally {
    await terminalReader?.cancel().catch(() => {});
    terminalWriter?.releaseLock();
    buildButton.disabled = false;
    openShellButton.disabled = false;
    ownerInput.disabled = false;
    blinkInput.disabled = false;
    buildLabel.textContent = latestBuild ? "Recompile this firmware" : "Retry the Wanix build";
  }
});

openShellButton.addEventListener("click", async () => {
  if (guestShell) {
    closeGuestShell("Terminal detached. The Linux guest is still running.");
    return;
  }

  shellMount.replaceChildren();
  guestShell = document.createElement("wanix-term");
  guestShell.id = "guest-shell";
  guestShell.setAttribute("for", "linux");
  guestShell.setAttribute("path", vm.term);
  guestShell.setAttribute("raw", "");
  guestShell.setAttribute("font-size", "13");
  guestShell.setAttribute("scrollback", "2000");
  guestShell.setAttribute("cursor-blink", "true");
  shellMount.append(guestShell);
  openShellLabel.textContent = "Close the Linux terminal";
  shellStatus.textContent = `Attached directly to ${vm.term}/data. This sandbox disappears on reload.`;
  setRuntime("Linux guest", "Your keyboard is attached through wanix-term.");
  await guestShell._nsReady;
  guestShell.focus();
});

previewOutput.addEventListener("click", () => {
  if (!latestBuild) return;
  const halfPeriod = Math.round(latestBuild.cycleMs / 2);
  deviceOutput.textContent = [
    "EXPECTED OUTPUT AFTER FLASH",
    "",
    "ESP8266 boot ROM @ 74880 baud: <boot chatter>",
    "Application @ 115200 baud:",
    `Hello, ${latestBuild.owner}! This entire application was compiled locally in Wanix.`,
    "",
    `Built-in LED: ${halfPeriod} ms ON / ${halfPeriod} ms OFF`,
    "The animated board is a preview; flashing the real board is the proof.",
  ].join("\n");
  deviceOutput.hidden = false;
});

function updatePersonalization() {
  const owner = ownerInput.value.trim() || "friend";
  const cycleMs = Number(blinkInput.value);
  const hz = (1000 / cycleMs).toFixed(2);
  blinkValue.textContent = `${(cycleMs / 1000).toFixed(1)} seconds · ${hz} Hz`;
  document.documentElement.style.setProperty("--blink-period", `${cycleMs}ms`);
  sourcePreview.textContent = firmwareSource(owner, cycleMs);
}

function firmwareSource(owner, cycleMs) {
  const halfPeriod = Math.round(cycleMs / 2);
  return `#include <Arduino.h>

constexpr char kOwner[] = ${cppString(owner)};
constexpr uint32_t kBlinkHalfPeriodMs = ${halfPeriod};

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);

  delay(500);
  Serial.println();
  Serial.print("Hello, ");
  Serial.print(kOwner);
  Serial.println("! This entire application was compiled locally in Wanix.");
}

void loop() {
  // The D1 mini Pro LED is active-low.
  digitalWrite(LED_BUILTIN, LOW);
  delay(kBlinkHalfPeriodMs);
  digitalWrite(LED_BUILTIN, HIGH);
  delay(kBlinkHalfPeriodMs);
}
`;
}

function cppString(value) {
  return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function resetBuildStages() {
  for (const stage of buildStages) delete stage.dataset.state;
}

function updateBuildStages(output) {
  if (output.includes("[wanix] 3/3")) {
    setBuildStage("compile", "done");
    setBuildStage("link", "done");
    setBuildStage("package", "active");
    setActionGuide("package");
  } else if (output.includes("[wanix] 2/3")) {
    setBuildStage("compile", "done");
    setBuildStage("link", "active");
    setActionGuide("link");
  } else if (output.includes("[wanix] 1/3")) {
    setBuildStage("compile", "active");
    setActionGuide("compile");
  }
}

function completeBuildStages() {
  for (const stage of buildStages) stage.dataset.state = "done";
}

function setBuildStage(name, state) {
  document.querySelector(`[data-stage="${name}"]`).dataset.state = state;
}

function renderArtifact(build) {
  firmwareSize.textContent = formatBytes(build.result.firmwareBytes);
  elfSize.textContent = formatBytes(build.result.elfBytes);
  firmwareHash.textContent = `${build.sha256.slice(0, 16)}…${build.sha256.slice(-8)}`;
  const percent = build.result.firmwareBytes / (16 * 1024 * 1024) * 100;
  firmwareRegion.style.width = `${Math.max(3.5, percent)}%`;
  firmwareRegion.title = `${percent.toFixed(2)}% of the 16 MiB flash chip`;
  artifactSummary.textContent = `${formatBytes(build.result.firmwareBytes)} starts at 0x000000 (${percent.toFixed(2)}% of the chip). The bar is widened so the new application remains visible.`;
}

function setRuntime(location, detail) {
  runtimeLocation.textContent = location;
  runtimeDetail.textContent = detail;
}

function setStatus(message, busy = false) {
  statusMessage.textContent = message;
  if (busy) status.dataset.busy = "true";
  else delete status.dataset.busy;
}

function setActionGuide(phase, message) {
  const phases = {
    booting: {
      status: "Starting browser-local Linux…",
      next: "Builder starting",
      icon: "⌛",
      href: "#source-title",
      progress: 8,
      active: -1,
      disabled: true,
    },
    customize: {
      status: "Builder ready. Start with your name and blink rate.",
      next: "Start: customize",
      icon: "↓",
      href: "#source-title",
      progress: 18,
      active: 0,
    },
    compile: {
      status: "Compiling your generated C++ inside Linux…",
      next: "Build running",
      icon: "⚙",
      href: "#build-title",
      progress: 43,
      active: 1,
      disabled: true,
    },
    link: {
      status: "Compile complete. Linking your code with the Arduino core…",
      next: "Build running",
      icon: "⚙",
      href: "#build-title",
      progress: 56,
      active: 1,
      disabled: true,
    },
    package: {
      status: "Link complete. Packaging the flashable firmware image…",
      next: "Build running",
      icon: "⚙",
      href: "#build-title",
      progress: 68,
      active: 1,
      disabled: true,
    },
    flash: {
      status: "Firmware ready. Connect your ESP8266 and flash it next.",
      next: "Next: connect & flash",
      icon: "⚡",
      href: "#flash-title",
      progress: 82,
      active: 2,
    },
    error: {
      status: "The build stopped. Check the transcript and try again.",
      next: "Back to build controls",
      icon: "↺",
      href: "#source-title",
      progress: 38,
      active: 1,
      error: true,
    },
  };
  const config = phases[phase];
  actionGuide.dataset.phase = phase;
  actionGuideStatus.textContent = message || config.status;
  actionGuideNext.href = config.href;
  actionGuideNext.querySelector(".button-icon").textContent = config.icon;
  actionGuideNextLabel.textContent = config.next;
  actionGuideNext.setAttribute("aria-disabled", config.disabled ? "true" : "false");
  actionProgressBar.style.width = `${config.progress}%`;

  for (const [index, step] of actionSteps.entries()) {
    delete step.dataset.state;
    step.removeAttribute("aria-current");
    if (index < config.active) step.dataset.state = "done";
    if (index === config.active) {
      step.dataset.state = config.error ? "error" : "active";
      step.setAttribute("aria-current", "step");
    }
  }
}

function closeGuestShell(message) {
  if (guestShell) {
    guestShell.remove();
    guestShell = undefined;
    shellMount.innerHTML = `<div class="shell-placeholder"><span>&gt;_</span><p>Open the terminal to explore the Linux machine.</p></div>`;
  }
  openShellLabel.textContent = "Open the Linux terminal";
  if (message) shellStatus.textContent = message;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "firmware";
}
