#requires -Version 5.1
<#
  Sirenity launcher (Windows).

  First run creates .venv, installs the web server, and offers to install the
  XTTS voice engine. Later runs start the server immediately.

  Examples:
    .\run.ps1                 # normal start
    .\run.ps1 -Cuda           # install CUDA torch on first setup
    .\run.ps1 -Mock           # placeholder engine, no torch download
    .\run.ps1 -Port 8010      # use another port
    .\run.ps1 -Reinstall      # rebuild the virtual environment
    .\run.ps1 -AcceptLicense  # accept the CPML non-interactively
#>
param(
    [int]$Port = 8000,
    [switch]$Mock,
    [switch]$Cuda,
    [switch]$SkipEngine,
    [switch]$Reinstall,
    [switch]$NoBrowser,
    [switch]$AcceptLicense
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Find-Python {
    $launcher = Join-Path $env:LOCALAPPDATA "Programs\Python\Launcher\py.exe"
    if (Test-Path $launcher) {
        foreach ($version in @("3.12", "3.11", "3.10")) {
            $path = & $launcher "-$version" -c "import sys;print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $path) {
                return ($path | Select-Object -First 1).Trim()
            }
        }
    }
    foreach ($name in @("python", "python3")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) {
            $version = & $cmd.Source -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null
            if ($LASTEXITCODE -eq 0 -and "$version" -match '^3\.(10|11|12)$') {
                return $cmd.Source
            }
        }
    }
    return $null
}

$venv = Join-Path $Root ".venv"
$python = Join-Path $venv "Scripts\python.exe"

if ($Reinstall -and (Test-Path $venv)) {
    Write-Host "Removing the old virtual environment..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $venv
}

if (-not (Test-Path $python)) {
    $base = Find-Python
    if (-not $base) {
        Write-Host "Python 3.10-3.12 was not found." -ForegroundColor Red
        Write-Host "Install Python 3.12 from https://www.python.org/downloads/ and tick 'Add python.exe to PATH'."
        Write-Host "Then run this script again."
        exit 1
    }
    Write-Host "Creating a virtual environment with $base"
    & $base -m venv $venv
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Installing base dependencies..." -ForegroundColor Cyan
& $python -m pip install --upgrade pip --disable-pip-version-check --quiet
& $python -m pip install -r (Join-Path $Root "requirements.txt") --disable-pip-version-check
if ($LASTEXITCODE -ne 0) {
    Write-Host "Dependency install failed. See the error above." -ForegroundColor Red
    exit $LASTEXITCODE
}

$mock = $Mock.IsPresent -or ($env:SIRENITY_ENGINE -eq "mock")
if (-not $mock) {
    $hasEngine = (& $python -c "import importlib.util; print('1' if importlib.util.find_spec('TTS') else '0')").Trim()
    if ($hasEngine -ne "1") {
        if ($SkipEngine) {
            $mock = $true
        } else {
            Write-Host ""
            Write-Host "The XTTS v2 voice engine is not installed yet." -ForegroundColor Yellow
            Write-Host "It adds about 2.5 GB (PyTorch + coqui-tts). Real cloning needs it."
            $answer = Read-Host "Install the voice engine now? [Y/n]"
            if ($answer -match '^(n|no)$') {
                $mock = $true
            } else {
                if ($Cuda) {
                    Write-Host "Installing CUDA PyTorch..." -ForegroundColor Cyan
                    & $python -m pip install --upgrade torch torchaudio --index-url https://download.pytorch.org/whl/cu124
                    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
                }
                Write-Host "Installing coqui-tts and PyTorch..." -ForegroundColor Cyan
                & $python -m pip install -r (Join-Path $Root "requirements-engine.txt")
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "Engine install failed. Fix the error above, then run .\run.ps1 again." -ForegroundColor Red
                    exit $LASTEXITCODE
                }
            }
        }
    }
}

$licenseMarker = Join-Path $Root "data\.cpml-agreed"

if (-not $mock) {
    if ($env:COQUI_TOS_AGREED -eq "1" -or (Test-Path $licenseMarker)) {
        # Already accepted on an earlier run; keep Coqui's prompt quiet.
        $env:COQUI_TOS_AGREED = "1"
    } else {
        if ($AcceptLicense) {
            $accept = "y"
        } else {
            Write-Host ""
            Write-Host "XTTS v2 model licence (CPML)" -ForegroundColor Yellow
            Write-Host "The XTTS v2 model is licensed for non-commercial use only under Coqui's"
            Write-Host "Public Model License: https://coqui.ai/cpml"
            Write-Host "Generated audio needs a separate licence for commercial use."
            $accept = Read-Host "Do you accept the CPML for non-commercial use? [y/N]"
        }
        if ($accept -match '^(y|yes)$') {
            $env:COQUI_TOS_AGREED = "1"
            New-Item -ItemType Directory -Force -Path (Split-Path $licenseMarker) | Out-Null
            Set-Content -Path $licenseMarker -Encoding UTF8 `
                -Value "Accepted Coqui CPML on $(Get-Date -Format 'yyyy-MM-dd')"
            Write-Host "CPML accepted." -ForegroundColor Green
        } else {
            $mock = $true
            Write-Host "CPML not accepted. Starting with the mock engine instead." -ForegroundColor Yellow
        }
    }
}

if ($mock) {
    $env:SIRENITY_ENGINE = "mock"
    Write-Host "Mock engine enabled: the studio works, but speech is placeholder tones." -ForegroundColor Yellow
}

$url = "http://127.0.0.1:$Port"
if (-not $NoBrowser) {
    Start-Job -ScriptBlock {
        param($target)
        Start-Sleep -Seconds 2
        Start-Process $target
    } -ArgumentList $url | Out-Null
}

Write-Host ""
Write-Host "Sirenity is starting at $url" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server."
Write-Host ""

& $python -m uvicorn server.main:app --host 127.0.0.1 --port $Port
