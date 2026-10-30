# Diavoorstelling

Een eenvoudige diavoorstelling voor foto's en filmpjes, vergelijkbaar met de
diavoorstelling van Windows Foto's, maar dan kies je zelf hoeveel seconden elke
foto te zien is en worden filmpjes gewoon afgespeeld. De app is één bestand
(`index.html`) en werkt zonder installatie. Op Windows download je één bestand,
zet je het in je fotomap en dubbelklik je erop.

**Privacy:** je foto's en filmpjes blijven op je eigen computer en worden
nergens heen gestuurd. Alleen voor de plaatsnaam wordt de GPS-positie van een
foto (de coördinaten, niet de foto) opgezocht bij OpenStreetMap; dat zet je uit
met **Plek tonen** op het instellingenscherm.

## Gebruik op een Windows-pc

Voor iedereen, ook zonder computerkennis:

1. Ga naar <https://rikp777.github.io/diaapp/> en klik op **Download Diavoorstelling**.
2. Sleep het bestand `Diavoorstelling.bat` uit *Downloads* naar je fotomap.
3. Dubbelklik erop. De voorstelling begint meteen op volledig scherm.

De downloadpagina legt ook uit wat je doet bij de waarschuwingen die Windows
de eerste keer kan geven (*Behouden* bij het downloaden; *Meer informatie →
Toch uitvoeren* bij het openen).

Hoe het werkt: in `Diavoorstelling.bat` zit de hele app. Bij dubbelklikken zet
het de app in `%LOCALAPPDATA%\Diavoorstelling`, zoekt alle foto's en filmpjes
in de map van het bestand (ook in submappen) en opent ze in Microsoft Edge
(of Chrome) als los venster op volledig scherm. In je fotomap komt alleen iets
bij als je een foto aanpast (bijschrift, plek of draaien): dan wordt eerst het
origineel bewaard in de verborgen map `Diavoorstelling-originelen`. Foto's toegevoegd? Dubbelklik opnieuw. `Esc` brengt je naar het
instellingenscherm, `Alt+F4` sluit af. Instellingen worden onthouden.

## Gebruik zonder startbestand

1. Open `index.html` door erop te dubbelklikken (Chrome, Edge, Firefox of
   Safari), of gebruik de online versie:
   <https://rikp777.github.io/diaapp/app/>.
2. Kies **Bestanden kiezen…** of **Map kiezen…**, of sleep bestanden of hele
   mappen naar het venster.
3. Stel in hoeveel seconden elke foto te zien is en klik op
   **Diavoorstelling starten**.

Bestanden worden op naam gesorteerd, met getallen in de goede volgorde
(`foto2` komt vóór `foto10`).

## Instellingen

| Instelling | Uitleg |
| --- | --- |
| Seconden per foto | 1 tot 3600 seconden. Ook tijdens de voorstelling aan te passen in de balk of met `+` en `−`; de nieuwe tijd geldt meteen, ook voor de huidige dia. |
| Filmpjes | *Helemaal afspelen* (standaard) of *Zelfde tijd als foto's*. |
| Geluid van filmpjes uit | Filmpjes zonder geluid afspelen. |
| Willekeurige volgorde | Husselt de volgorde. |
| Herhalen na laatste | Begint na de laatste dia weer opnieuw. |
| Scherm vullen | Snijdt foto's en filmpjes bij zodat er geen zwarte randen zijn. Staande beelden op een liggend scherm (en andersom) worden niet bijgesneden, zodat je ze helemaal ziet. Ook tijdens de voorstelling aan/uit met `V` of de knop met het kader. |
| Bewegende foto's | Foto's langzaam inzoomen en verschuiven (standaard uit). Ook tijdens de voorstelling aan/uit met `A` of de knop met het vergrootglas. |

### Tekst bij een foto en foto's draaien

Druk tijdens de voorstelling op `T` (of klik op het potloodje in de balk), typ
een tekst, bijvoorbeeld *"zo nog even de tuin grasmaaien"*, en druk op
`Enter`. Met `R` (of de draaiknop) draai je een foto een kwartslag rechtsom.

Tekst en draaistand worden **in de foto zelf** opgeslagen (in de
EXIF-metadata). Zo blijven ze bij de foto, ook als je hem kopieert. In
Windows zie je de tekst bij *Eigenschappen → Details → Titel*. De beeldkwaliteit
verandert niet: alleen de metadata wordt aangepast, en camera, datum en
GPS-gegevens blijven behouden. De datum van het bestand blijft ook gelijk.

- **Reservekopie:** voor de eerste wijziging aan een foto wordt het origineel
  bewaard in de verborgen map `Diavoorstelling-originelen` in de fotomap.
- **Alleen JPG-foto's** (bijna alle camera- en telefoonfoto's). Bij filmpjes en
  andere bestanden legt de app uit dat het niet kan.
- **Alleen via `Diavoorstelling.bat`:** een browser mag zelf geen bestanden
  aanpassen. Het startbestand start daarom op de achtergrond een klein
  hulpprogramma dat alleen vanaf deze computer bereikbaar is (127.0.0.1, met
  een geheime sleutel) en alleen JPG-bestanden in de fotomap mag aanpassen. Het
  stopt vanzelf als de voorstelling dicht is. In de online versie worden
  teksten wel getoond, maar niet opgeslagen.

### Plek

Heeft een foto GPS-gegevens (de meeste telefoonfoto's), dan staat onder in
beeld waar hij gemaakt is, bijvoorbeeld *📍 Utrecht*. De plaatsnaam wordt
opgezocht bij [OpenStreetMap](https://www.openstreetmap.org/); alleen de
coördinaten worden verstuurd, niet de foto. Opgezochte namen worden onthouden.
Met `P` (of de speld in de balk) pas je de plek zelf aan; die wordt in de foto
opgeslagen (Windows: *Onderwerp*). Leegmaken zet de plaatsnaam uit de
GPS-gegevens terug.

### Dubbele foto's en Live Photos

- **Precies dezelfde foto** (bijvoorbeeld in twee mappen, of gekopieerd als
  *IMG_1234 (1).jpg*) wordt maar één keer getoond. Alleen bestanden met
  exact dezelfde inhoud tellen als dubbel; de naam zonder *(1)* of *kopie*
  krijgt de voorkeur.
- **iPhone Live Photos** bestaan uit een foto én een kort filmpje met dezelfde
  naam (*IMG_1234.JPG* + *IMG_1234.MOV*). Het filmpje wordt overgeslagen; met
  **Live Photo-filmpjes overslaan** op het instellingenscherm zet je dat uit.

Het startscherm meldt hoeveel er zijn overgeslagen.

### Datum

Naast de plek staat wanneer de foto gemaakt is, bijvoorbeeld *📅 1 juli 2024*:
de opnamedatum uit de foto zelf (EXIF), of anders de datum van het bestand
(bij filmpjes en foto's zonder opnamedatum).

Op het instellingenscherm zet je los van elkaar aan of uit:
**Bijschrift tonen**, **Plek tonen** (uit = er wordt niets opgezocht),
**Datum tonen** en **Bestandsnaam tonen** (linksboven, standaard uit).

Instellingen worden onthouden in de browser (`localStorage`).

## Bediening

| Toets / actie | Functie |
| --- | --- |
| `Spatie` of klik in het midden | Pauze / afspelen |
| `→` of klik rechts | Volgende |
| `←` of klik links | Vorige |
| `Home` / `End` | Eerste / laatste dia |
| `+` / `−` | Een seconde langer / korter per foto |
| `F` of dubbelklik | Volledig scherm aan/uit |
| `M` | Geluid aan/uit |
| `S` | Willekeurige volgorde aan/uit |
| `A` | Bewegende foto's aan/uit |
| `V` | Scherm vullen aan/uit |
| `T` | Bijschrift bij de huidige foto zetten of aanpassen (wordt in de foto opgeslagen) |
| `P` | Plek aanpassen (wordt in de foto opgeslagen) |
| `R` | Foto een kwartslag rechtsom draaien (wordt in de foto opgeslagen) |
| `G` | Overzicht openen/sluiten: alle foto's per map, met zoekvak; klik opent een foto in pauze om te bewerken |
| `Esc` of tandwiel | Sluit eerst het overzicht, dan volledig scherm, en gaat daarna naar het instellingenscherm |

Beweeg de muis om de bedieningsbalk te tonen (met o.a. een volumeschuif); als
de muis stilstaat verdwijnt hij weer. 

### Een foto zoeken en bewerken

Het **overzicht** (`G`, de knop met de vier vakjes, of **Foto zoeken en
bewerken** op het instellingenscherm) toont alle foto's en filmpjes, per map.
Typ in het zoekvak een deel van de naam of de map (bijvoorbeeld *strand* of
*2024*). Klik op een foto (of druk `Enter` voor de eerste treffer): die opent
**in pauze**, zodat je meteen een bijschrift (`T`), plek (`P`) of draaiing (`R`)
kunt geven. `Spatie` laat de voorstelling weer lopen. Miniaturen worden pas
geladen als ze in beeld komen.

## Goed om te weten

- **Grote mappen** met duizenden foto's werken: geheugen van dia's die ver weg
  zijn wordt weer vrijgegeven.
- **Niet-ondersteunde bestanden** worden overgeslagen; de teller laat zien
  hoeveel. Denk aan HEIC-foto's in Chrome en Firefox (Safari kan HEIC wel tonen).
- **Automatisch afspelen met geluid** wordt soms door de browser geblokkeerd;
  het filmpje speelt dan zonder geluid.
- Een **filmpje dat niet kan worden afgespeeld** wordt overgeslagen, met een
  melding.

## Welke videoformaten werken?

| Formaat | Werkt in |
| --- | --- |
| MP4 (H.264 + AAC) | Alle browsers |
| WebM (VP8/VP9/AV1) | Chrome, Edge, Firefox en recente versies van Safari |
| MOV | Als het H.264 bevat (vaak bij iPhone-video's). HEVC/H.265-MOV alleen in Safari, en in Edge/Chrome op hardware met HEVC-ondersteuning |
| MKV | Meestal in Chrome/Edge, niet betrouwbaar in Firefox/Safari |
| AVI / WMV / 3GP | Meestal niet |

Werkt een filmpje niet? Zet het om naar MP4, bijvoorbeeld met
[HandBrake](https://handbrake.fr/) of met ffmpeg:

```sh
ffmpeg -i in.avi -c:v libx264 -c:a aac uit.mp4
```

## Ontwikkelen

De tests gebruiken [Playwright](https://playwright.dev/):

```sh
npm install
npx playwright install chromium
npm test
```

De tests staan in `tests/` (`slideshow.spec.js`, `metadata.spec.js`; `windows.spec.js` voert op Windows het echte `Diavoorstelling.bat` uit met Edge) en maken hun testfoto's en
-filmpjes zelf aan met ffmpeg in een tijdelijke map, dus ffmpeg moet
geïnstalleerd zijn. Op GitHub draaien ze automatisch via
`.github/workflows/test.yml`.

### Het downloadbestand maken

`Diavoorstelling.bat` in de repo is alleen het startgedeelte. Met

```sh
node scripts/maak-download.js
```

ontstaat `dist/Diavoorstelling.bat` met `index.html` erin. De Pages-workflow
doet dit automatisch en zet het bestand op de downloadpagina (`site/index.html`).

## Publiceren op GitHub Pages

1. Ga in de repository naar **Settings → Pages** en kies bij **Source**:
   **GitHub Actions**.
2. De workflow `.github/workflows/pages.yml` publiceert de app bij elke push
   naar `main` (of handmatig via *Run workflow*).
3. De downloadpagina staat dan op <https://rikp777.github.io/diaapp/>, de app
   zelf op <https://rikp777.github.io/diaapp/app/>.
