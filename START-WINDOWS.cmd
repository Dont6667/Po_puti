@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 for /d %%N in ("%~dp0.tools\node-*-win-x64") do if exist "%%N\node.exe" (
  "%%N\node.exe" server.mjs
  pause
  exit /b
 )
 echo Install Node.js 24 LTS from https://nodejs.org/ and run this file again.
 pause
 exit /b 1
)
echo Website: http://127.0.0.1:3001/
echo Admin: http://127.0.0.1:3001/admin
node server.mjs
pause
