# Die Medianzeile der Netzlast-Kachel — Beleg

Gebaut am 15.09.2026. Reihe: `data/vergleichsreihe.json`, erzeugt von
`scripts/vergleichsreihe.py`. Angezeigt von `medianSatz()` in
`assets/powerflow.js`.

Die Kachel „Netzlast" trägt seitdem eine zweite Bezugszeile:

> **6,3 % unter dem Median derselben Kalendertage in 12 vollständigen Jahren
> (9.031,8 GWh) — gerechnet**

## Woher sie kommt

Sie ist der Rest eines größeren Entwurfs. Am 15.09.2026 stand dieselbe Frage
schon einmal auf der Seite — als eigener Abschnitt mit vier Balkenreihen über
zwölf Jahre. Er ist gebaut, angesehen und verworfen worden: 48 Säulen für zwei
Zahlen. Die Begründung steht in `docs/beleg-mehrjahresvergleich.md`, und dort
steht auch, was stattdessen zu tun sei — genau das hier: *eine Zahl, dort wo
die Kennzahl ohnehin steht.*

## Nur die Netzlast — und warum

Sie ist die **einzige große Kennzahl dieser Seite, die über zwölf Jahre ohne
Vorbehalt vergleichbar ist.**

| Kennzahl | Median über alle Jahre? | Grund |
|---|---|---|
| **Netzlast** | **ja** | läuft glatt durch, kein Erfassungsbruch |
| Erzeugung | nein | Erdgas hat 2018 einen Erfassungsbruch: +68 % bei SMARD, −4,9 % bei Eurostat. 56 % des Anstiegs 2017→2018 entfallen auf diese eine Reihe. Beleg: `beleg-bilanzrest.md` |
| Residuallast | nicht gebaut | es gibt keine eigene Kachel dafür |
| Import, Export, Außensaldo | nein | über dieselbe Kalenderwoche 220 % Streuung, beim Saldo mit Vorzeichenwechsel — eine Prozentangabe zum Median verspricht dort mehr, als sie hält |

Eine Größe, die man vergleichen darf, ist besser als vier, die man erklären
muss.

## Warum eine eigene Datei

Die Zeile braucht Tageswerte aus **allen** Jahren. Die Seite lädt sonst nur
zwei (laufendes Jahr und Vorjahr).

| | Größe |
|---|---|
| alle zwölf Jahresdateien `data/tage/` | **2,99 MB** |
| `data/vergleichsreihe.json` | **35 kB** (gemessen) |

Die Datei führt genau eine Größe: die tägliche Netzlast in MWh, auf ganze MWh
gerundet, als flaches Feld ab dem ersten Tag.

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
   aus zwei Werten ist ihr Mittelwert.
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
- ihre Werte stimmen mit den Jahresdateien überein (Stichprobe, auf 1 MWh)
- `medianSatz` und `vergleichsreihe.json` sind im Modul verdrahtet
- ein Negativtest verstellt einen Wert der Reihe

`scripts/browsertest.mjs`: die Zeile steht in der Netzlast-Kachel, nennt
Prozent, Jahreszahl und Medianwert — und **nur dort**, nicht in einer anderen
Kachel.
