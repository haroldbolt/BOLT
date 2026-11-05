@echo off
setlocal
title Bolt Pets - Copia de seguridad privada
cd /d "%~dp0"
set "BOLT_TASK_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%BOLT_TASK_NODE%" set "BOLT_TASK_NODE=node"
"%BOLT_TASK_NODE%" scripts\admin-account.mjs backup
echo.
pause
endlocal
