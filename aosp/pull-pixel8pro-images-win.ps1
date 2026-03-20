#Requires -Version 5.1
<#
.SYNOPSIS
    从 Linux 构建机拉取 Pixel 8 Pro 镜像到 Windows

.DESCRIPTION
    使用 SCP 下载 system.img 和 vbmeta.img (disabled-verity)。
    镜像存放在: $env:USERPROFILE\clawos-pixel8pro\

.PARAMETER Lan
    局域网模式 (使用主机名 legion:22)

.PARAMETER LinuxHost
    Linux 构建机地址 (默认: your-build-server)

.PARAMETER LinuxPort
    Linux SSH 端口 (默认: 125)

.PARAMETER LinuxUser
    Linux SSH 用户名 (默认: your-username)

.EXAMPLE
    .\pull-pixel8pro-images-win.ps1
    .\pull-pixel8pro-images-win.ps1 -Lan
#>

[CmdletBinding()]
param(
    [switch]$Lan,
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

$ImageDir = Join-Path $env:USERPROFILE "clawos-pixel8pro"
$LinuxAospOut = if ($env:LINUX_AOSP_OUT) { $env:LINUX_AOSP_OUT } else { "/opt/aosp/out/target/product/clawos_gsi_arm64" }

if ($Lan) {
    if ($env:LINUX_LAN_HOST) { $LinuxHost = $env:LINUX_LAN_HOST }
    $LinuxPort = if ($env:LINUX_LAN_PORT) { [int]$env:LINUX_LAN_PORT } else { 22 }
}

function Write-Info($msg)  { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[ERROR] $msg" -ForegroundColor Red }

function Test-SshConnection {
    Write-Info "测试 SSH 连接: ${LinuxUser}@${LinuxHost}:${LinuxPort}..."
    try {
        $result = ssh -p $LinuxPort -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "${LinuxUser}@${LinuxHost}" "echo ok" 2>&1
        if ($result -match "ok") {
            Write-Ok "SSH 连接成功"
            return $true
        }
    } catch {}
    Write-Err "无法连接到 Linux 构建机: ${LinuxUser}@${LinuxHost}:${LinuxPort}"
    Write-Host "检查:" -ForegroundColor Yellow
    Write-Host "  - SSH key 是否已配置 (ssh-keygen + ssh-copy-id)"
    Write-Host "  - 主机地址和端口是否正确"
    Write-Host "  - 网络是否可达"
    return $false
}

function Get-RemoteFileSize($remotePath) {
    $cmd = "du -sh " + $remotePath + " 2>/dev/null | cut -f1"
    $size = ssh -p $LinuxPort -o ConnectTimeout=10 "${LinuxUser}@${LinuxHost}" $cmd 2>&1
    return ($size | Out-String).Trim()
}

function Get-FileSizeMB($filePath) {
    if (Test-Path $filePath) {
        $size = (Get-Item $filePath).Length / 1MB
        return "{0:N1} MB" -f $size
    }
    return "N/A"
}

# ── Main ─────────────────────────────────────────────────────

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ClawOS Pixel 8 Pro - 镜像拉取 (Windows)" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# 1. 检查 ssh/scp
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Err "ssh 未找到。请确保 OpenSSH 已安装 (Windows 10+ 自带)。"
    Write-Host "  Settings → Apps → Optional Features → OpenSSH Client"
    exit 1
}
if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
    Write-Err "scp 未找到。请确保 OpenSSH 已安装。"
    exit 1
}
Write-Ok "SSH/SCP 工具已就绪"

# 2. 测试 SSH 连接
if (-not (Test-SshConnection)) { exit 1 }
Write-Host ""

# 3. 检查远程 system.img
Write-Info "检查远程镜像文件..."
$remoteCheck = ssh -p $LinuxPort -o ConnectTimeout=10 "${LinuxUser}@${LinuxHost}" "test -f ${LinuxAospOut}/system.img && echo EXISTS || echo MISSING" 2>&1
if ($remoteCheck -notmatch "EXISTS") {
    Write-Err "远程缺少 system.img"
    Write-Host ""
    Write-Host "请先在 Linux 上完成 AOSP 编译:" -ForegroundColor Yellow
    Write-Host "  cd /opt/aosp"
    Write-Host "  source build/envsetup.sh"
    Write-Host '  lunch clawos_gsi_arm64-trunk_staging-userdebug'
    Write-Host '  m -j$(nproc)'
    exit 1
}
Write-Ok "远程 system.img 存在"
Write-Host ""

# 4. 在服务器上生成 disabled-verity vbmeta
Write-Info "在服务器上生成 disabled-verity vbmeta..."
$remoteVbmeta = "/tmp/clawos-vbmeta-disabled.img"
$avbtoolCmd = 'AVBTOOL=$(find /opt/aosp/out/host -name avbtool -type f 2>/dev/null | head -1); if [ -z "$AVBTOOL" ]; then echo ERROR_AVBTOOL_NOT_FOUND >&2; exit 1; fi; $AVBTOOL make_vbmeta_image --flags 2 --padding_size 4096 --output ' + $remoteVbmeta

$oldPref = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
$genResult = ssh -p $LinuxPort -o ConnectTimeout=10 "${LinuxUser}@${LinuxHost}" $avbtoolCmd 2>&1
$genExitCode = $LASTEXITCODE
$ErrorActionPreference = $oldPref

if ($genExitCode -ne 0) {
    Write-Err "生成 disabled-verity vbmeta 失败。"
    Write-Host "请确保已在 Linux 上完成过 AOSP 编译 (avbtool 是编译产物)" -ForegroundColor Yellow
    exit 1
}
Write-Ok "disabled-verity vbmeta 已生成"
Write-Host ""

# 5. 显示远程文件大小
Write-Info "远程镜像信息:"
$systemSize = Get-RemoteFileSize "${LinuxAospOut}/system.img"
Write-Host "  system.img: $systemSize"
Write-Host "  vbmeta.img: ~4K (disabled-verity)"
Write-Host ""

# 6. 创建本地目录
if (-not (Test-Path $ImageDir)) {
    New-Item -ItemType Directory -Path $ImageDir -Force | Out-Null
}

# 7. 拉取 system.img
$localSystem = Join-Path $ImageDir "system.img"
Write-Info "拉取: system.img ($systemSize)..."
Write-Host "  目标: $localSystem"
Write-Host ""

scp -P $LinuxPort -o ConnectTimeout=10 "${LinuxUser}@${LinuxHost}:${LinuxAospOut}/system.img" $localSystem
if ($LASTEXITCODE -ne 0) {
    Write-Err "system.img 拉取失败"
    exit 1
}
Write-Ok "system.img 拉取完成 ($(Get-FileSizeMB $localSystem))"
Write-Host ""

# 8. 拉取 vbmeta.img (disabled-verity)
$localVbmeta = Join-Path $ImageDir "vbmeta.img"
Write-Info "拉取: vbmeta.img (disabled-verity)..."

scp -P $LinuxPort -o ConnectTimeout=10 "${LinuxUser}@${LinuxHost}:${remoteVbmeta}" $localVbmeta
if ($LASTEXITCODE -ne 0) {
    Write-Err "vbmeta.img 拉取失败"
    exit 1
}
Write-Ok "vbmeta.img 拉取完成 ($(Get-FileSizeMB $localVbmeta))"
Write-Host ""

# 9. 验证 system.img 传输完整性
Write-Info "验证 system.img 传输完整性..."
$shaCmd = "sha256sum " + $LinuxAospOut + "/system.img 2>/dev/null | cut -d' ' -f1"
$remoteSha = ssh -p $LinuxPort -o ConnectTimeout=10 "${LinuxUser}@${LinuxHost}" $shaCmd 2>&1
$remoteSha = ($remoteSha | Out-String).Trim()
$localSha = (Get-FileHash -Path $localSystem -Algorithm SHA256).Hash.ToLower()

if ($remoteSha -eq $localSha) {
    Write-Ok "system.img: SHA256 校验通过"
} else {
    Write-Warn "system.img: SHA256 不匹配!"
    Write-Warn "  远程: $remoteSha"
    Write-Warn "  本地: $localSha"
    Write-Warn "建议重新拉取"
}
Write-Host ""

# 10. 验证 vbmeta 大小
Write-Info "验证 vbmeta.img..."
$vbmetaSize = (Get-Item $localVbmeta).Length
if ($vbmetaSize -lt 8192) {
    Write-Ok "vbmeta.img: 大小 $vbmetaSize 字节 (disabled-verity 格式正确)"
} else {
    Write-Warn "vbmeta.img 大小 $vbmetaSize 字节 — 可能不是 disabled-verity 版本!"
}
Write-Host ""

# 11. 显示本地镜像信息
Write-Info "本地镜像信息:"
Write-Host "  目录: $ImageDir"
Write-Host "  system.img: $(Get-FileSizeMB $localSystem)"
Write-Host "  vbmeta.img: $(Get-FileSizeMB $localVbmeta) (disabled-verity, Flags:2)"
Write-Host ""

# 12. 总结
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  镜像拉取完成" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  镜像目录: $ImageDir"
Write-Host ""
Write-Host "下一步:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  刷入 Pixel 8 Pro:"
Write-Host "  .\aosp\flash-pixel8pro-win.ps1"
Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
