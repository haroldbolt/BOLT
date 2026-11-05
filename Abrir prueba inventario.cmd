@echo off
setlocal
cd /d "%~dp0"
set "BOLT_TEST_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%BOLT_TEST_NODE%" goto run
set "BOLT_TEST_NODE=node"
:run
"%BOLT_TEST_NODE%" scripts\start-inventory-test.mjs --open
if errorlevel 1 pause
