@echo off
setlocal
cd /d "%~dp0"
set "BOLT_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%BOLT_NODE%" goto run
set "BOLT_NODE=node"
:run
"%BOLT_NODE%" scripts\start-local.mjs --open
if errorlevel 1 pause
