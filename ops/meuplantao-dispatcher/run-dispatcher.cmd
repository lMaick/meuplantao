@echo off
setlocal
set "DISPATCHER_DIR=%~dp0"
if "%MEUPLANTAO_DISPATCHER_PYTHON%"=="" set "MEUPLANTAO_DISPATCHER_PYTHON=python"
"%MEUPLANTAO_DISPATCHER_PYTHON%" "%DISPATCHER_DIR%dispatcher.py" %*
exit /b %errorlevel%
