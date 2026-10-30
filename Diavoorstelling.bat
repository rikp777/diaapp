@echo off
rem Diavoorstelling: zet dit bestand samen met index.html in je fotomap en dubbelklik erop.
rem Het zoekt alle foto's en filmpjes in deze map (en submappen), schrijft de lijst naar
rem diashow-lijst.js en opent de voorstelling op volledig scherm in Microsoft Edge.
setlocal
set "DIA_BAT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$m = '#' + 'POWERSHELL' + '#'; $s = (Get-Content -LiteralPath $env:DIA_BAT -Raw -Encoding UTF8) -split $m, 2; Invoke-Expression $s[1]"
exit /b

#POWERSHELL#
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
function Melding($tekst) {
  [System.Windows.Forms.MessageBox]::Show($tekst, 'Diavoorstelling') | Out-Null
}

$map = Split-Path -LiteralPath $env:DIA_BAT
$index = Join-Path $map 'index.html'
if (-not (Test-Path -LiteralPath $index)) {
  Melding "index.html staat niet in deze map:`n$map`n`nZet Diavoorstelling.bat en index.html samen in je fotomap."
  exit
}

# Foto's en filmpjes zoeken (ook in submappen)
$soorten = @('jpg','jpeg','jfif','png','gif','webp','bmp','avif','heic','heif','tif','tiff',
             'mp4','m4v','webm','mov','mkv','ogv','avi','3gp','wmv')
$bestanden = Get-ChildItem -LiteralPath $map -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {
    $soorten -contains $_.Extension.TrimStart('.').ToLower() -and
    -not ($_.Attributes -band [IO.FileAttributes]::Hidden) -and
    $_.FullName -notmatch '\\\$RECYCLE\.BIN\\'
  }
$paden = @($bestanden | ForEach-Object {
  $_.FullName.Substring($map.TrimEnd('\').Length).TrimStart('\') -replace '\\', '/'
})

if ($paden.Count -eq 0) {
  Melding "Geen foto's of filmpjes gevonden in:`n$map"
}

# Lijst wegschrijven als JavaScript (UTF-8 zonder BOM), zodat index.html hem kan lezen
$json = if ($paden.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $paden -Compress }
$js = "window.DIASHOW_FILES = $json;`n"
[IO.File]::WriteAllText((Join-Path $map 'diashow-lijst.js'), $js, (New-Object Text.UTF8Encoding $false))

# Openen in Edge als los venster op volledig scherm; Chrome als Edge ontbreekt
$url = ([Uri]$index).AbsoluteUri
$browsers = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $browsers | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

if ($browser) {
  # Eigen profielmap: dan gelden de opties hieronder ook als de browser al openstaat,
  # en worden de instellingen van de diavoorstelling daar onthouden.
  $profiel = Join-Path $env:LOCALAPPDATA 'Diavoorstelling'
  $argumenten = @(
    "--app=`"$url`"",
    '--start-fullscreen',
    '--autoplay-policy=no-user-gesture-required',
    "--user-data-dir=`"$profiel`"",
    '--no-first-run',
    '--no-default-browser-check'
  )
  Start-Process -FilePath $browser -ArgumentList $argumenten
} else {
  Start-Process -FilePath $index
}
