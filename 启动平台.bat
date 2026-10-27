@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 or newer.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
  echo Node.js 24 or newer is required.
  pause
  exit /b 1
)
if not defined PORT set "PORT=3000"
if not defined PLATFORM_ADMIN_PASSWORD echo Set PLATFORM_ADMIN_PASSWORD to enable platform administrator login.
echo Open http://localhost:%PORT%/ after the server starts.
node server.js
pause
