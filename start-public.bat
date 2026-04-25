@echo off
title YieldFlow - Public Demo
color 0B
echo.
echo  =============================================
echo   YieldFlow ^| Public Demo via Tunnel
echo  =============================================
echo.

set ROOT=%~dp0
set DEMO_MODE=true
set DASHBOARD_PORT=8080

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install from https://nodejs.org
  pause & exit /b 1
)

:: Install deps if missing
if not exist "%ROOT%dashboard\node_modules" (
  echo [INFO] First run - installing dependencies...
  cd /d "%ROOT%rebalancer" && npm install --silent
  cd /d "%ROOT%seller-service" && npm install --silent
  cd /d "%ROOT%dashboard" && npm install --silent
  echo.
)

:: Kill any existing server
taskkill /F /IM node.exe >nul 2>&1

:: Start server in background
echo [1/2] Starting YieldFlow server on port %DASHBOARD_PORT%...
cd /d "%ROOT%dashboard"
start /B cmd /c "set DEMO_MODE=true && node server.js > "%ROOT%server.log" 2>&1"
timeout /t 2 >nul

echo [2/2] Creating public tunnel...
echo.

:: Try ngrok first (if installed), else use localtunnel (no install needed)
where ngrok >nul 2>&1
if not errorlevel 1 (
  echo Using ngrok - your public URL:
  echo.
  ngrok http %DASHBOARD_PORT%
) else (
  echo Using localtunnel - your public URL will appear below:
  echo ^(share this URL with anyone to view the demo^)
  echo.
  npx --yes localtunnel --port %DASHBOARD_PORT%
)

:: If tunnel exits, kill server too
taskkill /F /IM node.exe >nul 2>&1
