@echo off
setlocal

cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo Bun is required to run Quant-em.
  echo Install it from https://bun.sh/ and run this script again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  bun install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

bun run start
pause
