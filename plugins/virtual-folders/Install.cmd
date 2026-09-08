@echo off
setlocal
echo DBX Virtual Folders SOURCE add-on
echo Choose a DBX source checkout. This cannot patch an installed DBX.exe.
where node >nul 2>nul || (echo Node.js 22 or later is required. & pause & exit /b 1)
where git >nul 2>nul || (echo Git is required. & pause & exit /b 1)
set "DBX_ADDON_TARGET=%~1"
if not defined DBX_ADDON_TARGET set /p "DBX_ADDON_TARGET=DBX source directory: "
node "%~dp0install.mjs" apply --target "%DBX_ADDON_TARGET%"
set "DBX_ADDON_RESULT=%ERRORLEVEL%"
pause
exit /b %DBX_ADDON_RESULT%
