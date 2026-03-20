#Requires -Version 5.1
# run-emulator-win.ps1 - Windows emulator image pull/run for ClawOS

[CmdletBinding()]
param(
    [switch]$Pull,
    [switch]$Setup,
    [switch]$Clean,
    [switch]$Lan,
    [string]$ImageDir = (Join-Path $env:USERPROFILE "clawos-emulator-images"),
    [string]$LinuxHost,
    [int]$LinuxPort,
    [string]$LinuxUser
)

$ErrorActionPreference = "Stop"

# Load .env.local (check script dir first, then project root)
foreach ($candidate in @($PSScriptRoot, (Split-Path $PSScriptRoot -Parent))) {
    $envFile = Join-Path $candidate ".env.local"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$') {
                [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], "Process")
            }
        }
        break
    }
}

# Apply defaults from environment variables
if (-not $LinuxHost) { $LinuxHost = if ($env:LINUX_HOST) { $env:LINUX_HOST } else { "" } }
if (-not $LinuxUser) { $LinuxUser = if ($env:LINUX_USER) { $env:LINUX_USER } else { "" } }
if ($LinuxPort -eq 0) { $LinuxPort = if ($env:LINUX_PORT) { [int]$env:LINUX_PORT } else { 22 } }

$AvdName = "ClawOS_ARM64"
$LinuxAospOut = if ($env:LINUX_AOSP_OUT) { $env:LINUX_AOSP_OUT } else { "/opt/aosp/out/target/product/emu64a" }

if ($Lan) {
    if ($env:LINUX_LAN_HOST) { $LinuxHost = $env:LINUX_LAN_HOST }
    $LinuxPort = if ($env:LINUX_LAN_PORT) { [int]$env:LINUX_LAN_PORT } else { 22 }
}

$AndroidSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME }
              elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT }
              elseif (Test-Path "C:\Android\SDK") { "C:\Android\SDK" }
              else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }

$Emulator = Join-Path $AndroidSdk "emulator\emulator.exe"
$Adb = Join-Path $AndroidSdk "platform-tools\adb.exe"

function Write-Info($msg)  { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[ERROR] $msg" -ForegroundColor Red }

function Get-FileSizeMB($filePath) {
    if (Test-Path $filePath) {
        return "{0:N1} MB" -f ((Get-Item $filePath).Length / 1MB)
    }
    return "N/A"
}

# == Pull images from Linux ==

function Step-PullImages {
    Write-Info "Pulling emulator images from Linux build server..."
    Write-Info "Target: ${LinuxUser}@${LinuxHost}:${LinuxPort}"
    Write-Host ""

    $sshTarget = "${LinuxUser}@${LinuxHost}"

    # Test SSH
    Write-Info "Testing SSH connection..."
    $result = ssh -p $LinuxPort -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new $sshTarget "echo ok" 2>&1
    if ($result -notmatch "ok") {
        Write-Err "Cannot connect to Linux: ${sshTarget}:${LinuxPort}"
        exit 1
    }
    Write-Ok "SSH connection OK"

    # Find remote zip
    Write-Info "Finding remote image zip..."
    $remoteZip = ssh -p $LinuxPort -o ConnectTimeout=10 $sshTarget "ls -t ${LinuxAospOut}/*.zip 2>/dev/null | head -1" 2>&1
    $remoteZip = ($remoteZip | Out-String).Trim()

    if (-not $remoteZip -or $remoteZip -eq "") {
        Write-Err "No emulator image zip found on remote."
        Write-Host "Remote dir: $LinuxAospOut" -ForegroundColor Yellow
        Write-Host "Build first: bash scripts/03-build-aosp.sh" -ForegroundColor Yellow
        exit 1
    }

    $remoteBasename = ($remoteZip -split "/")[-1]
    Write-Ok "Found: $remoteBasename"

    if (-not (Test-Path $ImageDir)) {
        New-Item -ItemType Directory -Path $ImageDir -Force | Out-Null
    }

    $localZip = Join-Path $ImageDir $remoteBasename

    if (Test-Path $localZip) {
        Write-Warn "Local file exists: $remoteBasename ($(Get-FileSizeMB $localZip))"
        $answer = Read-Host "  Re-download? [y/N]"
        if ($answer -ne "y" -and $answer -ne "Y") {
            Write-Ok "Skipping download"
            return
        }
    }

    Write-Info "Downloading (this may take a few minutes)..."
    Write-Host ""

    scp -P $LinuxPort -o ConnectTimeout=10 "${sshTarget}:${remoteZip}" $localZip
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Download failed"
        exit 1
    }

    Write-Host ""
    Write-Ok "Downloaded: $localZip ($(Get-FileSizeMB $localZip))"
}

# == Preflight checks ==

function Step-Preflight {
    Write-Info "Preflight checks..."

    if (-not (Test-Path $AndroidSdk)) {
        Write-Err "Android SDK not found: $AndroidSdk"
        Write-Host "Install Android Studio: https://developer.android.com/studio" -ForegroundColor Yellow
        exit 1
    }
    Write-Ok "Android SDK: $AndroidSdk"

    if (-not (Test-Path $Emulator)) {
        Write-Err "Emulator not found: $Emulator"
        Write-Host "Install via: SDK Manager > SDK Tools > Android Emulator" -ForegroundColor Yellow
        exit 1
    }
    Write-Ok "Emulator: $Emulator"

    if (-not (Test-Path $ImageDir)) {
        Write-Err "Image dir not found: $ImageDir"
        Write-Host "Run: .\run-emulator-win.ps1 -Pull" -ForegroundColor Yellow
        exit 1
    }

    $zipFile = Get-ChildItem -Path $ImageDir -Filter "*.zip" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

    $arm64Dir = Join-Path $ImageDir "arm64-v8a"
    $hasExtracted = (Test-Path (Join-Path $arm64Dir "system.img")) -or (Test-Path (Join-Path $ImageDir "system.img"))

    if (-not $zipFile -and -not $hasExtracted) {
        Write-Err "No image files found in: $ImageDir"
        Write-Host "Run: .\run-emulator-win.ps1 -Pull" -ForegroundColor Yellow
        exit 1
    }

    if ($zipFile) {
        Write-Ok "Image zip: $($zipFile.Name)"
    } else {
        Write-Ok "Images: extracted files"
    }
}

# == Extract images ==

function Step-ExtractImages {
    $zipFile = Get-ChildItem -Path $ImageDir -Filter "*.zip" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if (-not $zipFile) {
        Write-Info "Using existing extracted files"
        return
    }

    $arm64Dir = Join-Path $ImageDir "arm64-v8a"
    if (-not $Clean -and ((Test-Path (Join-Path $arm64Dir "system.img")) -or (Test-Path (Join-Path $ImageDir "system.img")))) {
        Write-Ok "Images already extracted"
        return
    }

    # Clean stale files
    $staleFiles = @(
        "system.img", "system_ext.img", "vendor.img", "vendor_boot.img",
        "userdata.img", "ramdisk.img", "kernel-ranchu", "encryptionkey.img",
        "vbmeta.img", "boot.img", "cache.img", "product.img",
        "advancedFeatures.ini", "build.prop",
        "VerifiedBootParams.textproto", "source.properties"
    )
    $cleaned = 0
    foreach ($f in $staleFiles) {
        $fp = Join-Path $ImageDir $f
        if (Test-Path $fp) { Remove-Item $fp -Force; $cleaned++ }
    }
    if ($cleaned -gt 0) {
        Write-Info "Cleaned $cleaned stale files from root dir"
    }

    Write-Info "Extracting: $($zipFile.Name)..."

    # Use tar (built-in Windows 10+) instead of Expand-Archive
    # because AOSP zip files use Zip64 extensions unsupported by PowerShell 5.1
    $tarExe = "tar"
    try {
        & $tarExe -xf $zipFile.FullName -C $ImageDir 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "tar exit code $LASTEXITCODE" }
    } catch {
        Write-Warn "tar failed, trying Expand-Archive fallback..."
        Expand-Archive -Path $zipFile.FullName -DestinationPath $ImageDir -Force -ErrorAction Stop
    }

    Write-Ok "Extraction complete"
}

# == Locate image source dir ==

function Get-ImageSourceDir {
    $arm64Dir = Join-Path $ImageDir "arm64-v8a"
    if (Test-Path (Join-Path $arm64Dir "system.img")) { return $arm64Dir }
    if (Test-Path (Join-Path $ImageDir "system.img")) { return $ImageDir }

    $found = Get-ChildItem -Path $ImageDir -Recurse -Filter "system.img" -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.DirectoryName }
    return $null
}

# == Install system image to SDK ==

function Step-InstallSystemImage {
    $sysimgDir = Join-Path $AndroidSdk "system-images\android-12-clawos\default\arm64-v8a"

    $srcDir = Get-ImageSourceDir
    if (-not $srcDir) {
        Write-Err "Cannot find extracted image files (system.img)."
        exit 1
    }
    Write-Info "Image source dir: $srcDir"

    $kernelOk = Test-Path (Join-Path $sysimgDir "kernel-ranchu")
    $systemOk = Test-Path (Join-Path $sysimgDir "system.img")

    if ($kernelOk -and $systemOk -and -not $Clean) {
        Write-Ok "System image already installed: $sysimgDir"
        return
    }

    Write-Info "Installing system image to SDK..."

    if (Test-Path $sysimgDir) { Remove-Item $sysimgDir -Recurse -Force }
    New-Item -ItemType Directory -Path $sysimgDir -Force | Out-Null

    $filesCopied = 0
    Get-ChildItem -Path $srcDir | ForEach-Object {
        if ($_.PSIsContainer) {
            Copy-Item $_.FullName -Destination $sysimgDir -Recurse -Force
        } else {
            Copy-Item $_.FullName -Destination $sysimgDir -Force
        }
        $filesCopied++
    }

    # Verify critical files
    $missing = 0
    foreach ($req in @("kernel-ranchu", "system.img", "ramdisk.img")) {
        if (-not (Test-Path (Join-Path $sysimgDir $req))) {
            Write-Err "Missing critical file: $req"
            $missing++
        }
    }
    if ($missing -gt 0) {
        Write-Err "Installation incomplete, missing $missing critical files."
        exit 1
    }

    # Ensure source.properties
    $spFile = Join-Path $sysimgDir "source.properties"
    if (-not (Test-Path $spFile) -or (Get-Item $spFile).Length -eq 0) {
        $spContent = "Pkg.Desc=ClawOS AOSP ARM64 System Image`r`nPkg.Revision=1`r`nAndroidVersion.ApiLevel=31`r`nSystemImage.Abi=arm64-v8a`r`nSystemImage.TagId=default`r`nSystemImage.TagDisplay=Default"
        [System.IO.File]::WriteAllText($spFile, $spContent, [System.Text.Encoding]::UTF8)
        Write-Info "Generated source.properties (ARM64 metadata)"
    }

    Write-Ok "Installed $filesCopied files to: $sysimgDir"

    Write-Info "Key files:"
    foreach ($f in @("kernel-ranchu", "system.img", "vendor.img", "ramdisk.img", "userdata.img")) {
        $fp = Join-Path $sysimgDir $f
        if (Test-Path $fp) { Write-Host "  $f ($(Get-FileSizeMB $fp))" }
    }
}

# == Create AVD ==

function Step-CreateAvd {
    $avdDir = Join-Path $env:USERPROFILE ".android\avd\${AvdName}.avd"
    $avdIni = Join-Path $env:USERPROFILE ".android\avd\${AvdName}.ini"

    if ((Test-Path $avdDir) -and -not $Clean) {
        Write-Ok "AVD exists: $AvdName"
        return
    }

    if ($Clean -and (Test-Path $avdDir)) {
        Write-Info "Removing existing AVD: $AvdName"
        Remove-Item $avdDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $avdIni -Force -ErrorAction SilentlyContinue
    }

    Write-Info "Creating AVD: $AvdName ..."

    $sysimgDir = Join-Path $AndroidSdk "system-images\android-12-clawos\default\arm64-v8a"

    # Ensure .android/avd directory exists
    $avdParent = Join-Path $env:USERPROFILE ".android\avd"
    if (-not (Test-Path $avdParent)) {
        New-Item -ItemType Directory -Path $avdParent -Force | Out-Null
    }

    New-Item -ItemType Directory -Path $avdDir -Force | Out-Null

    # AVD .ini
    $iniContent = "avd.ini.encoding=UTF-8`r`npath=$avdDir`r`npath.rel=avd\${AvdName}.avd`r`ntarget=android-31"
    [System.IO.File]::WriteAllText($avdIni, $iniContent, [System.Text.Encoding]::UTF8)

    # AVD config.ini
    $configContent = @(
        "AvdId=${AvdName}"
        "PlayStore.enabled=false"
        "abi.type=arm64-v8a"
        "avd.ini.displayname=ClawOS ARM64"
        "avd.ini.encoding=UTF-8"
        "disk.dataPartition.size=2G"
        "fastboot.chosenSnapshotFile="
        "fastboot.forceChosenSnapshotBoot=no"
        "fastboot.forceColdBoot=yes"
        "fastboot.forceFastBoot=no"
        "hw.accelerometer=yes"
        "hw.arc=false"
        "hw.audioInput=yes"
        "hw.battery=yes"
        "hw.camera.back=none"
        "hw.camera.front=none"
        "hw.cpu.arch=arm64"
        "hw.cpu.ncore=4"
        "hw.dPad=no"
        "hw.device.hash2=MD5:6b5943207fe196d842659d2e43022e20"
        "hw.device.manufacturer=Google"
        "hw.device.name=pixel_4"
        "hw.gps=yes"
        "hw.gpu.enabled=yes"
        "hw.gpu.mode=auto"
        "hw.initialOrientation=Portrait"
        "hw.keyboard=yes"
        "hw.lcd.density=440"
        "hw.lcd.height=2280"
        "hw.lcd.width=1080"
        "hw.mainKeys=no"
        "hw.ramSize=4096"
        "hw.sdCard=yes"
        "hw.sensors.orientation=yes"
        "hw.sensors.proximity=yes"
        "hw.trackBall=no"
        "image.sysdir.1=${sysimgDir}\"
        "runtime.network.latency=none"
        "runtime.network.speed=full"
        "tag.display=Default"
        "tag.id=default"
        "vm.heapSize=256"
    ) -join "`r`n"

    $configPath = Join-Path $avdDir "config.ini"
    [System.IO.File]::WriteAllText($configPath, $configContent, [System.Text.Encoding]::UTF8)

    Write-Ok "AVD created: $AvdName"
}

# == Launch emulator ==

function Step-LaunchEmulator {
    if ($Setup) {
        Write-Info "Setup-only mode (-Setup), skipping launch"
        return
    }

    Write-Info "Launching Android Emulator..."
    Write-Info "AVD: $AvdName"
    Write-Host ""

    $env:ANDROID_SDK_ROOT = $AndroidSdk
    $env:ANDROID_HOME = $AndroidSdk

    $emuArgs = "-avd $AvdName -no-snapshot -gpu auto -no-boot-anim -selinux permissive -allow-host-audio -verbose"

    $emuProcess = Start-Process -FilePath $Emulator -ArgumentList $emuArgs -PassThru -WindowStyle Normal
    Write-Info "Emulator PID: $($emuProcess.Id)"
    Write-Info "Waiting for emulator to start..."

    $adbExe = if (Test-Path $Adb) { $Adb } else { "adb" }
    $timeout = 120
    $elapsed = 0

    while ($elapsed -lt $timeout) {
        $oldPref = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        $devices = & $adbExe devices 2>&1 | Out-String
        $ErrorActionPreference = $oldPref
        if ($devices -match "emulator.*device\b") {
            Write-Ok "Emulator started and connected"
            Write-Host ""
            $ErrorActionPreference = "SilentlyContinue"
            & $adbExe devices 2>&1
            $ErrorActionPreference = $oldPref
            Write-Host ""
            Write-Warn "Enable microphone: Extended Controls > Microphone > Virtual microphone uses host audio input"
            return
        }
        Start-Sleep -Seconds 5
        $elapsed += 5
        Write-Info "Waiting... (${elapsed}s / ${timeout}s)"
    }

    Write-Warn "Emulator start timed out (${timeout}s). May still be loading."
}

# == Print summary ==

function Step-PrintSummary {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  ClawOS Emulator Setup Complete" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  AVD Name:    $AvdName"
    Write-Host "  Image Dir:   $ImageDir"
    Write-Host "  API Level:   31 (Android 12)"
    Write-Host "  ABI:         arm64-v8a"
    Write-Host ""

    if ($Setup) {
        Write-Host "Launch emulator:" -ForegroundColor Yellow
        Write-Host "  .\aosp\run-emulator-win.ps1"
        Write-Host ""
        Write-Host "  Or manually:"
        Write-Host "  & `"$Emulator`" -avd $AvdName -no-snapshot -gpu auto"
    } else {
        Write-Host "Useful commands:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  # Re-launch emulator"
        Write-Host "  & `"$Emulator`" -avd $AvdName -no-snapshot -gpu auto"
        Write-Host ""
        Write-Host "  # List devices"
        Write-Host "  adb devices"
        Write-Host ""
        Write-Host "  # Shell"
        Write-Host "  adb shell"
    }
    Write-Host ""
    Write-Host "Microphone (voice input):" -ForegroundColor Yellow
    Write-Host "  1. Emulator toolbar > ... (Extended Controls)"
    Write-Host "  2. Microphone tab"
    Write-Host "  3. Check: Virtual microphone uses host audio input"
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
}

# == Main ==

Write-Host ""
Write-Host "ClawOS AOSP - Windows Emulator" -ForegroundColor Cyan
Write-Host ""

if ($Pull) {
    Step-PullImages
    Write-Host ""
}

Step-Preflight
Step-ExtractImages
Step-InstallSystemImage
Step-CreateAvd
Step-LaunchEmulator
Step-PrintSummary
