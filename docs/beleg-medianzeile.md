# Die Einordnungszeilen der Kacheln — Beleg

Gebaut am 15.09.2026. Reihe: `data/vergleichsreihe.json`, erzeugt von
`scripts/vergleichsreihe.py`. Angezeigt von `medianSatz()` und `eeRangSatz()`
in `assets/powerflow.js`.

Zwei Kacheln tragen seitdem eine zweite Bezugszeile:

> **Netzlast** — Gerechnet: 4,8 % unter dem Median derselben Kalendertage
> — 12 vollständige Jahre, 9.046,2 GWh
>
> **Erneuerbare** — Gerechnet: vierthöchster Wert dieser Kalendertage in
> 12 Jahren — Spanne 30,7 % bis 57,3 %

## Woher sie kommt

Sie ist der Rest eines größeren Entwurfs. Am 15.09.2026 stand dieselbe Frage
schon einmal auf der Seite — als eigener Abschnitt mit vier Balkenreihen über
zwölf Jahre. Er ist gebaut, angesehen und verworfen worden: 48 Säulen für zwei
Zahlen. Die Begründung steht in `docs/beleg-mehrjahresvergleich.md`, und dort
steht auch, was stattdessen zu tun sei — genau das hier: *eine Zahl, dort wo
die Kennzahl ohnehin steht.*

## Zwei Kacheln, zwei verschiedene Zahlen

| Kachel | Zeile | warum diese |
|---|---|---|
| **Netzlast** | Abstand zum **Median** derselben Kalendertage | flach über zwölf Jahre; der Median ist dort ein tragfähiger Bezug |
| **Erneuerbare** | **Rang** und **Spanne** derselben Kalendertage | stark steigend; ein Median misst dort überwiegend den Zubau |

### Warum die Erneuerbaren keinen Median bekommen

Gemessen über das Fenster 8.–14. September, Anteil an der Netzlast:

| | | | |
|---|---|---|---|
| 2015 | 30,7 % | 2021 | 34,6 % |
| 2016 | 33,1 % | 2022 | 38,3 % |
| **2017** | **55,9 %** | 2023 | 40,1 % |
| 2018 | 36,8 % | 2024 | 53,7 % |
| 2019 | 39,0 % | 2025 | 57,3 % |
| 2020 | 45,2 % | **2026** | **53,4 %** |

Der Median liegt bei 39,5 %, der Abstand wäre **+13,9 Prozentpunkte**. Diese
Zahl sagt fast nur „Ausbau seit 2015", nicht „diese Woche war windig".

**Der Beweis steht in der Tabelle selbst: 2017 liegt mit 55,9 % über 2026.**
Eine windige Woche vor neun Jahren schlägt eine normale heute. Wer den Median
als Wetterbefund liest, liest den Zubau.

Ein **Rang** kommt ohne jede Annahme über den Trend aus — er sagt genau, was
er sagt: *„der vierthöchste Wert dieser Kalendertage in 12 Jahren"*. Die
**Spanne** gibt den Rahmen und schließt den angezeigten Wert ein; sonst läge
eine Rekordwoche außerhalb ihrer eigenen genannten Spanne.

Ein Median der letzten fünf Jahre wäre die dritte Möglichkeit gewesen. Er ist
verworfen worden: die Fünf ist gesetzt und nicht gemessen, und sie verdeckt,
dass 2022 und 2023 noch bei 38 bis 40 % lagen.

### Das eigene Jahr zählt sich nicht selbst

Die erste Fassung sortierte den angezeigten Wert in die Liste **aller**
vollständigen Jahre ein — einschließlich des eigenen. Ergebnis: „fünfthöchster
Wert", wo vier richtig ist.

Der Grund ist ein Haar: der angezeigte Anteil kommt aus der Jahresdatei in
voller Genauigkeit, die Vergleichsreihe ist auf ganze MWh gerundet. Beide Wege
enden bei derselben **angezeigten** Zahl, aber nicht bei demselben
Gleitkommawert — und das eigene Jahr zählte sich dadurch knapp als „größer".

Verglichen wird deshalb gegen die **anderen** Jahre. Das ist ohnehin die
richtige Frage: ein Wert ist nicht größer als er selbst.

Der Browsertest rechnet den Rang seitdem **unabhängig nach** — aus
`data/vergleichsreihe.json`, mit einer eigens dafür geschriebenen Arithmetik,
und vergleicht das Ergebnis mit dem Wort in der Kachel. Genau das hätte den
Fehler gemeldet.

## Und warum die übrigen Kacheln keine Zeile bekommen

| Kennzahl | Einordnung? | Grund |
|---|---|---|
| **Netzlast** | **Median** | läuft glatt durch, kein Erfassungsbruch, kein starker Trend |
| **Erneuerbare** | **Rang + Spanne** | kein Erfassungsbruch (der Nenner ist die Netzlast), aber starker Trend |
| Erzeugung | nein | Erdgas hat 2018 einen Erfassungsbruch: +68 % bei SMARD, −4,9 % bei Eurostat. 56 % des Anstiegs 2017→2018 entfallen auf diese eine Reihe. Beleg: `beleg-bilanzrest.md` |
| Residuallast | nicht gebaut | es gibt keine eigene Kachel dafür |
| Import, Export, Außensaldo | nein | über dieselbe Kalenderwoche 220 % Streuung, beim Saldo mit Vorzeichenwechsel — eine Prozentangabe zum Median verspricht dort mehr, als sie hält |

Zwei Größen, die man vergleichen darf, sind besser als sechs, die man erklären
muss.

## Warum eine eigene Datei

Die Zeile braucht Tageswerte aus **allen** Jahren. Die Seite lädt sonst nur
zwei (laufendes Jahr und Vorjahr).

| | Größe |
|---|---|
| alle zwölf Jahresdateien `data/tage/` | **2,99 MB** |
| `data/vergleichsreihe.json` | **65 kB** (gemessen) |

Die Datei führt genau zwei Größen: die tägliche Netzlast und die tägliche Summe
der sechs erneuerbaren Reihen, beide in MWh, auf ganze MWh gerundet, als flache
Felder ab dem ersten Tag. Dazu die Namen der sechs Reihen — `validate.py`
vergleicht sie mit `EE_REIHEN` im Modul, damit die Kachel nicht einen anderen
Anteil zeigt als die Kennzahl darüber.

**Der Rundungsfehler ist ausgerechnet, nicht geschätzt:** höchstens 0,5 MWh je
Tag. Bei rund 1.200.000 MWh am Tag sind das 4 Hundertmillionstel. Die Kachel
zeigt eine Nachkommastelle in GWh — der Fehler liegt fünf Größenordnungen
darunter.

`scripts/vergleichsreihe.py` ist **reine Rechnung ohne Netzzugriff**; es liest
die vorhandenen Jahresdateien. Im Workflow läuft es nach dem Abruf und vor dem
Türsteher.

## Drei Regeln in der Rechnung

1. **Nur vollständig belegte Jahre.** Ein halb belegtes Jahr hat eine kleinere
   Summe, und das ist keine Aussage über den Verbrauch — dieselbe Regel wie im
   CSV-Abzug. Deshalb steht die Zahl der Jahre **in der Zeile**: eine
   Abweichung vom Median aus drei Jahren ist etwas anderes als eine aus zwölf,
   und wer das nicht sieht, kann es nicht beurteilen.
2. **Unter drei vollständigen Jahren erscheint die Zeile nicht.** Ein „Median"
   aus zwei Werten ist ihr Mittelwert, und ein Rang unter zwei Jahren sagt
   nichts.
3. **Der 29. Februar** wird in Nicht-Schaltjahren auf den 28. gelegt —
   dieselbe Regel wie beim Vorjahresvergleich (`tagImJahr()`).

Die Reihe wird **über den Kalender** gebaut, nicht über die vorhandenen
Schlüssel: ein fehlender Tag steht als `null` darin. Verkürzte man sie,
verschöbe sich alles dahinter um einen Tag, und der Vergleich träfe
stillschweigend den falschen Kalendertag.

Die Stelle eines Tages wird **über UTC** gerechnet. Eine Differenz in Ortszeit
verliert an den Umstellungstagen eine Stunde und rundet dann auf den falschen
Tag.

## Sie ist eine Rechnung und sagt es

Das Wort „gerechnet" steht in der Zeile, sie ist leiser gesetzt als die
Messzeile darüber, und das Info-Popover der Kachel erklärt die Rechnung samt
ihren drei Regeln. Der Vorjahresvergleich darüber bleibt, was er ist: ein
realer Messwert.

## Was geprüft wird

`scripts/validate.py`:

- die Reihe ist so lang wie der Kalender von `von` bis `bis`
- sie beginnt am 01.01.2015
- **beide** Reihen stimmen mit den Jahresdateien überein (Stichprobe, auf 1 MWh)
- die sechs erneuerbaren Reihennamen sind in Modul und Datei dieselben
- `medianSatz`, `eeRangSatz` und `vergleichsreihe.json` sind verdrahtet, und
  das Kalenderfenster wird an genau einer Stelle gerechnet (`fenstersummen`)
- vier Negativtests: ein verstellter Wert, eine fehlende EE-Reihe, und je eine
  entfernte Zeile

`scripts/browsertest.mjs`:

- die Medianzeile steht in der Netzlast-Kachel, nennt Prozent, Jahreszahl und
  Medianwert
- die Rangzeile steht in der Erneuerbare-Kachel, nennt Rang und Spanne und
  **ausdrücklich keinen Median**
- genau **zwei** Kacheln tragen eine Einordnungszeile; die Erzeugung hat keine
- **der Rang wird unabhängig nachgerechnet** — aus der rohen Reihe, mit einer
  eigens dafür geschriebenen Arithmetik

Beim Schreiben dieser Prüfung ist eine alte Falle des Projekts wieder
zugeschnappt: in einem Template-Literal zerfällt `\.` zu `.`, aus `/\./g`
wird `/./g`, das löscht die ganze Zeichenkette, `parseFloat` liefert `NaN` —
und der nachgerechnete Rang war stumm eins. `split`/`join` kommt ohne
Backslash aus.
