# Reinicia solamente el servidor de este proyecto. Ejecutar como administrador
# cuando el servidor anterior se inicio con permisos elevados.
$ErrorActionPreference='Stop'
$raizReinicio=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$rutaServidor=Join-Path $PSScriptRoot 'servidor.py'
try {
  $oyentes=@(Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach($idServidor in $oyentes){
    $procesoServidor=Get-CimInstance Win32_Process -Filter "ProcessId=$idServidor" -ErrorAction Stop
    if($procesoServidor.Name -notin @('python.exe','pythonw.exe') -or -not $procesoServidor.CommandLine -or $procesoServidor.CommandLine -notmatch [regex]::Escape($rutaServidor)){
      throw 'No se pudo comprobar que el proceso pertenece a este proyecto. Ejecuta REINICIAR SERVIDOR.bat como administrador.'
    }
  }
  foreach($idServidor in $oyentes){Stop-Process -Id $idServidor -ErrorAction Stop}
  & (Join-Path $PSScriptRoot 'abrir.ps1') -SoloServidor
  $respuesta=Invoke-WebRequest -Uri 'http://127.0.0.1:8765/' -UseBasicParsing -TimeoutSec 10
  if($respuesta.Headers['Server'] -notlike 'Carpetas*' -or $respuesta.Content -notmatch 'id="guardado"'){throw 'No se pudo comprobar la pagina actualizada.'}
  Write-Output 'Servidor actualizado. Recarga la pagina en Chrome con F5.'
} catch {
  Write-Output ('No se pudo reiniciar: '+$_.Exception.Message)
  exit 1
}
