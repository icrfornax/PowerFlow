# Lizenzen der Daten

Der **Code** dieses Repositories steht unter der MIT-Lizenz (siehe `LICENSE`).
Für die **Daten** unter `data/` gilt das nicht. Sie stammen aus drei Quellen mit
drei verschiedenen Lizenzen. Die Unterschiede sind nicht kosmetisch — eine davon
verpflichtet zur Weitergabe unter denselben Bedingungen.

## Übersicht

| Dateien | Quelle | Lizenz | Namensnennung |
|---|---|---|---|
| `data/tage/*.json`, `data/tage-verzeichnis.json`, `data/kraftwerke.json` | SMARD, Bundesnetzagentur | CC BY 4.0 | `Bundesnetzagentur \| SMARD.de` |
| `data/grundkarte.json` | Natural Earth | gemeinfrei (public domain) | keine gefordert |
| `data/netz-hoechstspannung.json`, `data/netz-hochspannung.json`, `data/netz-umspannwerke.json` | OpenStreetMap | **ODbL 1.0** | `© OpenStreetMap contributors` |

## SMARD — CC BY 4.0

<https://www.smard.de/home/datennutzung>

Teilen und bearbeiten erlaubt, Quelle muss genannt werden. Die geforderte
Namensnennung lautet wörtlich `Bundesnetzagentur | SMARD.de`. Die
Bundesnetzagentur schließt eine Haftung für Richtigkeit und Vollständigkeit aus.

## Natural Earth — gemeinfrei

<https://www.naturalearthdata.com/about/terms-of-use/>

Wörtlich: *"All versions of Natural Earth raster and vector map data found on
this website are in the public domain."* Keine Namensnennung gefordert. Sie
steht trotzdem in der Fußnote der Seite — wer eine Grafik prüfen will, soll
wissen, woher die Geometrie kommt.

## OpenStreetMap — ODbL 1.0, mit Share-alike

<https://www.openstreetmap.org/copyright> ·
<https://opendatacommons.org/licenses/odbl/1-0/>

Das ist die Lizenz mit Folgen:

- **Namensnennung** wörtlich: `© OpenStreetMap contributors`. Sie steht in der
  Fußnote der Seite, im Popover der Karte und im Kopf jeder `netz-*.json`.
- **Share-alike.** Die Dateien `data/netz-*.json` sind eine *abgeleitete
  Datenbank* im Sinne der ODbL. Wer sie weitergibt oder in eigene Daten
  einarbeitet und diese veröffentlicht, muss das Ergebnis wieder unter ODbL
  stellen.
- Das gilt **nicht** für den Code und **nicht** für die anderen Datendateien.
  Die Lizenzen gelten getrennt nebeneinander, sie färben nicht aufeinander ab.
- Eine aus den Daten erzeugte *Darstellung* — etwa ein Bildschirmfoto der
  Karte — ist ein "Produced Work" und darf unter eigenen Bedingungen
  weitergegeben werden, solange die Namensnennung erhalten bleibt.

### Was die OSM-Daten nicht sind

Sie zeigen **Verlauf und Spannungsebene** von Leitungen und Umspannwerken —
**keinen Lastfluss und keine Auslastung**. Flüsse auf einzelnen Hoch- und
Höchstspannungsleitungen werden nach § 23c Abs. 2 EnWG nicht veröffentlicht.

OpenStreetMap ist außerdem eine Gemeinschaftserhebung, keine amtliche Quelle.
Die Erfassung kann unvollständig oder veraltet sein, besonders auf der
110-kV-Ebene. Mittelspannung ist dort kaum erfasst.
