# Sincroniza en ambos sentidos esta PC y el USB. Nunca borra ni pisa un cambio sin copiarlo primero:
# si un archivo cambio en los dos lados, deja ambas versiones y avisa.
# Salida: 0 listo, 1 sin USB, 2 hay conflictos, 3 sin carpeta en esta PC, 4 Excel abierto, 5 errores al copiar.
param([string]$Local,[string]$Usb,[string]$Descargas,[switch]$Crear,[switch]$Preguntar)
$ErrorActionPreference='Stop'
$NOMBRE='CARPETAS FISCALES'
$EXCEL='CARPETAS FISCALES ACTUALIZADAS 2026*.xlsx'
$ESTADO='.automation\.sync_estado.json'

function Unidades-Usb {
  try {
    return @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' -ErrorAction Stop | ForEach-Object { $_.DeviceID+'\' })
  } catch {
    # Algunas PC bloquean CIM; DriveInfo permite detectar el USB sin esa consulta.
    return @([IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq [IO.DriveType]::Removable -and $_.IsReady } | ForEach-Object { $_.Name })
  }
}
$unidadesUsb=@(Unidades-Usb)
function Es-Usb([string]$ruta){
  return $unidadesUsb -contains [IO.Path]::GetPathRoot($ruta)
}
if(-not $Usb){
  if(Es-Usb $PSScriptRoot){$Usb=$PSScriptRoot}
  else{
    foreach($d in $unidadesUsb){
      $c=Join-Path $d $NOMBRE
      if(Test-Path -LiteralPath (Join-Path $c 'CLAUDE.md')){$Usb=$c;break}
    }
  }
}
if(-not $Usb -or -not (Test-Path -LiteralPath $Usb)){Write-Output 'NO se encontro el USB con la carpeta del proyecto.';exit 1}
if(-not $Local){
  if(Es-Usb $PSScriptRoot){$Local=Join-Path ([Environment]::GetFolderPath('Desktop')) $NOMBRE}else{$Local=$PSScriptRoot}
}
if(-not (Test-Path -LiteralPath $Local)){
  if($Preguntar){$Crear=(Read-Host "Esta PC no tiene copia. Contiene datos sensibles. Crear $Local ? (S/N)") -match '^[sS]'}
  if(-not $Crear){Write-Output "SIN COPIA en esta PC: $Local. No se creo porque los datos son sensibles; se puede trabajar directo desde el USB.";exit 3}
  New-Item -ItemType Directory -Path $Local | Out-Null
}
$padre=Split-Path -Parent $Local
$excelFuera=@(Get-ChildItem -LiteralPath $padre -Filter $EXCEL -File -ErrorAction SilentlyContinue)

function Abierto([string]$dir){return @(Get-ChildItem -LiteralPath $dir -Filter '~$*.xlsx' -File -Force -ErrorAction SilentlyContinue)}
if((Abierto $Local).Count -or (Abierto $Usb).Count -or (Abierto $padre).Count){Write-Output 'EXCEL ABIERTO: cierralo y vuelve a sincronizar. No se copio nada.';exit 4}

# Respaldos de la pagina: se bajan a Descargas y viajan en la carpeta respaldos.
if(-not $Descargas){$Descargas=Join-Path $HOME 'Downloads'}
$dirResp=Join-Path $Local 'respaldos'
function Respaldos-Pagina([string]$directorio){
  return @(Get-ChildItem -LiteralPath $directorio -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'respaldo*carpetas_ventanilla_*.json' -or $_.Name -like 'base_carpetas_*.db' })
}
foreach($f in Respaldos-Pagina $Descargas){
  if(-not (Test-Path -LiteralPath $dirResp)){New-Item -ItemType Directory -Path $dirResp | Out-Null}
  $d=Join-Path $dirResp $f.Name
  if(-not (Test-Path -LiteralPath $d) -or (Get-Item -LiteralPath $d).LastWriteTimeUtc -lt $f.LastWriteTimeUtc){Copy-Item -LiteralPath $f.FullName -Destination $d}
}

function Listar([string]$raiz){
  $m=@{}
  $base=(Get-Item -LiteralPath $raiz).FullName.TrimEnd('\').Length+1
  foreach($f in Get-ChildItem -LiteralPath $raiz -Recurse -File -Force){
    $rel=$f.FullName.Substring($base)
    if($rel -match '(^|\\)(node_modules|__pycache__)\\' -or $f.Name -like 'CONFLICTO_*' -or $f.Name -like '~$*' -or $f.Name -like '*.tmpsync' -or $f.Name -eq 'ABRIR EN CHROME.lnk' -or $rel -eq $ESTADO -or $rel -like 'datos_servidor\carpetas.db*'){continue}
    $m[$rel]=$f
  }
  return $m
}
$L=Listar $Local;$U=Listar $Usb
foreach($f in $excelFuera){$L[$f.Name]=$f}  # En la PC original el Excel esta junto a la carpeta del proyecto.

$rutaEstado=Join-Path $Local $ESTADO
$antes=@{}
if(Test-Path -LiteralPath $rutaEstado){
  (Get-Content -LiteralPath $rutaEstado -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object {$antes[$_.Name]=$_.Value}
}
function Hash($f){return (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash}
function Copiar($o,[string]$destino){
  $dir=Split-Path -Parent $destino
  if(-not (Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir -Force | Out-Null}
  $t=$destino+'.tmpsync'
  Copy-Item -LiteralPath $o -Destination $t -Force
  Move-Item -LiteralPath $t -Destination $destino -Force
}
function RutaLocal([string]$rel){
  if($L.ContainsKey($rel)){return $L[$rel].FullName}
  return Join-Path $Local $rel
}
$nuevo=@{};$aPc=@();$aUsb=@();$conflictos=@();$errores=@()
$sello=Get-Date -Format 'yyyy-MM-dd_HHmmss_fff'
foreach($rel in @($L.Keys)+@($U.Keys) | Sort-Object -Unique){
  try{
    $a=$L[$rel];$b=$U[$rel];$base=$antes[$rel]
    if($a -and $b){
      # Igual tamaño y fecha no garantizan igual contenido (USB FAT y ediciones rápidas).
      $ha=Hash $a;$hb=Hash $b
      if($ha -eq $hb){$h=$ha}
      elseif($base -and $base.h -eq $ha){Copiar $b.FullName $a.FullName;$h=$hb;$aPc+=$rel}
      elseif($base -and $base.h -eq $hb){Copiar $a.FullName $b.FullName;$h=$ha;$aUsb+=$rel}
      else{
        # Cambio en los dos lados: la version del USB queda junto a la de la PC y ninguna se pierde.
        Copiar $b.FullName (Join-Path $a.DirectoryName ("CONFLICTO_USB_$sello`_"+$a.Name))
        $conflictos+=$rel
        if($base){$nuevo[$rel]=$base}
        continue
      }
    }elseif($a){Copiar $a.FullName (Join-Path $Usb $rel);$h=Hash $a;$aUsb+=$rel}
    else{Copiar $b.FullName (RutaLocal $rel);$h=Hash $b;$aPc+=$rel}
    $f=Get-Item -LiteralPath (RutaLocal $rel)
    $nuevo[$rel]=[pscustomobject]@{h=$h;s=$f.Length;t=$f.LastWriteTimeUtc.ToString('o')}
  }catch{$errores+="$rel : $($_.Exception.Message)";if($antes[$rel]){$nuevo[$rel]=$antes[$rel]}}
}
$dirE=Split-Path -Parent $rutaEstado
if(-not (Test-Path -LiteralPath $dirE)){New-Item -ItemType Directory -Path $dirE -Force | Out-Null}
[IO.File]::WriteAllText($rutaEstado,([pscustomobject]$nuevo | ConvertTo-Json -Depth 3),[Text.UTF8Encoding]::new($false))

Write-Output "PC : $Local"
Write-Output "USB: $Usb"
Write-Output "Del USB a la PC: $($aPc.Count)";$aPc | ForEach-Object {Write-Output "  $_"}
Write-Output "De la PC al USB: $($aUsb.Count)";$aUsb | ForEach-Object {Write-Output "  $_"}
$ult=Respaldos-Pagina $dirResp | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if($ult){Write-Output "Respaldo mas reciente: $($ult.FullName) ($($ult.LastWriteTime.ToString('dd/MM/yyyy HH:mm')))"}else{Write-Output 'Respaldo mas reciente: ninguno'}
if(($aPc+$aUsb) -match '\.xlsx$'){Write-Output 'EXCEL ACTUALIZADO: hay que regenerar la pagina.'}
if($errores.Count){Write-Output "ERRORES: $($errores.Count)";$errores | ForEach-Object {Write-Output "  $_"}}
if($conflictos.Count){Write-Output "CONFLICTOS (cambiaron en los dos lados; se guardo CONFLICTO_USB_...): $($conflictos.Count)";$conflictos | ForEach-Object {Write-Output "  $_"};exit 2}
if($errores.Count){exit 5}
Write-Output 'Sincronizacion completa.'
exit 0
