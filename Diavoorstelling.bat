@echo off
rem Diavoorstelling - zet dit bestand in je fotomap en dubbelklik erop.
rem Het zoekt alle foto's en filmpjes in deze map (en submappen) en toont ze
rem op volledig scherm in Microsoft Edge. Tekst en draaien worden in de JPG-foto
rem zelf opgeslagen; het origineel gaat eerst naar de map Diavoorstelling-originelen.
setlocal
set "DIA_BAT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$t = Get-Content -LiteralPath $env:DIA_BAT -Raw -Encoding UTF8; $p = ($t -split ('#' + 'POWERSHELL' + '#'), 2)[1] -split ('#' + 'DIAHTML' + '#'), 2; $global:DiaHtml = $p[1]; Invoke-Expression $p[0]"
exit /b

#POWERSHELL#
$ErrorActionPreference = 'Stop'
$sep = [IO.Path]::DirectorySeparatorChar
$backupNaam = 'Diavoorstelling-originelen'

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

# ---------- Hulpprogramma: schrijft tekst en draaistand in JPG-foto's ----------
# Een browser mag zelf geen bestanden aanpassen. Daarom luistert dit stukje op
# 127.0.0.1 (alleen deze computer) en past het op verzoek van de diavoorstelling
# een JPG-bestand in de fotomap aan. Elk verzoek moet de geheime sleutel bevatten.

function Antwoord($stream, [int]$code, [string]$type, [byte[]]$body) {
  $tekst = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 413 = 'Payload Too Large'; 500 = 'Internal Server Error' }[$code]
  if ($null -eq $body) { $body = [byte[]]@() }
  $kop = "HTTP/1.1 $code $tekst`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`n" +
         "Access-Control-Allow-Origin: *`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`n" +
         "Access-Control-Allow-Headers: Content-Type`r`nAccess-Control-Allow-Private-Network: true`r`n" +
         "Cache-Control: no-store`r`nConnection: close`r`n`r`n"
  $kb = [Text.Encoding]::ASCII.GetBytes($kop)
  $stream.Write($kb, 0, $kb.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}
function Tekst($stream, [int]$code, [string]$bericht) {
  Antwoord $stream $code 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($bericht))
}

# Volledig pad binnen de fotomap, of $null als het pad erbuiten valt / geen JPG is
function VeiligPad($map, $rel) {
  if (-not $rel) { return $null }
  $basis = [IO.Path]::GetFullPath($map).TrimEnd($sep) + $sep
  $vol = [IO.Path]::GetFullPath((Join-Path $basis ($rel -replace '[\\/]', $sep)))
  if (-not $vol.StartsWith($basis, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  if ($vol.Substring($basis.Length).StartsWith($backupNaam + $sep, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  if ([IO.Path]::GetExtension($vol).ToLower() -notin @('.jpg', '.jpeg', '.jfif')) { return $null }
  return $vol
}

function LeesBytes($stream, [int]$aantal) {
  $buf = New-Object byte[] $aantal
  $gelezen = 0
  while ($gelezen -lt $aantal) {
    $n = $stream.Read($buf, $gelezen, $aantal - $gelezen)
    if ($n -le 0) { throw 'Verbinding onderbroken' }
    $gelezen += $n
  }
  return ,$buf
}

function Verwerk($client, $map, $token) {
  $stream = $client.GetStream()
  # Kort wachten op de kop: browsers openen soms alvast een verbinding zonder verzoek
  $stream.ReadTimeout = 3000
  # Kop van het verzoek lezen (tot een lege regel)
  $kop = New-Object System.IO.MemoryStream
  while ($true) {
    $b = $stream.ReadByte()
    if ($b -lt 0) { return }
    $kop.WriteByte([byte]$b)
    if ($kop.Length -gt 16384) { return }
    $k = $kop.GetBuffer(); $n = $kop.Length
    if ($n -ge 4 -and $k[$n - 4] -eq 13 -and $k[$n - 3] -eq 10 -and $k[$n - 2] -eq 13 -and $k[$n - 1] -eq 10) { break }
  }
  $regels = [Text.Encoding]::ASCII.GetString($kop.ToArray()) -split "`r`n"
  $delen = $regels[0] -split ' '
  if ($delen.Count -lt 2) { return }
  $methode = $delen[0]
  $doel = $delen[1]
  $lengte = 0
  foreach ($r in $regels) { if ($r -match '^Content-Length:\s*(\d+)') { $lengte = [long]$Matches[1] } }

  if ($methode -eq 'OPTIONS') { Antwoord $stream 204 'text/plain' $null; return }

  $pad = $doel; $query = ''
  $i = $doel.IndexOf('?')
  if ($i -ge 0) { $pad = $doel.Substring(0, $i); $query = $doel.Substring($i + 1) }
  $q = @{}
  foreach ($paar in ($query -split '&')) {
    if (-not $paar) { continue }
    $kv = $paar -split '=', 2
    $q[[Uri]::UnescapeDataString($kv[0])] = if ($kv.Count -gt 1) { [Uri]::UnescapeDataString($kv[1]) } else { '' }
  }
  if ($q['token'] -ne $token) { Tekst $stream 403 'Geen toegang'; return }

  if ($pad -eq '/ping') { Tekst $stream 200 'ok'; return }
  if ($pad -ne '/bestand') { Tekst $stream 404 'Onbekend'; return }

  $vol = VeiligPad $map $q['pad']
  if (-not $vol) { Tekst $stream 403 'Alleen JPG-foto''s in de fotomap'; return }
  if (-not (Test-Path -LiteralPath $vol -PathType Leaf)) { Tekst $stream 404 'Foto niet gevonden'; return }

  if ($methode -eq 'GET') {
    if ($q.ContainsKey('kop')) {
      # Alleen het begin: daar staat de metadata
      $fs = [IO.File]::OpenRead($vol)
      try {
        $n = [int][Math]::Min($fs.Length, 262144)
        $data = New-Object byte[] $n
        $gelezen = 0
        while ($gelezen -lt $n) { $r = $fs.Read($data, $gelezen, $n - $gelezen); if ($r -le 0) { break }; $gelezen += $r }
      } finally { $fs.Close() }
    } else {
      $data = [IO.File]::ReadAllBytes($vol)
    }
    Antwoord $stream 200 'image/jpeg' $data
    return
  }

  if ($methode -eq 'POST') {
    $oud = (Get-Item -LiteralPath $vol).Length
    if ($lengte -lt 4 -or $lengte -gt ($oud + 200000)) { Tekst $stream 413 'Onverwachte grootte'; return }
    $stream.ReadTimeout = 15000
    $nieuw = LeesBytes $stream ([int]$lengte)
    # Alleen een geldige JPG accepteren
    if ($nieuw[0] -ne 0xFF -or $nieuw[1] -ne 0xD8) { Tekst $stream 400 'Geen JPG'; return }
    try {
      $info = Get-Item -LiteralPath $vol
      $gewijzigd = $info.LastWriteTimeUtc
      $gemaakt = $info.CreationTimeUtc
      # 1. Reservekopie van het origineel (alleen de eerste keer)
      $basis = [IO.Path]::GetFullPath($map).TrimEnd($sep) + $sep
      $rel = $vol.Substring($basis.Length)
      $backupMap = Join-Path $basis $backupNaam
      $backup = Join-Path $backupMap $rel
      if (-not (Test-Path -LiteralPath $backup)) {
        if (-not (Test-Path -LiteralPath $backupMap)) {
          $d = New-Item -ItemType Directory -Path $backupMap -Force
          try { $d.Attributes = $d.Attributes -bor [IO.FileAttributes]::Hidden } catch {}
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
        Copy-Item -LiteralPath $vol -Destination $backup
      }
      # 2. Eerst naar een tijdelijk bestand, dan het origineel in een keer vervangen
      $tijdelijk = $vol + '.diatmp'
      [IO.File]::WriteAllBytes($tijdelijk, $nieuw)
      try { [IO.File]::Replace($tijdelijk, $vol, $null) }
      catch { [IO.File]::Copy($tijdelijk, $vol, $true); Remove-Item -LiteralPath $tijdelijk -Force }
      # 3. Datum van de foto behouden (sorteren op datum blijft kloppen)
      $info = Get-Item -LiteralPath $vol
      $info.LastWriteTimeUtc = $gewijzigd
      try { $info.CreationTimeUtc = $gemaakt } catch {}
      Tekst $stream 200 'ok'
    } catch {
      if ($tijdelijk -and (Test-Path -LiteralPath $tijdelijk)) { Remove-Item -LiteralPath $tijdelijk -Force -ErrorAction SilentlyContinue }
      Tekst $stream 500 $_.Exception.Message
    }
    return
  }
  Tekst $stream 400 'Onbekend verzoek'
}

# Luistert tot de diavoorstelling een tijd niets meer vraagt (venster dicht)
function Start-Hulp($listener, $map, $token, [int]$stilSeconden = 150) {
  $laatste = Get-Date
  while ($true) {
    if (-not $listener.Pending()) {
      if (((Get-Date) - $laatste).TotalSeconds -gt $stilSeconden) { break }
      Start-Sleep -Milliseconds 100
      continue
    }
    $client = $listener.AcceptTcpClient()
    $laatste = Get-Date
    try { Verwerk $client $map $token } catch {} finally { $client.Close() }
  }
  $listener.Stop()
}

# Voor tests: alleen de functies laden
if ($env:DIA_TEST) { return }

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

  # Foto's en filmpjes zoeken (ook in submappen), zonder de map met reservekopieen
  $soorten = @('jpg','jpeg','jfif','png','apng','gif','webp','bmp','avif','svg','ico','heic','heif','tif','tiff',
               'mp4','m4v','webm','mov','mkv','ogv','avi','3gp')
  $bestanden = @(Get-ChildItem -LiteralPath $map -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
      $_ -and
      $soorten -contains $_.Extension.TrimStart('.').ToLower() -and
      -not ($_.Attributes -band [IO.FileAttributes]::Hidden) -and
      $_.FullName -notmatch '\\\$RECYCLE\.BIN\\' -and
      $_.FullName -notmatch ('\\' + $backupNaam + '\\')
    })
  $basis = $map.TrimEnd('\').Length
  $paden = @(foreach ($b in $bestanden) { $b.FullName.Substring($basis).TrimStart('\') -replace '\\', '/' })

  if ($paden.Count -eq 0) {
    Melding "Er staan geen foto's of filmpjes in deze map:`n$map`n`nZet Diavoorstelling.bat in de map met je foto's en dubbelklik er opnieuw op."
    exit
  }

  # Hulpprogramma klaarzetten op een vrije poort, met een geheime sleutel
  $listener = $null
  $hulpUrl = ''
  $token = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
  try {
    $listener = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $hulpUrl = "http://127.0.0.1:$($listener.LocalEndpoint.Port)"
  } catch { $listener = $null }

  # Lijst voor de app: map als file:-adres plus de paden daarbinnen
  $json = ConvertTo-Json -InputObject $paden -Compress
  $basisUrl = ConvertTo-Json -InputObject ((FileUrl $map.TrimEnd('\')) + '/')
  $lijst = "window.DIASHOW_BASE = $basisUrl;`nwindow.DIASHOW_FILES = $json;`n"
  if ($listener) { $lijst += "window.DIASHOW_SERVER = '$hulpUrl';`nwindow.DIASHOW_TOKEN = '$token';`n" }
  [IO.File]::WriteAllText((Join-Path $app 'diashow-lijst.js'), $lijst, $utf8)

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

  if ($env:DIA_GEEN_BROWSER) {
    # Alleen voor de automatische test: die opent zelf de browser
  } elseif ($browser) {
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
  exit
}

# Blijft op de achtergrond draaien zolang de diavoorstelling open is
if ($listener) { Start-Hulp $listener $map $token }
