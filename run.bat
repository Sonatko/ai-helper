@echo off
setlocal
title AI Helper

echo ===================================================
echo           Starting AI Helper (Native Windows)
echo ===================================================
echo.

:: Check Node.js
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js / npm is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: Check Rust / Cargo
where cargo >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Rust / Cargo is not installed or not in PATH.
    echo Please install Rust from https://rustup.rs/
    pause
    exit /b 1
)

:: Install root dependencies if missing
if not exist "node_modules\" (
    echo [INFO] Installing root dependencies...
    call npm install
)

:: Install frontend dependencies if missing
if not exist "frontend\node_modules\" (
    echo [INFO] Installing frontend dependencies...
    call npm install --prefix frontend
)

echo [INFO] Launching assistant with Tauri v2...
npm run tauri dev

pause
