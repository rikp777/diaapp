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
function Melding($tekst) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($tekst, 'Diavoorstelling') | Out-Null
  } catch {
    # Geen meldingsvenster mogelijk: dan in een consolevenster
    Write-Host $tekst; Read-Host 'Druk op Enter om te sluiten' | Out-Null
  }
}

try {
  $map = Split-Path -LiteralPath $env:DIA_BAT
  $index = Join-Path $map 'index.html'
  if (-not (Test-Path -LiteralPath $index)) {
    Melding "index.html staat niet in deze map:`n$map`n`nZet Diavoorstelling.bat en index.html samen in je fotomap."
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
    Melding "Geen foto's of filmpjes gevonden in:`n$map"
  }

  # Lijst wegschrijven als JavaScript (UTF-8 zonder BOM), zodat index.html hem kan lezen
  $json = if ($paden.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $paden -Compress }
  try {
    [IO.File]::WriteAllText((Join-Path $map 'diashow-lijst.js'), "window.DIASHOW_FILES = $json;`n", (New-Object Text.UTF8Encoding $false))
  } catch {
    Melding "Kan de lijst niet opslaan in deze map (alleen-lezen?):`n$($_.Exception.Message)`n`nDe diavoorstelling opent zonder lijst; kies dan zelf je bestanden."
  }

  # file:-adres opbouwen; elk deel apart coderen zodat # en % in mapnamen goed gaan
  $delen = ($index -replace '\\', '/') -split '/'
  $url = 'file:///' + (($delen | ForEach-Object { if ($_ -match '^[A-Za-z]:$') { $_ } else { [Uri]::EscapeDataString($_) } }) -join '/')
  if ($index.StartsWith('\\')) { $url = 'file:' + (($delen | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/') }

  # Openen in Edge als los venster op volledig scherm; Chrome als Edge ontbreekt
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
} catch {
  Melding "Er ging iets mis bij het starten van de diavoorstelling:`n$($_.Exception.Message)"
}
