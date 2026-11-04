@echo off
cd /d "%~dp0"
if exist "~$*.xlsx" (
  echo.
  echo CIERRA EL EXCEL y vuelve a ejecutar este archivo. No se cambio nada.
  echo.
  pause
  exit /b 4
)
echo Actualizando la pagina...
herramientas\python\python.exe -I .automation\pagina_web\construir.py > "%TEMP%\regenerar_carpetas.log" 2>&1
if errorlevel 1 (
  echo.
  echo NO SE PUDO ACTUALIZAR. La pagina anterior sigue igual. Detalle:
  echo.
  type "%TEMP%\regenerar_carpetas.log"
  del "%TEMP%\regenerar_carpetas.log"
  echo.
  pause
  exit /b 1
)
del "%TEMP%\regenerar_carpetas.log"
echo.
echo LISTO. Presiona F5 en Chrome para ver los cambios.
echo.
pause
