@echo off
rem CodeCraft video worker - double-click to start. Keep this window open while you want videos edited.
cd /d "%~dp0"
title CodeCraft video worker
node index.js
echo.
echo The video worker stopped. Press any key to close.
pause >nul
