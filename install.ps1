# ==============================================================================
# Ghostic CLI — One-Line Installer for Windows PowerShell
# Usage: irm https://raw.githubusercontent.com/GloryDev1999/Ghostic/master/install.ps1 | iex
# ==============================================================================

$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:GHOSTIC_REPO_URL) { $env:GHOSTIC_REPO_URL } else { "https://github.com/GloryDev1999/Ghostic.git" }
$Branch = if ($env:GHOSTIC_BRANCH) { $env:GHOSTIC_BRANCH } else { "master" }
$InstallDir = if ($env:GHOSTIC_HOME) { $env:GHOSTIC_HOME } else { "$env:USERPROFILE\.ghostic" }
$BinDir = "$InstallDir\bin"

function Print-Banner {
    Write-Host ""
    Write-Host "   .---." -ForegroundColor Magenta
    Write-Host "  /     \" -ForegroundColor Magenta
    Write-Host " | () () |     Ghostic CLI Installer" -ForegroundColor Magenta
    Write-Host "  \  _  /      Autonomous AI Engineering Harness" -ForegroundColor Magenta
    Write-Host "   || ||" -ForegroundColor Magenta
    Write-Host "   '' ''" -ForegroundColor Magenta
    Write-Host ""
}

function Log-Info ($msg) {
    Write-Host "[INFO] $msg" -ForegroundColor Cyan
}

function Log-Success ($msg) {
    Write-Host "[OK]   $msg" -ForegroundColor Green
}

function Log-Warn ($msg) {
    Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

function Log-Error ($msg) {
    Write-Host "[ERR]  $msg" -ForegroundColor Red
}

function Check-Node {
    Log-Info "Kiểm tra môi trường Node.js..."
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Log-Error "Node.js chưa được cài đặt trên máy tính của bạn."
        Write-Host "Vui lòng cài đặt Node.js (>= 22.19 hoặc 24): https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }

    $nodeVersion = (node -v).TrimStart('v')
    Log-Success "Node.js v$nodeVersion đã sẵn sàng."
}

function Check-Git {
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitCmd) {
        Log-Error "Git chưa được cài đặt. Vui lòng cài đặt Git: https://git-scm.com/"
        exit 1
    }
}

function Check-Pnpm {
    $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpmCmd) {
        Log-Info "Đang tự động cài đặt pnpm..."
        npm install -g pnpm
    }
    $pnpmVersion = (pnpm -v)
    Log-Success "pnpm v$pnpmVersion đã sẵn sàng."
}

function Install-Ghostic {
    if (Test-Path $InstallDir) {
        Log-Info "Thư mục $InstallDir đã tồn tại. Đang cập nhật phiên bản mới nhất..."
        Set-Location $InstallDir
        git fetch origin $Branch
        git checkout $Branch
        git pull origin $Branch
    } else {
        Log-Info "Đang tải Ghostic về $InstallDir..."
        git clone --depth 1 --branch $Branch $RepoUrl $InstallDir
        Set-Location $InstallDir
    }

    Log-Info "Đang cài đặt các module phụ thuộc..."
    pnpm install --no-frozen-lockfile

    Log-Info "Đang biên dịch và đóng gói Ghostic Engine..."
    pnpm run build

    # Create bin directory & CMD wrapper
    if (-not (Test-Path $BinDir)) {
        New-Item -ItemType Directory -Path $BinDir | Out-Null
    }

    $cmdWrapperContent = "@echo off`r`nnode `"%~dp0..\apps\cli\lib\bin.js`" %*"
    Set-Content -Path "$BinDir\ghostic.cmd" -Value $cmdWrapperContent -Encoding ASCII

    $psWrapperContent = "node `"`$PSScriptRoot\..\apps\cli\lib\bin.js`" `$args"
    Set-Content -Path "$BinDir\ghostic.ps1" -Value $psWrapperContent -Encoding UTF8

    Log-Success "Đã tạo file thực thi: $BinDir\ghostic.cmd"
}

function Setup-Path {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$BinDir*") {
        Log-Info "Đang thêm $BinDir vào biến môi trường PATH..."
        $newPath = "$userPath;$BinDir"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        $env:Path = "$env:Path;$BinDir"
        Log-Success "Đã cập nhật biến môi trường PATH thành công."
    }
}

function Main {
    Print-Banner
    Check-Git
    Check-Node
    Check-Pnpm
    Install-Ghostic
    Setup-Path

    Write-Host ""
    Write-Host "==============================================================" -ForegroundColor Green
    Write-Host "  Ghostic CLI đã được cài đặt thành công trên Windows!" -ForegroundColor Green
    Write-Host "==============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Để bắt đầu sử dụng, hãy mở lại PowerShell hoặc Windows Terminal và gõ:"
    Write-Host "  ghostic              # Mở giao diện chat tương tác (REPL)" -ForegroundColor Magenta
    Write-Host "  ghostic `"nhiệm vụ`"  # Chạy 1 tác vụ tự động" -ForegroundColor Magenta
    Write-Host "  ghostic web          # Mở giao diện Web UI" -ForegroundColor Magenta
    Write-Host ""
}

Main
