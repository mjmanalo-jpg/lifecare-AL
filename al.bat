@echo off
REM Assisted Living Portal - Windows CLI
REM Run from anywhere: al [command]

cd /d "%~dp0"
node cli.js %*
