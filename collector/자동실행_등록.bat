@echo off
chcp 65001 >nul
title 컴학내전 수집기 - 자동 실행 등록

where python >nul 2>nul
if errorlevel 1 goto nopython

python "%~dp0naejeon-collector.py" --install-autostart
echo.
echo  등록 완료. 다음 Windows 로그인부터 수집기가 백그라운드에서 자동으로 켜집니다.
echo  지금 바로 시작하려면 "내전수집기.bat" 을 실행하세요.
echo  (이 폴더를 옮기거나 지우면 다시 등록해야 합니다)
echo.
pause
exit /b

:nopython
echo.
echo  Python이 설치되어 있지 않습니다. https://python.org/downloads 에서 설치하세요.
echo  설치 시 "Add Python to PATH" 반드시 체크!
echo.
pause
