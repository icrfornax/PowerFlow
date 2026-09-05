# Lastprognose und Vorschau — Beleg

Erschlossen am 05.09.2026. Quelle: ENTSO-E Transparency Platform.
Abrufskript `scripts/fetch-lastprognose.py`.

## Was gesucht war und was es nicht gab

Gesucht war eine **Vorschau**: Prognosen, Börsenpreise, Ausschreibungen. Drei
Wege wurden geprüft, zwei tragen nicht:

| Weg | Befund am 05.09.2026 |
|---|---|
| `netztransparenz /data/prognose/{Wind,Solar}` | Zeilen kommen, **alle Wertespalten leer** (`;;;;`). Für zurückliegende Tage steht überall `N.A.` |
| `netztransparenz /data/Spotmarktpreise` | funktioniert, aber **erst rund einen Monat später**: Juli 2026 liefert 192 Werte, August 2026 nichts. Die Doku sagt „bis spätestens 10 WT M+1 für M". Einheit **ct/kWh**, Dezimaltrennzeichen **Komma** |
| ENTSO-E `14.1.D` Wind- und Solarprognose | steht **nicht** auf der Freigabeliste, also nicht frei weiterverwendbar |

Was trägt, ist die **Lastprognose**: ENTSO-E `6.1.B`, Datenpunkt 1 der *List of
Data available for free re-use* und damit CC BY 4.0.

## Der Rohabruf

```
GET https://web-api.tp.entsoe.eu/api
    ?documentType=A65&processType=A01     (6.1.B  Day-ahead-Prognose)
    ?documentType=A65&processType=A16     (6.1.A  gemessene Last)
    &outBiddingZone_Domain=10Y1001A1001A82H
```

**Aus den Daten belegt, nicht aus der Doku übernommen:**

- Beide Reihen in **PT15M**, Einheit **`MAW`** — Megawatt, also **Leistung**.
  Energie je Viertelstunde ist Leistung mal 0,25 h. Wer MAW als MWh liest, ist
  um den Faktor vier daneben. Das Abrufskript **bricht ab**, wenn die Einheit
  jemals etwas anderes ist.
- **Die Reihe beginnt 2019.** Für 2015 und 2017 antwortet die Plattform mit
  „No matching data found".
- **Die Vorschau reicht genau einen Tag.** Für morgen kommen Werte, für
  übermorgen nicht — und sie wächst im Lauf des Tages, weil sie erst nach der
  Day-ahead-Auktion vollständig ist.
- Eine Abfrage darf höchstens rund einen Monat umfassen; 92 Tage werden mit
  HTTP 400 abgewiesen. Deshalb wird monatsweise gefragt.

Die längeren Horizonte gibt es auch — `6.1.C` week-ahead (P1D), `6.1.D`
month-ahead und `6.1.E` year-ahead (je P7D, als Minimum und Maximum). Sie sind
geprüft und liefern, werden aber noch nicht gezeigt: sie sind eine andere
Größe (Bandbreite statt Verlauf) und gehören in einen eigenen Block.

## Warum gegen 6.1.A verglichen wird und nicht gegen SMARD

Der Fehler wird gegen die **Messung derselben Quelle** gerechnet, nicht gegen
die Netzlast aus SMARD. Sonst mischte man zwei verschieden erhobene Reihen und
maß am Ende deren Unterschied mit — genau die Falle, die bei der Untersuchung
des Bilanzrests sichtbar geworden ist.

`6.1.A` wird deshalb **nicht veröffentlicht** — es steht nicht auf der
Freigabeliste. In die Datei geht nur die Prognose und die daraus gerechnete
Abweichung.

## Was gerechnet wird

Je Kalendertag in Ortszeit:

| Feld | Bedeutung |
|---|---|
| `prognose_mwh` | Summe der Day-ahead-Prognose über den Tag |
| `mape_prozent` | mittlerer **absoluter** Fehler je Viertelstunde, in Prozent der Messung |
| `abweichung_mwh` | Prognose minus Messung über den Tag |
| `punkte` | wie viele Viertelstunden in beide Reihen fielen |

**Der mittlere absolute Fehler ist aus Tagessummen nicht zu bilden** — zu hohe
und zu niedrige Viertelstunden heben sich darin auf. Deshalb steht er in der
Datei und wird nicht in der Anzeige gerechnet. Auf der Seite steht beides
nebeneinander, mit dem Satz, warum die Tagessumme kleiner ist.

## Gemessen

| Jahr | mittlerer absoluter Fehler | Tage mit Vergleich |
|---|---|---|
| 2019 | 4,20 % | 365 |
| 2020 | 3,26 % | 366 |
| 2021 | 3,98 % | 365 |
| 2022 | 4,13 % | 350 |
| 2023 | 3,77 % | 362 |
| 2024 | 3,74 % | 361 |
| 2025 | 3,70 % | 365 |
| 2026 (bis 05.09.) | 4,20 % | 248 |

Die Ankündigung liegt also im Mittel um rund **vier Prozent** neben der
Messung — je Viertelstunde, nicht je Tag.

## Prüfungen

- `fetch-lastprognose.py` **bricht ab**, wenn die Einheit nicht `MAW` ist.
- Tage außerhalb des Jahres werden gefiltert: der Monatsblock beginnt in UTC
  und reicht in Ortszeit über die Jahresgrenze. Ohne den Filter stünde der
  1. Januar des Folgejahres in der Datei des Vorjahres.
- `browsertest.mjs`: die angekündigte Last wird gezeichnet, der morgige Tag ist
  abgesetzt, sie ist ausdrücklich als **Ankündigung** benannt, drei Kennzahlen
  zur Güte, ein Balken je Tag, der Maßstab ist genannt, und es steht da, dass
  der Fehler absolut gerechnet ist und warum die Tagessumme kleiner ausfällt.
