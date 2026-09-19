@echo off
setlocal
if "%OPENCODE_API_KEY%"=="" for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v OPENCODE_API_KEY 2^>nul') do set "OPENCODE_API_KEY=%%b"
set "MEUPLANTAO_DISPATCHER_HOME=C:\Users\Maick\AppData\Local\hermes\automation\meuplantao-dispatcher"
start "" "%~dp0ops\meuplantao-dispatcher\dist\MaickDispatcherControl.exe"
