# ClawOS — AI-Native Mobile Operating System

> [中文](README.md)

ClawOS is an experimental mobile OS deeply customized on AOSP. Instead of traditional touch interactions, users express their intent in **natural language**, and the underlying LLM-powered [OpenClaw](https://github.com/nicepkg/openclaw) toolchain handles the rest.

## Features

- **Natural Language Interaction** — Built-in OpenClaw Gateway for conversational device control
- **Dual LLM Support** — Cloud (Gemini / Claude / GPT) + Local (Ollama), one-tap switch in UI
- **Offline Voice** — On-device STT (Chinese + English) and TTS (Chinese) via Sherpa-ONNX, no internet required
- **Browser Automation** — AI controls WebView via CDP protocol, acting on behalf of the user
- **Chinese Input** — Pre-installed Trime (RIME) input method, offline Pinyin ready out of the box
- **App Drawer** — Swipe-up gesture + button entry, search, half/full screen toggle
- **Kiosk Mode** — ClawOS as the sole Launcher for immersive full-screen experience

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   ClawOS UI (React)                 │
│  Vite + TypeScript + Tailwind + Zustand + Three.js  │
├─────────────────────────────────────────────────────┤
│              Capacitor Native Bridge                │
│    ClawOSBridge (System Info) │ ClawOSVoice (Voice) │
├─────────────────────────────────────────────────────┤
│              Android WebView Shell                  │
│  Launcher Activity │ BrowserActivity │ FloatingWin  │
├─────────────────────────────────────────────────────┤
│            OpenClaw Gateway (Node.js)               │
│     WebSocket RPC │ LLM Provider │ Tool Calling     │
├─────────────────────────────────────────────────────┤
│              AOSP Custom ROM                        │
│  init.clawos.rc │ SELinux Policy │ Boot Animation   │
└─────────────────────────────────────────────────────┘
```

## Download (Pre-built ROM)

Try ClawOS without building from source. Download pre-built images from SourceForge:

**[SourceForge Downloads](https://sourceforge.net/projects/clawos/files/)**

| File | Description | Use Case |
|------|-------------|----------|
| [`pixel8pro/vX.X/system.img`](https://sourceforge.net/projects/clawos/files/pixel8pro/) | Pixel 8 Pro GSI system image | Flash to device |
| [`pixel8pro/vX.X/vbmeta.img`](https://sourceforge.net/projects/clawos/files/pixel8pro/) | AVB-disabled vbmeta | Flash to device |
| [`emulator/vX.X/`](https://sourceforge.net/projects/clawos/files/emulator/) | Emulator image (ARM64) | Mac (Apple Silicon) emulator |
| [`prebuilt/`](https://sourceforge.net/projects/clawos/files/prebuilt/) | Node.js ARM64 binary + Gateway bundle | Build from source |

## Quick Start (Pre-built Images)

### Option A: Flash to Pixel 8 Pro

**Prerequisites**: Unlocked bootloader, `adb` and `fastboot` installed.

1. Download `system.img` and `vbmeta.img` from SourceForge
2. Flash:

**Mac / Linux:**

```bash
bash aosp/flash-pixel8pro-mac.sh
```

**Windows (PowerShell):**

```powershell
.\aosp\flash-pixel8pro-win.ps1        # Interactive mode
.\aosp\flash-pixel8pro-win.ps1 -Auto  # Fully automated
```

**Manual flashing steps:**

```bash
# 1. Enter bootloader
adb reboot bootloader

# 2. Flash vbmeta (disable verification) — in bootloader mode
fastboot flash vbmeta_a vbmeta.img
fastboot flash vbmeta_b vbmeta.img

# 3. Switch to fastbootd for system (Pixel 8 Pro uses dynamic partitions)
fastboot reboot fastboot
fastboot flash system system.img

# 4. Wipe data and reboot
fastboot -w
fastboot reboot
```

> ⚠️ Pixel 8 Pro notes:
> - `system.img` **must** be flashed in fastbootd mode (`fastboot reboot fastboot`)
> - `vbmeta.img` **must** be flashed in bootloader mode
> - First-time flash: recommended to wipe data with `-w`

### Option B: Run in Emulator

> ⚠️ **Architecture limitation**: AOSP emulator images are ARM64 and **only work on ARM64 hosts**:
> - ✅ Mac (Apple Silicon: M1/M2/M3/M4)
> - ✅ Windows ARM64 (e.g., Surface Pro X, Hyper-V required)
> - ❌ x86_64 Windows / Intel Mac not supported

1. Download the emulator image zip from SourceForge
2. Install Android SDK (with `emulator` and `platform-tools`)
3. Run:

**Mac:**

```bash
bash aosp/run-emulator-mac.sh --images ~/Downloads/clawos-emulator
```

**Windows ARM64 (PowerShell):**

```powershell
.\aosp\run-emulator-win.ps1 -ImageDir "$env:USERPROFILE\Downloads\clawos-emulator"
```

## Build from Source

### Requirements

| Component | Requirement |
|-----------|-------------|
| **Linux Build Machine** | Ubuntu 22.04+ x86_64, 16+ cores, 64+ GB RAM, 300+ GB SSD |
| **JDK** | OpenJDK 21 (for Gradle) |
| **Node.js** | 22+ LTS |
| **pnpm** | 10.x |
| **Android SDK** | API 31+ (for Capacitor APK) |
| **AOSP Source** | ~200 GB disk space |
| **Mac (optional)** | Apple Silicon, for running ARM64 emulator |
| **Windows (optional)** | ARM64 for emulator; x86_64 for image pull + device flash only |

### 1. Clone & Configure

```bash
git clone https://github.com/Lingxi-AI-cn/ClawOS.git
cd ClawOS

# Copy environment template and edit
cp env.example aosp/.env.local
# Edit aosp/.env.local — set LINUX_USER, LINUX_HOST, etc.
```

### 2. UI Development (frontend only, no AOSP needed)

```bash
cd ui
pnpm install
pnpm run dev    # Starts Vite dev server at http://localhost:5173
```

Requires a running Gateway for AI chat. See [OpenClaw docs](https://github.com/nicepkg/openclaw).

### 3. Build Android APK

```bash
cd ui
pnpm run build
npx cap sync android

export JAVA_HOME=$JAVA_HOME    # from .env.local
cd android
./gradlew assembleDebug

# Output: app/build/outputs/apk/debug/app-debug.apk
```

### 4. Build ROM

Requires AOSP source sync. See [AOSP Build Guide](aosp/GUIDE.md).

**One-command build:**

```bash
bash build-rom.sh
```

**Or step by step:**

```bash
# Step 1: Build APK (see above)
# Step 2: Sync device tree
bash aosp/scripts/05-setup-device-tree.sh

# Step 3: AOSP build (GSI, Android 16)
cd /opt/aosp
source build/envsetup.sh
lunch clawos_gsi_arm64-trunk_staging-userdebug
m -j$(nproc)

# Output: out/target/product/clawos_gsi_arm64/system.img
```

### 5. Pull Images to Local Machine

**Mac:**

```bash
bash aosp/pull-pixel8pro-images-mac.sh        # Pixel 8 Pro images
bash aosp/run-emulator-mac.sh --pull --clean   # Emulator images
```

**Windows (PowerShell):**

```powershell
.\aosp\pull-pixel8pro-images-win.ps1           # Pixel 8 Pro images
.\aosp\run-emulator-win.ps1 -Pull -Clean       # Emulator images (ARM64 Windows only)
```

### 6. Publish to SourceForge

```bash
bash aosp/scripts/upload-sourceforge.sh v1.0 --all
```

## Project Structure

```
ClawOS/
├── ui/                          # Main UI application
│   ├── src/                     # React + TypeScript source
│   │   ├── components/          # UI components (ChatPanel, InputBar, HUD, AppDrawer...)
│   │   ├── gateway/             # Gateway WebSocket client + platform bridge
│   │   ├── voice/               # Voice module (STT/TTS Capacitor plugin)
│   │   ├── store/               # Zustand state management
│   │   └── scene/               # 3D scene (Three.js)
│   ├── android/                 # Capacitor Android project
│   │   └── app/src/main/java/   # Native plugins (ClawOSBridge, ClawOSVoice)
│   └── electron/                # Electron desktop shell
├── aosp/                        # AOSP build scripts and device tree
│   ├── device/clawos/           # ClawOS device tree (product def, init, SELinux)
│   │   ├── gateway/             # OpenClaw Gateway config and startup
│   │   ├── init/                # Android init service definitions
│   │   ├── overlay/             # Framework resource overlays
│   │   └── sepolicy/            # SELinux policies
│   ├── scripts/                 # Build scripts (01-setup → 05-sync)
│   ├── run-emulator-mac.sh      # Mac emulator runner
│   ├── run-emulator-win.ps1     # Windows emulator runner
│   ├── flash-pixel8pro-mac.sh   # Mac Pixel 8 Pro flasher
│   ├── flash-pixel8pro-win.ps1  # Windows Pixel 8 Pro flasher
│   └── GUIDE.md                 # AOSP build guide
├── build/                       # Desktop deployment scripts
├── env.example                  # Environment variable template
├── build-rom.sh                 # One-command ROM build script
└── CLAUDE.md                    # AI assistant project context
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend UI** | React 19 · TypeScript 5.9 · Vite 7 · Tailwind CSS 4 · Zustand 5 · Three.js |
| **Mobile Shell** | Capacitor 7 · Android WebView · Custom Capacitor Plugins |
| **Voice Engine** | Sherpa-ONNX · Silero VAD · Streaming Zipformer STT · Matcha TTS |
| **AI Backend** | OpenClaw Gateway · Node.js 22 · WebSocket RPC Protocol v3 |
| **LLM** | Gemini Flash (cloud) · Claude (cloud) · Ollama (local) |
| **Input Method** | Trime (RIME engine) · Offline Pinyin |
| **OS Base** | AOSP 16 (Pixel GSI) |
| **Desktop** | Electron 40 · Ubuntu 24.04 Kiosk |

## External Dependencies (for building from source)

These large files are not in the Git repo. Download from SourceForge [prebuilt/](https://sourceforge.net/projects/clawos/files/prebuilt/) or obtain manually:

| File | Size | Source |
|------|------|--------|
| `ui/android/app/libs/sherpa-onnx.aar` | ~38 MB | [Sherpa-ONNX Releases](https://github.com/k2-fsa/sherpa-onnx/releases) |
| `aosp/device/clawos/models/` | ~123 MB | [Hugging Face](https://huggingface.co/csukuangfj) (STT/TTS/VAD models) |
| `aosp/device/clawos/prebuilt/node` | ~68 MB | SourceForge prebuilt or cross-compile |
| `aosp/device/clawos/gateway/gateway-bundle.tar.gz` | ~67 MB | SourceForge prebuilt or `npm pack openclaw` |
| `aosp/device/clawos/apps/ClawOS.apk` | ~108 MB | Build output (Step 3) |

## Verified Devices

| Device | SoC | Android | Status |
|--------|-----|---------|--------|
| Google Pixel 8 Pro | Tensor G3 | 16 (GSI) | ✅ Fully working |
| Lenovo Tab M10 FHD Plus | MT8768 | 12 (GSI) | ✅ Working |
| AOSP Emulator (Mac ARM64) | Virtual | 16 | ✅ Working |

## License

Copyright 2026 Lingxi AI

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
