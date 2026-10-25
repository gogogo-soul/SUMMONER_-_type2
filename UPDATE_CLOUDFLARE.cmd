@echo off
setlocal
cd /d "%~dp0"
title SUMMONER v39 Cloudflare Server Update (verified)
echo ==========================================================
echo SUMMONER v39 - FIXED Recovery and Verified Cloudflare Update
echo ==========================================================
echo.
where node >nul 2>&1
if errorlevel 1 goto no_node
if not exist "%~dp0cards.js" goto missing
if not exist "%~dp0starter-decks.js" goto missing
node configure-worker.mjs
if errorlevel 1 goto failed
cd /d "%~dp0online-server"
echo.
echo [1/5] Installing required tools...
call npm.cmd install --no-audit --no-fund
if errorlevel 1 goto failed
echo.
echo [2/5] Cloudflare login (use your ORIGINAL account)...
call npx.cmd wrangler login
if errorlevel 1 goto failed
call npx.cmd wrangler whoami
if errorlevel 1 goto failed
echo.
echo [3/5] Testing the online server code...
call npm.cmd test
if errorlevel 1 goto failed
echo.
echo [4/5] Deploying v39 to Cloudflare...
call npx.cmd wrangler deploy
if errorlevel 1 goto failed
echo.
echo [5/5] Checking the LIVE version at your original Worker URL...
cd /d "%~dp0"
node verify-deployment.mjs
if errorlevel 1 goto mismatch
echo.
echo SUCCESS: Server update and remote version verification complete.
echo You do not need to re-upload the same v39 GitHub files.
goto finished
:missing
echo ERROR: The recovery ZIP was not completely extracted.
echo cards.js and starter-decks.js must be next to this CMD file.
goto finished
:no_node
echo ERROR: Node.js not found. Install Node.js first.
goto finished
:failed
echo.
echo ERROR: An earlier step FAILED, so the server may still be v37.
echo Read the error shown above; do not treat this as a completed update.
goto finished
:mismatch
echo.
echo ERROR: Worker was deployed but the ORIGINAL URL is NOT running v39.
echo Compare URLs and Cloudflare accounts shown above.
goto finished
:finished
echo.
pause
