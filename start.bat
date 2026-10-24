@echo off
rem Double-click to start Sirenity on Windows.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
pause
