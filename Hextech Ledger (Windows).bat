@echo off
rem Double-click to run Hextech Ledger locally on Windows.
rem Uses the bundled node\node.exe in the portable package, otherwise an
rem installed Node.js. Closing this window stops the app.

cd /d "%~dp0"

set NODE=node
if exist "node\node.exe" set NODE=node\node.exe

if "%NODE%"=="node" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found. Install it from https://nodejs.org and run this again.
    pause
    exit /b 1
  )
)

start "" http://localhost:8080
"%NODE%" tools\serve.js 8080

pause
