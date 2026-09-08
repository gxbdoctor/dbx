@echo off
setlocal
echo Remove DBX Virtual Folders SOURCE add-on. Saved folder data is retained.
set "DBX_ADDON_TARGET=%~1"
if not defined DBX_ADDON_TARGET set /p "DBX_ADDON_TARGET=DBX source directory: "
node "%~dp0install.mjs" remove --target "%DBX_ADDON_TARGET%"
set "DBX_ADDON_RESULT=%ERRORLEVEL%"
pause
exit /b %DBX_ADDON_RESULT%
