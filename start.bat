@echo off
title YieldFlow Dashboard
color 0A
echo.
echo  ============================================
echo   YieldFlow ^| Stablecoin Yield Optimizer
echo  ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install from https://nodejs.org
  pause
  exit /b 1
)

set ROOT=%~dp0
set DEMO_MODE=true
set DASHBOARD_PORT=8080

:: Install deps if node_modules missing
echo [1/3] Checking dependencies...
if not exist "%ROOT%rebalancer\node_modules" (
  echo      Installing rebalancer deps...
  cd /d "%ROOT%rebalancer" && npm install --silent
)
if not exist "%ROOT%seller-service\node_modules" (
  echo      Installing seller-service deps...
  cd /d "%ROOT%seller-service" && npm install --silent
)
if not exist "%ROOT%dashboard\node_modules" (
  echo      Installing dashboard deps...
  cd /d "%ROOT%dashboard" && npm install --silent
)
echo      Done.
echo.

echo [2/3] Starting server (Demo Mode, port %DASHBOARD_PORT%)...
echo.
cd /d "%ROOT%dashboard"

:: Open browser after 2 seconds
start "" cmd /c "timeout /t 2 >nul && start http://localhost:%DASHBOARD_PORT%"

echo [3/3] Dashboard running at http://localhost:%DASHBOARD_PORT%
echo.
echo  Press Ctrl+C to stop.
echo  ============================================
echo.

node server.js
