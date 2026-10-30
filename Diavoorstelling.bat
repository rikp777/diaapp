@echo off
rem Diavoorstelling - zet dit bestand in je fotomap en dubbelklik erop.
rem Het zoekt alle foto's en filmpjes in deze map (en submappen) en toont ze
rem op volledig scherm in Microsoft Edge. Er wordt niets in je fotomap gezet.
setlocal
set "DIA_BAT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$t = Get-Content -LiteralPath $env:DIA_BAT -Raw -Encoding UTF8; $p = ($t -split ('#' + 'POWERSHELL' + '#'), 2)[1] -split ('#' + 'DIAHTML' + '#'), 2; $global:DiaHtml = $p[1]; Invoke-Expression $p[0]"
exit /b

#POWERSHELL#
$ErrorActionPreference = 'Stop'
function Melding($tekst) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($tekst, 'Diavoorstelling') | Out-Null
  } catch {}
}
# Pad -> file:-adres; elk deel apart coderen zodat spaties, # en % goed gaan
function FileUrl($pad) {
  $delen = ($pad -replace '\\', '/') -split '/'
  if ($pad.StartsWith('\\')) { return 'file:' + (($delen | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/') }
  return 'file:///' + (($delen | ForEach-Object { if ($_ -match '^[A-Za-z]:$') { $_ } else { [Uri]::EscapeDataString($_) } }) -join '/')
}
$utf8 = New-Object Text.UTF8Encoding $false

try {
  $map = Split-Path -LiteralPath $env:DIA_BAT
  # De app staat in een eigen map, zodat de fotomap schoon blijft
  $app = Join-Path $env:LOCALAPPDATA 'Diavoorstelling'
  New-Item -ItemType Directory -Force -Path $app | Out-Null
  $index = Join-Path $app 'index.html'
  if ($global:DiaHtml) {
    [IO.File]::WriteAllText($index, $global:DiaHtml.TrimStart("`r", "`n"), $utf8)
  } elseif (Test-Path -LiteralPath (Join-Path $map 'index.html')) {
    Copy-Item -LiteralPath (Join-Path $map 'index.html') -Destination $index -Force
  } else {
    Melding "Dit startbestand is onvolledig. Download Diavoorstelling.bat opnieuw."
    exit
  }

  # Foto's en filmpjes zoeken (ook in submappen)
  $soorten = @('jpg','jpeg','jfif','png','apng','gif','webp','bmp','avif','svg','ico','heic','heif','tif','tiff',
               'mp4','m4v','webm','mov','mkv','ogv','avi','3gp')
  $bestanden = @(Get-ChildItem -LiteralPath $map -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
      $_ -and
      $soorten -contains $_.Extension.TrimStart('.').ToLower() -and
      -not ($_.Attributes -band [IO.FileAttributes]::Hidden) -and
      $_.FullName -notmatch '\\\$RECYCLE\.BIN\\'
    })
  $basis = $map.TrimEnd('\').Length
  $paden = @(foreach ($b in $bestanden) { $b.FullName.Substring($basis).TrimStart('\') -replace '\\', '/' })

  if ($paden.Count -eq 0) {
    Melding "Er staan geen foto's of filmpjes in deze map:`n$map`n`nZet Diavoorstelling.bat in de map met je foto's en dubbelklik er opnieuw op."
    exit
  }

  # Lijst voor de app: map als file:-adres plus de paden daarbinnen
  $json = ConvertTo-Json -InputObject $paden -Compress
  $basisUrl = ConvertTo-Json -InputObject ((FileUrl $map.TrimEnd('\')) + '/')
  [IO.File]::WriteAllText((Join-Path $app 'diashow-lijst.js'),
    "window.DIASHOW_BASE = $basisUrl;`nwindow.DIASHOW_FILES = $json;`n", $utf8)

  # Openen in Edge als los venster op volledig scherm; Chrome als Edge ontbreekt
  $url = FileUrl $index
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
    # Eigen profiel: dan gelden de opties hieronder ook als de browser al openstaat,
    # en worden de instellingen van de diavoorstelling daar onthouden.
    $profiel = Join-Path $app 'profiel'
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
} catch {
  Melding "Er ging iets mis bij het starten van de diavoorstelling:`n$($_.Exception.Message)"
}
