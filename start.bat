@echo off
title CodeInspector

echo.
echo   CodeInspector - Starting...
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

cd /d "%~dp0"

if not exist "node_modules" (
    echo   Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo   [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

echo.
echo   Opening browser in 3 seconds...
ping -n 4 127.0.0.1 >nul
start "" "http://localhost:3031"

echo.
echo   Starting server on port 3031...
echo   Close this window to stop the server.
echo.

node server/server.js
pause
