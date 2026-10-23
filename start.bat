@echo off
rem Double-click to start Timbre on Windows.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
pause
