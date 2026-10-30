# Diavoorstelling

Een eenvoudige diavoorstelling voor foto's en filmpjes, vergelijkbaar met de
diavoorstelling van Windows Foto's, maar dan kies je zelf hoeveel seconden elke
foto te zien is en worden filmpjes gewoon afgespeeld. Alles zit in één bestand
(`index.html`) en werkt zonder installatie.

**Privacy:** je bestanden blijven op je eigen computer. Er wordt niets
geüpload; de browser toont ze rechtstreeks vanaf je schijf (via tijdelijke
*object URLs*).

## Gebruik

1. Open `index.html` door erop te dubbelklikken (Chrome, Edge, Firefox of
   Safari), of gebruik de online versie:
   <https://rikp777.github.io/diaapp/>.
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
| Scherm vullen | Snijdt foto's bij zodat er geen zwarte randen zijn. |
| Ken Burns-effect | Foto's langzaam inzoomen en verschuiven (standaard uit). |

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
| `G` | Miniatuuroverzicht openen/sluiten |
| `Esc` | Sluit eerst het overzicht, dan volledig scherm, en stopt daarna de voorstelling |

Beweeg de muis om de bedieningsbalk te tonen (met o.a. een volumeschuif); als
de muis stilstaat verdwijnt hij weer. In het **miniatuuroverzicht** klik je op
een miniatuur om naar die dia te springen; miniaturen worden pas geladen als ze
in beeld komen.

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

De tests staan in `tests/slideshow.spec.js` en maken hun testfoto's en
-filmpjes zelf aan met ffmpeg in een tijdelijke map, dus ffmpeg moet
geïnstalleerd zijn. Op GitHub draaien ze automatisch via
`.github/workflows/test.yml`.

## Publiceren op GitHub Pages

1. Ga in de repository naar **Settings → Pages** en kies bij **Source**:
   **GitHub Actions**.
2. De workflow `.github/workflows/pages.yml` publiceert de app bij elke push
   naar `main` (of handmatig via *Run workflow*).
3. De app staat dan op <https://rikp777.github.io/diaapp/>.
