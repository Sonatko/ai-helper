@echo off
setlocal
title AI Helper - Release Builder

echo ===================================================
echo         Building Standalone AI Helper Release
echo ===================================================
echo.

call npm run tauri build

if %ERRORLEVEL% equ 0 (
    if exist "src-tauri\target\release\ai-helper.exe" (
        copy /y "src-tauri\target\release\ai-helper.exe" "ai-helper.exe" >nul
    )
    echo.
    echo ===================================================
    echo [SUCCESS] Release build finished successfully!
    echo ===================================================
    echo 1. Standalone Portable EXE: ai-helper.exe (in root folder)
    echo 2. Windows NSIS Installer:  src-tauri\target\release\bundle\nsis\
    echo.
) else (
    echo.
    echo [ERROR] Build failed. Review error output above.
)

pause

