@echo off
chcp 65001 >nul
title 컴학내전 수집기

where pythonw >nul 2>nul
if errorlevel 1 goto nopython

start "" pythonw "%~dp0naejeon-collector.py"
exit

:nopython
echo.
echo  ==========================================
echo   Python이 설치되어 있지 않습니다.
echo.
echo   https://python.org/downloads 에서 설치 후
echo   설치 시 "Add Python to PATH" 반드시 체크!
echo  ==========================================
echo.
pause
