@echo off
cd /d "%~dp0"
echo Antes de reiniciar, espera a que tus cambios esten guardados.
echo Si Windows deniega el acceso, usa clic derecho y Ejecutar como administrador.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0.automation\pagina_web\reiniciar.ps1"
pause
