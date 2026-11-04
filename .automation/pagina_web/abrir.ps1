# Abre la base de datos de esta PC (si no está abierta) y la página en Chrome.
param([switch]$SoloServidor,[int]$Puerto=8765,[string]$Datos='')
$raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$puerto = $Puerto
function Abierto {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $puerto); $c.Close(); return $true } catch { return $false }
}
if (-not (Abierto)) {
  Start-Process -FilePath "$raiz\herramientas\python\python.exe" -ArgumentList (@('-I', "`"$PSScriptRoot\servidor.py`"", '--puerto', $puerto) + $(if ($Datos) { @('--datos', "`"$Datos`"") } else { @() })) -WorkingDirectory $raiz -WindowStyle Hidden
  for ($i = 0; $i -lt 30 -and -not (Abierto); $i++) { Start-Sleep -Milliseconds 300 }
}
if (-not (Abierto)) {
  Add-Type -AssemblyName PresentationFramework
  [void][System.Windows.MessageBox]::Show('No se pudo abrir la base de datos de esta PC. Cierra otras ventanas negras de este programa y vuelve a intentarlo.', 'Carpetas Fiscales')
  exit 1
}
if ($SoloServidor) { exit 0 }
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) { Start-Process $chrome "http://127.0.0.1:$puerto/" } else { Start-Process "http://127.0.0.1:$puerto/" }
