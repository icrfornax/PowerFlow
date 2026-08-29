# Beleg: Grundkarte

Stand: 30.08.2026.

## Quelle und Lizenz

**Natural Earth**, https://www.naturalearthdata.com/ — gemeinfrei.

Wörtlich aus den Nutzungsbedingungen: *"All versions of Natural Earth raster and
vector map data found on this website are in the public domain. You may use the
maps in any manner, including modifying the content and design, electronic
dissemination, and offset printing."*

Damit ist keine Namensnennung gefordert. Sie steht trotzdem in der Fußnote der
Seite und im Dateikopf — wer eine Grafik prüfen will, soll wissen, woher die
Geometrie stammt.

## Warum nicht OpenStreetMap und keine Kartenkacheln

- **OSM** steht unter der ODbL mit Share-alike-Pflicht für abgeleitete
  Datenbanken. Für die reine Grundkarte ist das unnötige Bindung.
- **Fremde Kartenkacheln** (Mapbox, Google, OSM-Tileserver) wären eine
  Laufzeitabhängigkeit zu einem fremden Dienst, eine Nutzungsbedingung mehr und
  ein Datenabfluss über die Besucher der Seite. Die Seite lädt deshalb **keine
  Kacheln**. Sie zeichnet die Geometrie selbst als SVG.

Für **Leitungen und Umspannwerke** sieht die Lage anders aus — dort führt kaum
ein Weg an OSM vorbei. Das ist noch nicht entschieden und noch nicht gebaut.

## Was gebaut wird

`scripts/fetch-grundkarte.py` ist ein **Einmal-Skript**, kein Teil der
täglichen Abrufkette. Die Rohdateien sind rund 44 MB und liegen bewusst nicht
im Repository.

| | Quelle | Toleranz | Ergebnis |
|---|---|---:|---|
| 16 Bundesländer | `ne_10m_admin_1_states_provinces` (40,7 MB) | 0,008° ≈ 600 m | 3.088 Punkte |
| 9 Nachbarstaaten | `ne_50m_admin_0_countries` (3,1 MB) | 0,030° | 783 Punkte |

Ergebnis: `data/grundkarte.json`, **68 kB**.

Vereinfacht mit Ramer-Douglas-Peucker, in Grad. Eine vereinfachte Grenze ist
eine **Näherung, keine Messung** — das steht im Kopf der Datei und im Popover
der Karte.

Koordinaten in GeoJSON-Reihenfolge `[Länge, Breite]`. `scripts/validate.py` hat
dafür einen eigenen Negativtest: eine vertauschte Reihenfolge muss auffallen.

## Darstellung

Dunkler, zurückhaltender Grund; Nachbarstaaten als leiser Kontext ohne Kontur;
Bundesländer als ruhige Fläche mit dünner Grenze; die Daten als leuchtende
Punkte darüber, eingefärbt nach Regelzone, Fläche proportional zur
Nettoleistung. Helles Gegenstück gleichwertig gepflegt.

Der Kartenausschnitt kommt aus der **Geometrie der Bundesländer**, erweitert um
die Anlagenkoordinaten — sonst fielen die 15 Anlagen deutscher Regelzonen in
Luxemburg, Österreich und der Schweiz aus dem Bild.

## Offen

- Umrisse der vier **Regelzonen** als Fläche. Sie folgen nicht den
  Bundeslandgrenzen; eine belegbare Geometrie dafür habe ich noch nicht.
  Deshalb sind bisher nur die Kraftwerkspunkte nach Zone eingefärbt.
- Leitungen und Umspannwerke.
