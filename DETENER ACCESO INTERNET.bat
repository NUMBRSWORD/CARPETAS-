@echo off
cd /d "%~dp0"
if not exist ".automation\acceso_internet" mkdir ".automation\acceso_internet"
type nul > ".automation\acceso_internet\DETENER"
echo Se solicito cerrar el acceso de internet. La base local sigue funcionando.
pause
