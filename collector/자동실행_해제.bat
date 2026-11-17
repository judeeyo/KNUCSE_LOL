@echo off
chcp 65001 >nul
title 컴학내전 수집기 - 자동 실행 해제

python "%~dp0naejeon-collector.py" --uninstall-autostart
echo.
pause
