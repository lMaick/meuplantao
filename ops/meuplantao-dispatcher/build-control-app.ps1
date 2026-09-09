Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
$version = "1.0.0"
if ($env:CONTROL_VERSION) { $version = $env:CONTROL_VERSION }
python -m pip install -r requirements-control-build.txt
Remove-Item -Recurse -Force dist, build -ErrorAction SilentlyContinue
python -m PyInstaller --noconfirm --onefile --windowed --name MaickDispatcherControl --add-data "config.example.toml;." control_app.py
$exe = Join-Path $here "dist/MaickDispatcherControl.exe"
if (!(Test-Path $exe)) { throw "build failed: $exe not found" }
$stamped = Join-Path $here "dist/MaickDispatcherControl-$version.exe"
Copy-Item $exe $stamped -Force
Write-Host "Built $stamped"
