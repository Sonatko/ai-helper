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
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    goto no_dev_tools
)

where cargo >nul 2>&1
if %ERRORLEVEL% neq 0 (
    goto no_dev_tools
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
exit /b 0

:no_dev_tools
echo ========================================================
echo   [!] ВНИМАНИЕ: Вы скачали архив с исходным кодом!
echo   [!] ATTENTION: You downloaded the source code ZIP!
echo ========================================================
echo.
echo Для запуска из исходников требуются Node.js и Rust.
echo Если вы хотите просто ПОЛЬЗОВАТЬСЯ AI Helper:
echo ВАМ НЕ НУЖНО ничего собирать!
echo.
echo Скачайте готовый установщик Windows:
echo https://github.com/Sonatko/ai-helper/releases/latest
echo.
echo Открываем страницу загрузки в вашем браузере...
start https://github.com/Sonatko/ai-helper/releases/latest
echo.
pause
exit /b 1
