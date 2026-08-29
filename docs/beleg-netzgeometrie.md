# Beleg: Leitungen und Umspannwerke

Stand: 30.08.2026. Zuständiger Skill: `datenquellen-strom`.

## Warum OpenStreetMap

Es gibt keine amtliche Alternative. Geprüft:

| Quelle | Ergebnis |
|---|---|
| SMARD / Bundesnetzagentur | keine Leitungsgeometrie |
| Die vier Übertragungsnetzbetreiber | Netzkarten als **PDF**, nicht als Daten |
| Natural Earth | keine Infrastruktur |
| Netzentwicklungsplan | **geplante** Trassen, nicht der Bestand |
| **OpenStreetMap** | Verlauf, Spannungsebene, Betreiber — als Daten abrufbar |

## Rohabruf

Overpass-API, Filter über das Staatsgebiet Deutschland. Erst gezählt, dann
abgerufen:

```
[out:json][timeout:180];
area["ISO3166-1"="DE"][admin_level=2]->.de;
way["power"="line"]["voltage"~"^(380000|400000|220000)"](area.de);
out count;
```

| Objektart | Anzahl in Deutschland |
|---|---:|
| Leitungen 220/380/400 kV | 10.061 Wegsegmente |
| Leitungen 110 kV | 39.655 |
| Umspannwerke mit Spannungsangabe | 16.855 |
| Masten | 207.805 |
| Kabel | 6.915 |

**Masten sind nicht im Umfang.** 207.805 Punkte sind auf einer statischen Seite
nicht darstellbar und tragen nichts zur Leitfrage bei.

## Was daraus wird

| Datei | Inhalt | Größe |
|---|---|---:|
| `data/netz-hoechstspannung.json` | 10.022 Abschnitte 220 kV und darüber | 1,76 MB |
| `data/netz-hochspannung.json` | 39.452 Abschnitte 110 kV | 5,94 MB |
| `data/netz-umspannwerke.json` | 5.259 Umspannwerke ab 110 kV | 0,39 MB |

Verworfen wurden nur Objekte ohne brauchbare Geometrie (41 bzw. 203). Kein
einziges Objekt fiel wegen fehlender Spannungsangabe oder Lage außerhalb des
Rahmens heraus — die Overpass-Filter greifen sauber.

Koordinaten auf vier Nachkommastellen gerundet (rund 11 m). Feiner braucht eine
Landeskarte nicht, und es halbiert die Dateigröße.

Das `voltage`-Feld darf in OSM mehrere Werte mit Semikolon enthalten
(`380000;110000`, 346-mal). Für die Darstellung zählt die **höchste**: eine
solche Trasse ist eine 380-kV-Trasse, die zusätzlich 110-kV-Systeme trägt.

Die 110-kV-Ebene wird **erst geladen, wenn jemand sie einschaltet** — 5,9 MB
gehören nicht in den ersten Seitenaufruf.

## Lizenz — anders als der Rest

**ODbL 1.0**, nicht CC BY 4.0 wie SMARD und nicht gemeinfrei wie Natural Earth.
Namensnennung wörtlich `© OpenStreetMap contributors`, dazu **Share-alike** für
abgeleitete Datenbanken. Die Dateien `data/netz-*.json` sind solche. Vollständig
in `LIZENZ-DATEN.md`.

`scripts/validate.py` prüft Namensnennung, Lizenzangabe und Share-alike-Hinweis
in jeder der drei Dateien und im Seitentext. Vier Negativtests sichern das ab.

## Was diese Daten nicht sind

**Verlauf und Spannungsebene — kein Lastfluss und keine Auslastung.** Eine
gezeichnete Leitung bleibt eine Linie ohne Zahl. Flüsse auf einzelnen Hoch- und
Höchstspannungsleitungen werden nach § 23c Abs. 2 EnWG nicht veröffentlicht;
öffentlich sichtbare Leitungsauslastungen sind Modellrechnungen.

Dieser Satz steht **direkt an der Karte**, nicht nur im Popover, und ein
Negativtest schlägt an, wenn ihn jemand entfernt.

Weiter gilt:

- OpenStreetMap ist eine **Gemeinschaftserhebung, keine amtliche Quelle**. Die
  Erfassung kann unvollständig oder veraltet sein, besonders auf der
  110-kV-Ebene.
- **Mittelspannung ist in OSM kaum erfasst.** Sie bleibt außen vor.
- Die **Regelzonen sind nicht als Fläche** dargestellt. Sie folgen nicht den
  Bundeslandgrenzen, und eine belegbare Geometrie dafür habe ich nicht. Die
  Zone erscheint nur als Farbe der Kraftwerkspunkte.

## Ein technischer Fund

Python scheitert unter Windows am TLS-Handschlag mit `overpass-api.de`:
`certificate verify failed: certificate has expired`. Im mitgelieferten
Zertifikatsspeicher steckt ein abgelaufenes Wurzelzertifikat; `curl` mit dem
Windows-Speicher hat keine Mühe.

Behoben mit dem aktuellen Speicher von `certifi`, falls vorhanden — **die
Prüfung wird nicht abgeschaltet**. Auf den Linux-Runnern ist der Systemspeicher
aktuell, dort gilt der Standardkontext.

## Darstellung

Bei knapp 40.000 Wegen wären 40.000 SVG-Elemente zu langsam. Gezeichnet wird
**ein Pfadelement je Spannungsebene** mit vielen Teilzügen. Preis dafür: kein
eigener Tooltip je Leitung. Das ist vertretbar — die Leitung trägt ohnehin keine
Zahl, die man ablesen könnte.

Farbe nach Spannung, nicht dekorativ: je höher die Spannung, desto heller und
kräftiger die Linie. Umspannwerke als Punkte, Radius nach Spannungsebene.

Die Ebenen lassen sich einzeln zu- und abschalten. **Das ist kein Regler im
Sinne der Datendisziplin**: der Schalter verändert keine Zahl, sondern nur, was
sichtbar ist. Die einzige freie Variable bleibt der Kalendertag.

## Prüfbefehl

```
python scripts/fetch-netz.py            # alle drei Ebenen, mehrere Minuten
python scripts/validate.py              # 123 Pruefungen
python scripts/validate.py --negativtests  # 25 Negativtests
```
