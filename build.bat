@echo off
setlocal
title AI Helper - Release Builder

echo ===================================================
echo         Building Standalone AI Helper
echo ===================================================
echo.

call npm run tauri build

if %ERRORLEVEL% equ 0 (
    echo.
    echo [SUCCESS] Release build finished successfully!
    echo Check compiled files in: src-tauri\target\release\
) else (
    echo.
    echo [ERROR] Build failed. Review error output above.
)

pause
