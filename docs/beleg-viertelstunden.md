# Viertelstundenwerte — Beleg

Erschlossen am 14.09.2026. Abruf: `scripts/fetch-viertelstunden.py` über
`scripts/smard.py`. Ziel: `data/viertelstunden/JJJJ-MM-TT.json`, Verzeichnis
`data/viertelstunden-verzeichnis.json`.

Der offene Punkt „Viertelstundenwerte" stand seit dem 31.08.2026 auf der Seite,
und zwar mit einer Begründung, die **falsch gerechnet war**. Sie wird unten
ausdrücklich zurückgenommen.

## Der Rohabruf

Derselbe Endpunkt wie für die Stundenwerte, nur mit der Auflösung
`quarterhour` statt `hour`:

```
https://www.smard.de/app/chart_data/410/DE/index_quarterhour.json
https://www.smard.de/app/chart_data/410/DE/410_DE_quarterhour_<block>.json
```

**Die Blockliste ist identisch mit der stündlichen.** Gemessen:

| | Blöcke | erster | letzter | gleich? |
|---|---|---|---|---|
| `index_hour` | 612 | 1419807600000 | 1789336800000 | |
| `index_quarterhour` | 612 | 1419807600000 | 1789336800000 | **ja** |

Ein Block ist eine Woche ab Montag 00:00 Ortszeit und enthält 672 Punkte
(7 × 96). Damit gilt für den Abruf dieselbe Mechanik wie bei
`fetch-verlauf.py`; es ist keine zweite Blocklogik entstanden.

## Welche Reihen antworten

Stichprobe über den Block ab 31.08.2026, alle mit 672 von 672 belegten Punkten:

- Netzlast (Filter 410)
- alle elf Erzeugungsreihen außer Kernenergie
- Großhandelspreis Day-Ahead (Filter 4169)
- alle 22 Außenhandelsreihen (elf Länder × zwei Richtungen) — **keine einzige
  ohne Antwort**

**Kernenergie endet, wie sie muss.** Geprüft an vier Blöcken:

| Woche ab | Antwort |
|---|---|
| 05.06.2017 | 672 Punkte |
| 06.06.2022 | 672 Punkte |
| 17.04.2023 | 672 Punkte |
| 03.06.2024 | **HTTP 404** |

Das ist die Abschaltung der letzten Kraftwerke am 15.04.2023 und kein
Abruffehler. `smard.py` unterscheidet beides seit jeher über die eigene
Ausnahme `Nichtvorhanden`; das Skript lässt eine solche Reihe **weg**, statt
sie mit Nullen zu füllen. Eine fehlende Reihe ist keine Erzeugung von null.

**Die Reichweite reicht bis 2015.** Netzlast, Stichprobe:

| Woche ab | Punkte | belegt |
|---|---|---|
| 05.01.2015 | 672 | 672 |
| 05.06.2017 | 672 | 672 |
| 02.03.2020 | 672 | 672 |
| 17.04.2023 | 672 | 672 |
| 29.09.2025 | 672 | 672 |

## Die Einheit — aus den Daten bewiesen

Die entscheidende Frage, und sie wird **nicht** aus der Dokumentation
übernommen: Sind die Werte Leistung (MW) oder Arbeit je Intervall (MWh)?

Der Beweis ist eine Gegenprobe gegen die Stundenreihe **derselben Quelle**: die
Summe der vier Viertelstunden einer Stunde muss den Stundenwert treffen.

| Reihe | geprüfte Stunden | größte Abweichung |
|---|---|---|
| Netzlast | 48 | 0,0100 MWh |
| Braunkohle | 48 | 0,0200 MWh |
| Wind Offshore | 48 | 0,0100 MWh |

Das ist Rundung. **Die Werte sind MWh je Viertelstunde, also Arbeit.**

Als Leistung gelesen läge alles um den Faktor vier daneben — genau dieser
Fehler ist am 05.09.2026 bei der Vorschau auf morgen passiert („272 GWh, Spitze
16 GW"). Deshalb rechnet `fetch-viertelstunden.py` diese Probe **bei jedem
Lauf** nach und bricht ab, wenn die Abweichung über 1 MWh steigt.

Für die Anzeige in GW gilt damit: `MWh je Viertelstunde ÷ 0,25 h = MW`, also
Teiler 250 statt 1000. Steht als Kommentar an der Stelle in `powerflow.js`.

## DER PREIS IST VOR DEM 01.10.2025 KEIN VIERTELSTUNDENWERT

SMARD liefert die Preisreihe durchgehend viertelstündlich — aber davor ist es
der **viermal wiederholte Stundenpreis**. Gemessen über die Vierergruppen: wie
viele sind in sich identisch?

| Woche ab | Werte | Gruppen identisch | Beispiel |
|---|---|---|---|
| 03.06.2024 | 672 | **168/168 (100 %)** | `[99.05, 99.05, 99.05, 99.05]` |
| 02.06.2025 | 672 | **168/168 (100 %)** | `[57.47, 57.47, 57.47, 57.47]` |
| **29.09.2025** | 672 | **48/168 (29 %)** | die Umstellungswoche |
| 06.10.2025 | 672 | **0/168 (0 %)** | `[114.69, 104.8, 95.23, 87.39]` |
| 07.09.2026 | 576 | **0/144 (0 %)** | `[161.55, 152.78, 141.4, 124.35]` |

Die 48 identischen Gruppen der Umstellungswoche sind genau zwei Tage
(2 × 24 Stunden): der 29. und 30. September liefen noch stündlich, ab dem
1. Oktober viertelstündlich.

Über den ganzen geholten Bestand (624 Tage) bestätigt:

| | Tage | von | bis |
|---|---|---|---|
| Preis stündlich (wiederholt) | 275 | 2024-12-30 | **2025-09-30** |
| Preis viertelstündlich | 348 | **2025-10-01** | 2026-09-14 |
| ohne Preis | 1 | 2026-09-13 | (Meldeverzug der Quelle) |

**Das bestätigt aus einer zweiten, unabhängigen Richtung**, was in
`docs/beleg-entsoe-datenpunkte.md` über die ENTSO-E-Reihe steht: Sequence 1
wechselte am 01.10.2025 von PT60M auf PT15M. Dort binär eingegrenzt über die
Transparency Platform, hier über SMARD — zwei verschiedene Endpunkte, derselbe
Tag.

Konsequenz für die Seite: das Feld `preis_viertelstuendlich` steht in **jeder**
Tagesdatei und wird **gemessen**, nicht aus dem Datum abgeleitet — eine
Schwelle, die man hinschreibt, veraltet still. Die Legende beschriftet die
Preiskurve danach; im viertelstündlichen Bild eines früheren Zeitraums steht
ausdrücklich „STUNDENWERTE". Drei Zustände, nicht zwei: `true`, `false` und
`null` für „keine Preise" — der jüngste Tag hat oft noch keinen.

## Warum Tagesdateien

Die Seite zeigt Viertelstunden für **höchstens zwei Tage** — 192 Punkte,
dieselbe Lesbarkeitsgrenze, an der die Stundenkurve bei sieben Tagen (168
Punkte) endet.

| Zuschnitt | Größe | für einen Tag Anzeige geladen |
|---|---|---|
| Monatsdatei | rund 400 kB | 400 kB |
| **Tagesdatei** | **13,1 kB** (gemessen) | **13 kB** |

Dreißigmal so viel für dieselbe Auskunft. Deshalb Tagesdateien.

## ZURÜCKGENOMMEN: „48 statt 12 MB, die jeder Besucher mitlädt"

So stand der offene Punkt seit dem 31.08.2026 auf der Seite. Die Zahl ist
falsch, und zwar nicht knapp:

**Niemand lädt den ganzen Bestand.** Weder die 14 MB Stundenwerte noch die
8,8 MB Viertelstundenwerte. `data/verlauf/` sind 141 Monatsdateien, und ein
Seitenaufruf holt die ein bis zwei, die der gewählte Zeitraum berührt.
Gemessen wird, was **ein Seitenaufruf** kostet — nicht, was im Repository
liegt.

Der Fehler ist der klassische: eine Gesamtgröße als Ladelast ausgegeben. Er
hat einen sinnvollen Ausbau ein Vierteljahr lang blockiert.

**Was bleibt**, ist eine andere Frage — die Reichweite. Geholt sind bisher
2025 und 2026 (624 Tage, 8,8 MB). Die volle Historie ab 2015 wären rund 55 MB
im Repository und rund 21.400 Abrufe. Das ist eine Entscheidung über die Größe
des Repositorys und keine Messfrage; sie steht als offener Punkt auf der Seite,
mit diesen gemessenen Zahlen statt mit einer Schätzung.

## Zeit

Marken sind lokal (Europe/Berlin), Format `JJJJ-MM-TTTHH:MM`. Geschlüsselt wird
über den **Zeitstempel**, nie über die Marke — am Tag der Rückstellung gibt es
02:00 bis 02:45 zweimal. Derselbe Fehler hat in den Stundenwerten schon einmal
elf Oktobertagen je eine Stunde gekostet (`docs/beleg-verlauf.md`).

Gemessen über die 624 geholten Tage — alle Abweichungen von 96 Marken sind
erklärt:

| Tag | Marken | Grund |
|---|---|---|
| 2025-03-30 | 92 | Umstellung auf Sommerzeit, 23 Stunden |
| 2025-10-26 | 100 | Rückstellung, 25 Stunden |
| 2026-03-29 | 92 | Umstellung auf Sommerzeit |
| 2026-09-14 | 88 | laufender Tag, Abruf um 22:41 |

Alle übrigen 620 Tage haben genau 96. `validate.py` prüft das je Datei.

## Zähler, die jemand prüft

- `auffaellig` je Tagesdatei: Außenhandelswerte außerhalb 0 bis 5.000 MWh je
  Viertelstunde. Sie werden als **fehlend** geführt, nicht korrigiert; der
  Originalwert bleibt sichtbar. Der Lauf bricht ab, sobald mehr als 20
  auffallen. Über die 624 Tage: **null**.
- Die Einheitenprobe (oben) bricht bei mehr als 1 MWh Abweichung ab.
- Das Verzeichnis wird **aus dem Ordner** gebaut, nie aus dem Lauf — die Lehre
  vom 06.09.2026, als ein aus dem Lauf gebautes Verzeichnis zehn Jahre auf
  zwei gekürzt hätte. `validate.py` prüft „Verzeichnis gleich Ordner".

## Lizenz

CC BY 4.0, Namensnennung `Bundesnetzagentur | SMARD.de` — dieselbe Quelle und
dieselbe Lizenz wie die Stunden- und Tageswerte. Keine achte Lizenz.
