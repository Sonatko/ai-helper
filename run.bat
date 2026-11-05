@echo off
setlocal
title AI Helper

echo ===================================================
echo             AI Helper (Native Windows)
echo ===================================================
echo.

if exist "ai-helper.exe" goto launch_root
if exist "src-tauri\target\release\ai-helper.exe" goto launch_target
goto fallback_dev

:launch_root
echo [INFO] Starting standalone release AI Helper...
start "" "ai-helper.exe"
echo [SUCCESS] Assistant is active in system tray.
echo Hotkeys: F7 (Summon) / Alt+F7 (Snip Region).
exit /b 0

:launch_target
echo [INFO] Starting release AI Helper from target\release...
start "" "src-tauri\target\release\ai-helper.exe"
echo [SUCCESS] Assistant is active in system tray.
echo Hotkeys: F7 (Summon) / Alt+F7 (Snip Region).
exit /b 0

:fallback_dev
echo [INFO] Standalone binary not found. Starting in Dev mode...

where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js / npm is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/ or run build.bat
    pause
    exit /b 1
)

where cargo >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Rust / Cargo is not installed or not in PATH.
    echo Please install Rust from https://rustup.rs/
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [INFO] Installing root dependencies...
    call npm install
)

if not exist "frontend\node_modules\" (
    echo [INFO] Installing frontend dependencies...
    call npm install --prefix frontend
)

echo [INFO] Launching assistant with Tauri v2 dev-server...
call npm run tauri dev
pause

