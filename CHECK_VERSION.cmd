@echo off
setlocal
cd /d "%~dp0"
node verify-deployment.mjs
echo.
pause
