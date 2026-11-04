@echo off
cd /d "%~dp0"
echo Iniciando acceso personal por internet. La PC debe permanecer encendida.
echo Esta conexion temporal cambia de direccion si se reinicia.
"%~dp0herramientas\python\python.exe" -I "%~dp0.automation\pagina_web\publicar_acceso.py" --publicar-github %*
pause
