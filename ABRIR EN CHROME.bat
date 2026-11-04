@echo off
rem Abre la base de datos de esta PC (si no esta abierta) y la pagina en Chrome.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0.automation\pagina_web\abrir.ps1"
