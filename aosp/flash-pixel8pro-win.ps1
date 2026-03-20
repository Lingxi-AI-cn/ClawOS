#Requires -Version 5.1
<#
.SYNOPSIS
    在 Windows 上刷入 ClawOS 到 Pixel 8 Pro

.DESCRIPTION
    使用 fastboot 刷入自定义 AOSP GSI 镜像。
    每一步都会提示确认，确保安全。

    前置条件:
      1. Pixel 8 Pro 已解锁 bootloader
      2. 已安装 Android Platform Tools (adb/fastboot)
      3. 已拉取镜像到 $env:USERPROFILE\clawos-pixel8pro\

    刷写顺序 (Pixel 8 Pro 动态分区):
      bootloader 模式 → 刷 vbmeta_a/b
      fastbootd 模式  → 刷 system
      bootloader 模式 → wipe (可选) → reboot

.PARAMETER Wipe
    刷入后清除用户数据 (恢复出厂设置)

.PARAMETER Auto
    自动模式，跳过所有确认提示

.PARAMETER ImageDir
    镜像目录 (默认: $env:USERPROFILE\clawos-pixel8pro)

.EXAMPLE
    .\flash-pixel8pro-win.ps1
    .\flash-pixel8pro-win.ps1 -Wipe
    .\flash-pixel8pro-win.ps1 -Auto -Wipe
#>

[CmdletBinding()]
param(
    [switch]$Wipe,
    [switch]$Auto,
    [string]$ImageDir = (Join-Path $env:USERPROFILE "clawos-pixel8pro")
)

$ErrorActionPreference = "Stop"

$AndroidSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME }
              elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT }
              elseif (Test-Path "C:\Android\SDK") { "C:\Android\SDK" }
              else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }

$platformTools = Join-Path $AndroidSdk "platform-tools"
if (Test-Path $platformTools) {
    $env:PATH = "$platformTools;$env:PATH"
}

function Write-Info($msg)  { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[ERROR] $msg" -ForegroundColor Red }

function Confirm-Step {
    param([string]$Prompt, [string]$Default = "y")

    if ($Auto) { return $true }

    if ($Default -eq "y") {
        $choice = Read-Host "$Prompt [Y/n]"
        return ($choice -eq "" -or $choice -eq "y" -or $choice -eq "Y")
    } else {
        $choice = Read-Host "$Prompt [y/N]"
        return ($choice -eq "y" -or $choice -eq "Y")
    }
}

function Wait-ForFastbootDevice {
    param([int]$TimeoutSeconds = 30)

    $elapsed = 0
    while ($elapsed -lt $TimeoutSeconds) {
        $oldPref = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        $devices = & fastboot devices 2>&1 | Out-String
        $ErrorActionPreference = $oldPref
        if ($devices -match "fastboot") {
            return $true
        }
        Start-Sleep -Seconds 2
        $elapsed += 2
        Write-Info "Waiting... (${elapsed}s / ${TimeoutSeconds}s)"
    }
    return $false
}

function Get-FileSizeMB($filePath) {
    if (Test-Path $filePath) {
        $size = (Get-Item $filePath).Length / 1MB
        return "{0:N1} MB" -f $size
    }
    return "N/A"
}

# ── 前置检查 ──────────────────────────────────────────────────

function Step-Preflight {
    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  ClawOS Pixel 8 Pro - 刷机工具 (Windows)" -ForegroundColor Cyan
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""

    Write-Info "执行前置检查..."
    Write-Host ""

    # 检查 adb
    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
        Write-Err "adb not found. Install Android Platform Tools:"
        Write-Host "  https://developer.android.com/tools/releases/platform-tools"
        exit 1
    }
    $oldPref = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $adbVer = (& adb version 2>&1 | Out-String).Trim().Split("`n")[0]
    $ErrorActionPreference = $oldPref
    Write-Ok "adb: $adbVer"

    # 检查 fastboot
    if (-not (Get-Command fastboot -ErrorAction SilentlyContinue)) {
        Write-Err "fastboot not found. Install Android Platform Tools"
        exit 1
    }
    $ErrorActionPreference = "SilentlyContinue"
    $fbVer = (& fastboot --version 2>&1 | Out-String).Trim().Split("`n")[0]
    $ErrorActionPreference = $oldPref
    Write-Ok "fastboot: $fbVer"

    # 检查镜像目录
    if (-not (Test-Path $ImageDir)) {
        Write-Err "镜像目录不存在: $ImageDir"
        Write-Host "请先拉取镜像: .\aosp\pull-pixel8pro-images-win.ps1" -ForegroundColor Yellow
        exit 1
    }
    Write-Ok "镜像目录: $ImageDir"

    # 检查镜像文件
    $requiredFiles = @("system.img", "vbmeta.img")
    $missingFiles = @()

    foreach ($file in $requiredFiles) {
        $filePath = Join-Path $ImageDir $file
        if (-not (Test-Path $filePath)) {
            $missingFiles += $file
        }
    }

    if ($missingFiles.Count -gt 0) {
        Write-Err "缺少镜像文件: $($missingFiles -join ', ')"
        Write-Host "请先拉取镜像: .\aosp\pull-pixel8pro-images-win.ps1" -ForegroundColor Yellow
        exit 1
    }
    Write-Ok "镜像文件完整"

    # 显示镜像信息
    Write-Host ""
    Write-Info "镜像信息:"
    foreach ($file in $requiredFiles) {
        $filePath = Join-Path $ImageDir $file
        Write-Host "  ${file}: $(Get-FileSizeMB $filePath)"
    }

    Write-Host ""
    Write-Ok "前置检查完成"
}

# ── 检查设备连接 ───────────────────────────────────────────────

function Step-CheckDevice {
    Write-Host ""
    Write-Host "步骤 1: 检查设备连接" -ForegroundColor White
    Write-Host ""

    Write-Info "检查 ADB 设备..."

    $oldPref = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $adbOut = & adb devices 2>&1 | Out-String
    $ErrorActionPreference = $oldPref
    $devices = ($adbOut -split "`n") | Where-Object { $_ -match "\tdevice" }

    if (-not $devices) {
        Write-Warn "未检测到 ADB 设备"
        Write-Host ""
        Write-Host "请确保:"
        Write-Host "  1. Pixel 8 Pro 已通过 USB 连接到电脑"
        Write-Host "  2. 手机已开启 USB 调试"
        Write-Host "  3. 已授权此电脑的 USB 调试"
        Write-Host "  4. 已安装 Google USB Driver (设备管理器中无感叹号)"
        Write-Host ""

        if (-not (Confirm-Step "设备已连接并准备好?")) { exit 1 }

        $ErrorActionPreference = "SilentlyContinue"
        $adbOut = & adb devices 2>&1 | Out-String
        $ErrorActionPreference = $oldPref
        $devices = ($adbOut -split "`n") | Where-Object { $_ -match "\tdevice" }
        if (-not $devices) {
            Write-Err "仍未检测到设备。请检查连接和驱动。"
            exit 1
        }
    }

    Write-Ok "检测到设备:"
    $devices | ForEach-Object { Write-Host "  $($_.Trim())" }

    $ErrorActionPreference = "SilentlyContinue"
    $deviceModel = (& adb shell getprop ro.product.model 2>&1 | Out-String).Trim()
    $deviceAndroid = (& adb shell getprop ro.build.version.release 2>&1 | Out-String).Trim()
    $ErrorActionPreference = $oldPref

    Write-Host ""
    Write-Info "设备信息:"
    Write-Host "  型号: $deviceModel"
    Write-Host "  Android 版本: $deviceAndroid"

    if ($deviceModel -notmatch "Pixel 8 Pro") {
        Write-Warn "检测到的设备不是 Pixel 8 Pro: $deviceModel"
        if (-not (Confirm-Step "是否继续? (可能导致设备变砖)" "n")) { exit 1 }
    }

    Write-Host ""
    Write-Ok "设备检查完成"
}

# ── 重启到 bootloader ─────────────────────────────────────────

function Step-RebootToBootloader {
    Write-Host ""
    Write-Host "步骤 2: 重启到 Bootloader" -ForegroundColor White
    Write-Host ""

    if (-not (Confirm-Step "是否重启设备到 bootloader 模式?")) { exit 1 }

    Write-Info "重启到 bootloader..."
    & adb reboot bootloader

    Write-Info "等待设备进入 bootloader 模式..."
    Start-Sleep -Seconds 5

    if (-not (Wait-ForFastbootDevice -TimeoutSeconds 30)) {
        Write-Err "设备未进入 bootloader 模式 (超时 30s)"
        Write-Host "请手动进入:" -ForegroundColor Yellow
        Write-Host "  1. 关机"
        Write-Host "  2. 同时按住 音量下 + 电源键"
        Write-Host "  3. 看到 fastboot 界面后松开"
        exit 1
    }

    Write-Ok "设备已进入 bootloader 模式"
}

# ── 刷入 vbmeta ───────────────────────────────────────────────

function Step-FlashVbmeta {
    Write-Host ""
    Write-Host "步骤 3: 刷入 vbmeta (禁用验证)" -ForegroundColor White
    Write-Host ""

    Write-Warn "此步骤将禁用 Verified Boot (验证启动)"
    Write-Warn "这是刷入自定义系统镜像的必要步骤"
    Write-Host ""

    if (-not (Confirm-Step "是否刷入 vbmeta?")) { exit 1 }

    $vbmetaImg = Join-Path $ImageDir "vbmeta.img"

    Write-Info "刷入 vbmeta 到 slot A..."
    & fastboot flash vbmeta_a $vbmetaImg
    if ($LASTEXITCODE -ne 0) {
        Write-Err "vbmeta_a 刷入失败"
        exit 1
    }
    Write-Ok "vbmeta_a 刷入完成"

    Write-Host ""
    Write-Info "刷入 vbmeta 到 slot B..."
    & fastboot flash vbmeta_b $vbmetaImg
    if ($LASTEXITCODE -ne 0) {
        Write-Err "vbmeta_b 刷入失败"
        exit 1
    }
    Write-Ok "vbmeta_b 刷入完成"

    Write-Host ""
    Write-Ok "vbmeta 刷入完成"
}

# ── 切换到 fastbootd ──────────────────────────────────────────

function Step-RebootToFastbootd {
    Write-Host ""
    Write-Host "步骤 4: 切换到 Fastbootd 模式" -ForegroundColor White
    Write-Host ""

    Write-Info "Pixel 8 Pro 使用动态分区，必须在 fastbootd 模式下刷入 system"
    Write-Host ""

    if (-not (Confirm-Step "是否切换到 fastbootd 模式?")) { exit 1 }

    Write-Info "重启到 fastbootd..."
    & fastboot reboot fastboot

    Write-Info "等待设备进入 fastbootd 模式..."
    Start-Sleep -Seconds 5

    if (-not (Wait-ForFastbootDevice -TimeoutSeconds 30)) {
        Write-Err "设备未进入 fastbootd 模式 (超时 30s)"
        exit 1
    }

    Write-Ok "设备已进入 fastbootd 模式"
}

# ── 刷入 system ───────────────────────────────────────────────

function Step-FlashSystem {
    Write-Host ""
    Write-Host "步骤 5: 刷入 System 镜像" -ForegroundColor White
    Write-Host ""

    $systemImg = Join-Path $ImageDir "system.img"
    $size = Get-FileSizeMB $systemImg

    Write-Warn "即将刷入 ClawOS 系统镜像 ($size)"
    Write-Warn "此操作将覆盖原有系统，无法撤销"
    Write-Host ""

    if (-not (Confirm-Step "是否刷入 system 镜像?")) { exit 1 }

    Write-Info "刷入 system 镜像 (这可能需要几分钟)..."
    Write-Host ""

    & fastboot flash system $systemImg

    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Err "system 镜像刷入失败。设备可能处于不可用状态。"
        exit 1
    }

    Write-Host ""
    Write-Ok "system 镜像刷入完成"
}

# ── 切回 bootloader ───────────────────────────────────────────

function Step-ReturnToBootloader {
    Write-Host ""
    Write-Host "步骤 6: 切回 Bootloader" -ForegroundColor White
    Write-Host ""

    Write-Info "从 fastbootd 切回 bootloader (wipe/reboot 需要在 bootloader 模式)..."
    & fastboot reboot bootloader

    Start-Sleep -Seconds 3

    if (-not (Wait-ForFastbootDevice -TimeoutSeconds 30)) {
        Write-Err "切回 bootloader 超时 (30s)"
        exit 1
    }

    Write-Ok "已切回 bootloader 模式"
}

# ── 清除用户数据 ──────────────────────────────────────────────

function Step-WipeUserdata {
    $doWipe = $Wipe

    if (-not $doWipe) {
        Write-Host ""
        $doWipe = Confirm-Step "是否清除用户数据? (恢复出厂设置，首次刷入建议选 y)"
    }

    if ($doWipe) {
        Write-Host ""
        Write-Host "步骤 7: 清除用户数据" -ForegroundColor White
        Write-Host ""

        Write-Warn "此操作将删除所有用户数据、应用和设置"
        Write-Warn "无法撤销!"
        Write-Host ""

        if (-not (Confirm-Step "确认清除用户数据?")) {
            Write-Info "跳过清除用户数据"
            return
        }

        Write-Info "清除用户数据..."
        & fastboot -w
        Write-Ok "用户数据已清除"
    } else {
        Write-Info "保留用户数据"
    }
}

# ── 重启设备 ──────────────────────────────────────────────────

function Step-RebootDevice {
    Write-Host ""
    Write-Host "步骤 8: 重启设备" -ForegroundColor White
    Write-Host ""

    if (-not (Confirm-Step "是否重启设备?")) {
        Write-Warn "设备仍在 bootloader 模式"
        Write-Warn "请手动重启: fastboot reboot"
        return
    }

    Write-Info "重启设备..."
    & fastboot reboot

    Write-Host ""
    Write-Ok "设备正在重启..."
    Write-Info "首次启动可能需要几分钟，请耐心等待"
}

# ── 打印总结 ──────────────────────────────────────────────────

function Step-PrintSummary {
    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  ClawOS 刷入完成" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "  设备: Pixel 8 Pro"
    Write-Host "  系统: ClawOS (AOSP 16 GSI)"
    $dataStatus = if ($Wipe) { "已清除" } else { "已保留" }
    Write-Host "  数据: $dataStatus"
    Write-Host ""
    Write-Host "首次启动注意事项:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. 首次启动需要 3-5 分钟，请耐心等待"
    Write-Host "  2. 启动后会自动进入 ClawOS Launcher"
    Write-Host "  3. Gateway 服务会自动启动 (约 10-20 秒)"
    Write-Host "  4. 检查 Gateway 状态:"
    Write-Host "     adb shell getprop clawos.gateway.status"
    Write-Host ""
    Write-Host "调试命令:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  adb logcat -s clawos_gateway    # Gateway 日志"
    Write-Host "  adb shell ps -A | grep node     # Gateway 进程"
    Write-Host "  adb shell                       # 进入 shell"
    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
}

# ── Main ─────────────────────────────────────────────────────

# 显示警告
Write-Host ""
Write-Host "  WARNING" -ForegroundColor Red
Write-Host ""
Write-Host "此操作将刷入自定义 AOSP 系统到 Pixel 8 Pro" -ForegroundColor Red
Write-Host "可能导致:" -ForegroundColor Red
Write-Host "  - 原有系统被覆盖" -ForegroundColor Red
Write-Host "  - 数据丢失 (如果选择清除数据)" -ForegroundColor Red
Write-Host "  - 保修失效" -ForegroundColor Red
Write-Host ""
Write-Host "请确保:" -ForegroundColor Yellow
Write-Host "  1. 已备份重要数据"
Write-Host "  2. Bootloader 已解锁"
Write-Host "  3. 电池电量充足 (>50%)"
Write-Host "  4. 使用原装或高质量 USB 线缆"
Write-Host "  5. 已安装 Google USB Driver"
Write-Host ""

if (-not (Confirm-Step "我已了解风险，继续刷机?")) {
    Write-Host "用户取消" -ForegroundColor Yellow
    exit 0
}

# 执行刷机流程:
#   1. 前置检查           — adb / fastboot / 镜像文件
#   2. 检查设备           — ADB 连接、型号确认
#   3. → bootloader       — adb reboot bootloader
#   4. 刷 vbmeta          — 禁用 Verified Boot (bootloader 模式)
#   5. → fastbootd        — fastboot reboot fastboot
#   6. 刷 system          — fastboot flash system (fastbootd 模式)
#   7. → bootloader       — fastboot reboot bootloader
#   8. wipe (可选)        — fastboot -w (bootloader 模式)
#   9. reboot             — fastboot reboot
Step-Preflight
Step-CheckDevice
Step-RebootToBootloader
Step-FlashVbmeta
Step-RebootToFastbootd
Step-FlashSystem
Step-ReturnToBootloader
Step-WipeUserdata
Step-RebootDevice
Step-PrintSummary
