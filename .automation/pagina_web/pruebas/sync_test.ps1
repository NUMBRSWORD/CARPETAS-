$ErrorActionPreference='Stop'
$raizProyecto=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$raizPrueba=Join-Path $PSScriptRoot ('sync_prueba_'+[guid]::NewGuid().ToString('N'))
$pcPrueba=Join-Path $raizPrueba 'PC'
$usbPrueba=Join-Path $raizPrueba 'USB'
$descPrueba=Join-Path $raizPrueba 'Descargas'
$scriptSync=Join-Path $raizProyecto 'SINCRONIZAR.ps1'
foreach($dirPrueba in @($pcPrueba,$usbPrueba,$descPrueba)){New-Item -ItemType Directory -Path $dirPrueba -Force | Out-Null}
function Comprobar($condicion,$mensaje){if(-not $condicion){throw $mensaje}}
function Ejecutar-Sync {
  $salida=& powershell -NoProfile -ExecutionPolicy Bypass -File $scriptSync -Local $pcPrueba -Usb $usbPrueba -Descargas $descPrueba
  return @{codigo=$LASTEXITCODE;salida=$salida}
}
try {
  $datoPc=Join-Path $pcPrueba 'ficticio.txt'
  $datoUsb=Join-Path $usbPrueba 'ficticio.txt'
  [IO.File]::WriteAllText($datoPc,'UNO')
  [IO.File]::WriteAllText((Join-Path $descPrueba 'respaldo_completo_carpetas_ventanilla_prueba.json'),'{}')
  [IO.File]::WriteAllText((Join-Path $descPrueba 'base_carpetas_prueba.db'),'base ficticia')
  $resultado=Ejecutar-Sync
  Comprobar ($resultado.codigo -eq 0) 'Fallo de copia inicial'
  Comprobar (Test-Path -LiteralPath (Join-Path $usbPrueba 'respaldos/respaldo_completo_carpetas_ventanilla_prueba.json')) 'No se copio el respaldo completo'
  Comprobar (Test-Path -LiteralPath (Join-Path $usbPrueba 'respaldos/base_carpetas_prueba.db')) 'No se copio la base descargada'
  Write-Output 'OK: copia inicial y respaldo completo'
  $fechaDato=(Get-Item -LiteralPath $datoPc).LastWriteTimeUtc
  [IO.File]::WriteAllText($datoPc,'DOS')
  (Get-Item -LiteralPath $datoPc).LastWriteTimeUtc=$fechaDato
  $resultado=Ejecutar-Sync
  Comprobar ($resultado.codigo -eq 0) 'Fallo de sincronizacion de cambio'
  Comprobar ([IO.File]::ReadAllText($datoUsb) -eq 'DOS') 'Se omitio un cambio con el mismo tamano y fecha'
  Write-Output 'OK: detecta contenido diferente con igual tamano y fecha'
  [IO.File]::WriteAllText($datoPc,'PC!')
  [IO.File]::WriteAllText($datoUsb,'USB')
  $resultado=Ejecutar-Sync
  Comprobar ($resultado.codigo -eq 2) 'No detecto el conflicto'
  Comprobar ([IO.File]::ReadAllText($datoPc) -eq 'PC!') 'Se sobrescribio la PC'
  Comprobar ([IO.File]::ReadAllText($datoUsb) -eq 'USB') 'Se sobrescribio el USB'
  $conflicto=Get-ChildItem -LiteralPath $pcPrueba -Filter 'CONFLICTO_USB_*' -File
  Comprobar ($conflicto.Count -eq 1 -and [IO.File]::ReadAllText($conflicto.FullName) -eq 'USB') 'No se conservo el conflicto'
  Write-Output 'OK: conserva ambas versiones ante un conflicto'
} finally {
  $rutaEliminar=[IO.Path]::GetFullPath($raizPrueba)
  $limitePrueba=[IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')+'\'
  if(-not $rutaEliminar.StartsWith($limitePrueba,[StringComparison]::OrdinalIgnoreCase)){throw 'Ruta de limpieza fuera de pruebas'}
  Remove-Item -LiteralPath $rutaEliminar -Recurse -Force
}
