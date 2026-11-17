@echo off
chcp 65001 >nul
title 컴학내전 수집기
setlocal

rem ── 1. Python 찾기 (Microsoft Store 가짜 바로가기 WindowsApps 는 제외) ──
call :findpython
if defined PYW goto run

rem ── 2. 없으면 자동 설치 (Windows 기본 설치 도구 winget, 관리자 권한 불필요) ──
echo.
echo  Python 이 없어서 자동으로 설치합니다. 1~2분 정도 걸립니다...
echo.
where winget >nul 2>nul
if errorlevel 1 goto manual
winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
call :findpython
if defined PYW goto run
goto manual

rem ── 3. 수집기 실행 (창 없이) — 이후 자동 실행 등록·수집 시작·과거 내전 동기화는 수집기가 알아서 함 ──
:run
start "" "%PYW%" "%~dp0naejeon-collector.py"
exit /b 0

:findpython
set "PYW="
for /f "delims=" %%i in ('where pythonw 2^>nul ^| findstr /v /i "WindowsApps"') do if not defined PYW set "PYW=%%i"
if not defined PYW for /f "delims=" %%i in ('where pyw 2^>nul ^| findstr /v /i "WindowsApps"') do if not defined PYW set "PYW=%%i"
for %%v in (313 312 311 310) do if not defined PYW if exist "%LOCALAPPDATA%\Programs\Python\Python%%v\pythonw.exe" set "PYW=%LOCALAPPDATA%\Programs\Python\Python%%v\pythonw.exe"
for %%v in (313 312 311 310) do if not defined PYW if exist "%ProgramFiles%\Python%%v\pythonw.exe" set "PYW=%ProgramFiles%\Python%%v\pythonw.exe"
exit /b 0

:manual
echo.
echo  ==========================================================
echo   Python 자동 설치에 실패했습니다.
echo   잠시 후 열리는 python.org 에서 설치해 주세요.
echo   설치 화면에서 "Add python.exe to PATH" 를 반드시 체크!
echo   설치가 끝나면 이 파일을 다시 더블클릭하면 됩니다.
echo  ==========================================================
echo.
start "" "https://www.python.org/downloads/windows/"
pause
exit /b 1
