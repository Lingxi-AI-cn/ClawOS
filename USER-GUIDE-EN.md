# ClawOS ROM Testing Guide

Welcome to ClawOS! This is an AI-driven experimental operating system that lets you interact with your device through natural language. This guide will help you run ClawOS ROM on an emulator or a real device.

---

## Table of Contents

- [Download ROM](#download-rom)
- [Option 1: Emulator](#option-1-emulator)
- [Option 2: Flash to Real Device](#option-2-flash-to-real-device)
- [First Boot](#first-boot)
- [Device Compatibility](#device-compatibility)
- [FAQ](#faq)
- [Feedback & Contributing](#feedback--contributing)

---

## Download ROM

Download pre-built images from [SourceForge](https://sourceforge.net/projects/clawos/files/):

| File | Description | Use Case |
|------|-------------|----------|
| [`pixel8pro/vX.X/system.img`](https://sourceforge.net/projects/clawos/files/pixel8pro/) | GSI system image (~4.5 GB) | ARM64 devices with unlocked bootloader |
| [`pixel8pro/vX.X/vbmeta.img`](https://sourceforge.net/projects/clawos/files/pixel8pro/) | AVB-disabled vbmeta | Required for device flashing |
| [`emulator/vX.X/`](https://sourceforge.net/projects/clawos/files/emulator/) | Emulator system image (~1.5 GB) | Android Emulator on ARM64 hosts |

Each version directory includes a `SHA256SUMS.txt` file for download integrity verification.

---

## Option 1: Emulator

> ⚠️ **Architecture limitation**: AOSP emulator images are ARM64 and **only work on ARM64 hosts**:
> - ✅ Mac (Apple Silicon: M1/M2/M3/M4) — Recommended, native ARM64 performance
> - ✅ Windows ARM64 (e.g., Surface Pro X, Hyper-V required)
> - ❌ **x86_64 Windows / Intel Mac not supported** (cannot efficiently run ARM64 images)

### Prerequisites

1. Install [Android Studio](https://developer.android.com/studio)
2. Open Android Studio → SDK Manager → SDK Tools, ensure these are installed:
   - Android Emulator
   - Android SDK Platform-Tools
   - Android SDK Command-line Tools

### Automated Setup (Recommended)

**Mac:**

```bash
# Clone the repo (or just download the script)
git clone https://github.com/Lingxi-AI-cn/ClawOS.git
cd ClawOS

# Place the downloaded emulator image zip from SourceForge
mkdir -p ~/clawos-emulator-images
cp ~/Downloads/sdk-repo-*.zip ~/clawos-emulator-images/

# One-command setup and launch
bash aosp/run-emulator-mac.sh --clean
```

**Windows ARM64 (PowerShell):**

```powershell
# Clone the repo
git clone https://github.com/Lingxi-AI-cn/ClawOS.git
cd ClawOS

# Place the downloaded emulator image zip from SourceForge
mkdir "$env:USERPROFILE\clawos-emulator-images"
Copy-Item "$env:USERPROFILE\Downloads\sdk-repo-*.zip" "$env:USERPROFILE\clawos-emulator-images\"

# One-command setup and launch
.\aosp\run-emulator-win.ps1 -Clean
```

The script handles: extracting images → creating AVD → configuring → launching the emulator.

### Manual Setup

```bash
# 1. Create image directory
IMAGES=~/clawos-emulator-images
mkdir -p $IMAGES && cd $IMAGES

# 2. Extract images
unzip ~/Downloads/clawos-emu-arm64-*.zip

# 3. Verify source.properties
cat $IMAGES/arm64-v8a/source.properties
# Should contain: SystemImage.Abi=arm64-v8a

# 4. Install as SDK system image
SDK_DIR=~/Library/Android/sdk
IMG_DIR=$SDK_DIR/system-images/android-16-clawos/default/arm64-v8a
mkdir -p $IMG_DIR
cp -r $IMAGES/arm64-v8a/* $IMG_DIR/

# 5. Create AVD
$SDK_DIR/cmdline-tools/latest/bin/avdmanager create avd \
  -n ClawOS_ARM64 \
  -k "system-images;android-16-clawos;default;arm64-v8a" \
  -d pixel_7 --force

# 6. Launch emulator
$SDK_DIR/emulator/emulator -avd ClawOS_ARM64 -no-snapshot -gpu auto
```

### Emulator Tips

- **First boot** takes 1-2 minutes for system initialization
- **Microphone**: Extended Controls → Microphone → Check "Virtual microphone uses host audio input"
- **GPU issues**: Try `-gpu swiftshader_indirect` instead of `-gpu auto` if you see a black screen
- **Memory**: Allocate at least 4 GB RAM to the emulator

---

## Option 2: Flash to Real Device

> ⚠️ **Risk Warning**: Flashing third-party ROMs carries a risk of bricking your device. Make sure you understand fastboot operations and have a backup of your original ROM.

### Prerequisites

1. Device bootloader is unlocked
2. `adb` and `fastboot` tools installed on your computer
3. Device battery > 50%
4. USB cable connected properly

### Unlock Bootloader (Pixel Example)

```bash
# 1. On phone: Settings → About Phone → Tap "Build Number" 7 times to enable Developer Options
# 2. Settings → System → Developer Options → Enable "OEM Unlocking"
# 3. Connect to computer
adb reboot bootloader
fastboot flashing unlock
# 4. Use volume keys on phone to confirm unlock
```

### Flash GSI (A/B Dynamic Partition Devices)

For: Pixel 6/7/8/9 series and most flagship phones released after 2021.

**Using the flash script (recommended):**

Download `system.img` and `vbmeta.img` from SourceForge, then:

```bash
# Mac / Linux
bash aosp/flash-pixel8pro-mac.sh
```

```powershell
# Windows (PowerShell)
.\aosp\flash-pixel8pro-win.ps1        # Interactive mode
.\aosp\flash-pixel8pro-win.ps1 -Auto  # Fully automated
```

**Manual flashing:**

```bash
# 1. Enter bootloader mode
adb reboot bootloader

# 2. Flash vbmeta (disable verified boot)
fastboot flash vbmeta_a vbmeta.img
fastboot flash vbmeta_b vbmeta.img

# 3. Switch to fastbootd mode (required for dynamic partitions)
fastboot reboot fastboot

# 4. Flash ClawOS system image
fastboot flash system system.img

# 5. Wipe user data (required for first flash)
fastboot -w

# 6. Reboot
fastboot reboot
```

### Flash GSI (A-only Non-Dynamic Partition Devices)

For: Some mid-range devices from 2019-2020.

```bash
adb reboot bootloader
fastboot flash system system.img
fastboot --disable-verity --disable-verification flash vbmeta vbmeta.img
fastboot -w
fastboot reboot
```

### Restore Factory ROM

- **Pixel devices**: Visit [flash.android.com](https://flash.android.com) for one-click restore
- **Other devices**: Use the manufacturer's official flash tool

---

## First Boot

1. After booting, you'll see the ClawOS boot animation
2. The AI Brain animation in the center indicates the system is ready
3. Use the input bar at the bottom to interact with AI using natural language
4. First-time use requires configuring an LLM provider (tap the settings icon)

### Configure AI Model

ClawOS supports two AI backends:

**Cloud Model (Recommended)**:
- Go to Settings → Add Model Provider → Select Google Gemini
- Enter your API Key
- Choose a model (Gemini Flash recommended)

**Local Model**:
- Install and run [Ollama](https://ollama.com) on your computer
- Set up port forwarding: `adb reverse tcp:11434 tcp:11434`
- Switch to local model in ClawOS

---

## Device Compatibility

### Officially Tested

| Device | SoC | Status |
|--------|-----|--------|
| Google Pixel 8 Pro | Tensor G3 | ✅ Fully supported |

> We have only completed full testing on the Pixel 8 Pro. The compatibility information below is based on technical analysis. **We welcome community members to help verify other devices.**

### Requirements

ClawOS GSI is built on AOSP 16 (Android 16). Your device must meet:

- ✅ **ARM64 architecture** (nearly all phones after 2017)
- ✅ **Project Treble support** (devices shipped with Android 9+)
- ✅ **Unlocked bootloader**
- ✅ **system partition ≥ 4.5 GB** (dynamic partition devices can usually auto-resize)

### Likely Compatible Devices

**Very likely to work — Pixel series** (same AOSP base as Pixel 8 Pro):

| Device | How to Unlock |
|--------|---------------|
| Pixel 6 / 6 Pro / 6a | Enable OEM Unlock in Settings |
| Pixel 7 / 7 Pro / 7a | Enable OEM Unlock in Settings |
| Pixel 8 / 8a | Enable OEM Unlock in Settings |
| Pixel 9 / 9 Pro / 9 Pro Fold | Enable OEM Unlock in Settings |

**May work — Third-party devices**:

| Brand | Devices | Unlock Difficulty |
|-------|---------|-------------------|
| OnePlus | 9/10/11/12/13 series | ⭐ Easy (OEM unlock) |
| Nothing | Phone 1/2/2a | ⭐ Easy |
| Motorola | Edge series | ⭐ Easy (official unlock tool) |
| Xiaomi | 12/13/14 series | ⚠️ Medium (application required, 7-day wait) |
| Samsung | Galaxy S21-S24 (Exynos) | ⚠️ Varies by region (Snapdragon versions usually cannot be unlocked) |

**Known incompatible**:

| Brand | Reason |
|-------|--------|
| Huawei / Honor (post-2019) | Bootloader cannot be unlocked |
| vivo / iQOO | Most models cannot be unlocked |
| OPPO / realme (recent models) | Unlock policy tightened |

### Potential Issues

| Issue | Description |
|-------|-------------|
| Camera not working | GSI typically doesn't support device-specific camera HAL |
| Fingerprint not working | Requires device-specific vendor drivers |
| WiFi/Bluetooth issues | Some vendor HALs may not be fully compatible with AOSP 16 |
| Stuck on boot animation | system partition too small or kernel incompatible |
| Display issues | Try `fastboot -w` to wipe data and retry |

---

## FAQ

### Q: Emulator is slow / black screen

Make sure you're using ARM64 images with GPU acceleration:
```bash
emulator -avd ClawOS_ARM64 -no-snapshot -gpu swiftshader_indirect
```

### Q: Emulator says "x86 based AVD"

ARM64 images on x86 hosts require software emulation, which is slow. Use an Apple Silicon Mac for native ARM64 performance.

### Q: Device bootloops after flashing

Possible causes:
- system.img too large for device partition
- Device kernel incompatible with AOSP 16
- Solution: Use the manufacturer's recovery tool to restore factory ROM

### Q: No network after booting ClawOS

- Emulator: Check host network connection
- Real device: ClawOS supports WiFi — open Settings to connect

### Q: How to check system logs

```bash
# Check Gateway (AI backend) status
adb shell getprop clawos.gateway.status

# View system logs
adb logcat -s ClawOS.Prepare clawos_gateway

# Check Node.js process
adb shell ps -A | grep node
```

---

## Feedback & Contributing

### Report Issues

Please report on [GitHub Issues](https://github.com/Lingxi-AI-cn/ClawOS/issues) with:

- **Device model and SoC**
- **Original Android version**
- **Problem description and steps to reproduce**
- **Relevant logs** (`adb logcat` output)
- **Screenshots or video** (if applicable)

### Device Compatibility Reports

If you successfully run ClawOS on another device, please submit an Issue with:

- Device model, SoC, partition scheme
- Flashing method and steps
- Which features work / don't work

### Contribute to Development

- Fork the repo and submit Pull Requests
- See `aosp/GUIDE.md` for build instructions
- See `CLAUDE.md` for project architecture

---

*ClawOS — AI-Driven Next-Gen Operating System*
