# Was in den Erzeugungsreihen fehlt — und ab welcher Größe

Untersucht am 07.09.2026. Die Frage stammt aus der Untersuchung des
Bilanzrests (`docs/beleg-bilanzrest.md`): dort ist gemessen, **dass** in den
veröffentlichten Erzeugungsreihen etwas fehlt — über 4.267 Tage liegt
Erzeugung + Einfuhr − Ausfuhr um 3,45 % unter der Netzlast. Offen blieb,
**welche Anlagen** fehlen und **ab welcher Größe**.

Beides ist jetzt beantwortet, und es sind zwei verschiedene Ursachen.

## Befund 1: Die Kraftwerksliste hat eine harte Kante bei 10,0 MW

Aus `data/kraftwerke.json`, 596 Anlagen:

- kleinste geführte Anlage: **10,0 MW**
- darunter: **nichts**
- 5 %-Quantil 10,8 MW, Median 29,1 MW, größte 2.470 MW

Das ist keine weiche Verteilung, die unten ausläuft, sondern ein Schnitt.

## Befund 2: Oberhalb der Kante ist die Liste vollständig

Gegen das Marktstammdatenregister geprüft — installierte Nettonennleistung
„In Betrieb", nur Einheiten ab 10 MW:

| Träger | SMARD-Liste | MaStR ≥ 10 MW | Differenz |
|---|---|---|---|
| Steinkohle | 15,19 GW | 15,00 GW | +0,19 |
| Braunkohle | 15,30 | 14,70 | +0,59 |
| Biomasse | 1,05 | 0,99 | +0,06 |
| Wasser | 3,43 | 2,45 | +0,98 |
| Mineralölprodukte | 2,66 | 2,78 | −0,12 |
| Erdgas | 31,06 | 28,25 | +2,82 |

Die Abweichung bei Erdgas passt der Größenordnung nach zu den 15 Anlagen mit
4,47 GW, die in Luxemburg, Österreich und der Schweiz stehen und trotzdem zu
den deutschen Regelzonen gehören (siehe CLAUDE.md). Bei Wasser trennen die
beiden Quellen Laufwasser und Pumpspeicher unterschiedlich.

**Über 10 MW fehlt also nichts.** Die Kante ist die einzige Grenze der Liste.

## Befund 3: Wie viel Leistung unter der Kante liegt

Aus dem Gesamtdatenexport des Marktstammdatenregisters, Einheiten „In
Betrieb". Gelesen wurden drei Archivmitglieder über HTTP-Range —
**24,2 MB von 3,18 GB**:

| Träger | gesamt | unter 10 MW | Anteil | davon unter 1 MW |
|---|---|---|---|---|
| Erdgas | 34,42 GW | 6,17 GW | 18 % | 2,40 GW |
| **Biomasse** | 8,88 | **7,89** | **89 %** | 6,07 |
| Mineralölprodukte | 7,24 | 4,46 | 62 % | 1,42 |
| **Wasser** | 5,34 | **2,89** | **54 %** | 0,76 |
| nicht biogener Abfall | 2,02 | 0,28 | 14 % | 0,01 |
| **Steinkohle** | 15,06 | **0,06** | **0 %** | 0,00 |
| **Braunkohle** | 14,77 | **0,07** | **0 %** | 0,00 |
| Summe | 91,82 | 22,36 | 24 % | |

Ein Viertel der Verbrennungs-, Biomasse- und Wasserkraftleistung liegt unter
der Schwelle. Bei Biomasse sind es neun Zehntel.

## Befund 4: Die Lücke je Träger — und der Kontrollfall

Erzeugung 2024, SMARD gegen Eurostat (brutto), aus `data/gegenprobe.json`:

| Träger | SMARD | Eurostat | Lücke | Leistung unter 10 MW |
|---|---|---|---|---|
| Erdgas | 56,9 TWh | 90,5 | **−37,1 %** | 18 % |
| Biomasse | 36,2 | 52,4 | −31,0 % | 89 % |
| Wasserkraft | 17,6 | 23,8 | −26,3 % | 54 % |
| Steinkohle | 27,3 | 36,4 | −24,8 % | **0 %** |
| Photovoltaik | 63,1 | 75,4 | −16,2 % | (nicht erhoben) |
| **Braunkohle** | 71,0 | 78,9 | **−10,0 %** | **0 %** |
| **Wind** | 138,2 | 138,9 | **−0,5 %** | — |

**Braunkohle ist der Kontrollfall.** Keine einzige Anlage unter der Schwelle,
die Liste vollständig — und trotzdem 10,0 % Lücke. Das ist der Unterschied
zwischen brutto und netto: der Eigenverbrauch der Kraftwerke selbst, den
Eurostat mitzählt und SMARD nicht. **Wind** bestätigt es von der anderen
Seite: dort ist brutto praktisch gleich netto, und die Lücke beträgt 0,5 %.

Damit lässt sich die Lücke lesen: rund zehn Prozentpunkte sind bei jedem
thermischen Träger Eigenverbrauch. Was darüber hinausgeht, ist Erzeugung, die
in der Reihe nicht auftaucht.

## Der Schluss — zwei Ursachen, nicht eine

**Erstens die Größe.** Wo viel Leistung unter 10 MW liegt, ist die Lücke groß:
Biomasse (89 % der Leistung darunter, −31 %), Wasserkraft (54 %, −26 %),
Erdgas (18 %, aber 6,2 GW absolut, −37 %). Das sind Blockheizkraftwerke,
Biogasanlagen und kleine Laufwasserkraftwerke.

**Zweitens die Eigenerzeugung der Industrie.** Steinkohle bricht das
Größenmuster: null Leistung unter der Schwelle, Liste vollständig — und
trotzdem 24,8 % Lücke, also rund 15 Prozentpunkte über dem Eigenverbrauch.
Diese Erzeugung stammt aus Kraftwerken, die zu Stahl- und Chemiewerken
gehören. Ihre Leistung steht in der Liste, ihre Erzeugung nicht in der
Einspeisereihe — sie erreicht das Netz der allgemeinen Versorgung nicht.

Das passt zu den Definitionen, die beide Quellen selbst angeben und die schon
in `data/gegenprobe.json` stehen: SMARD ist die *„Einspeisung ins öffentliche
Netz (netto)"*, Eurostat die *„gesamte Erzeugung in Deutschland, brutto
einschließlich Kraftwerkseigenverbrauch"*.

## Was NICHT trägt — ein geprüfter Irrweg

Das Marktstammdatenregister führt ein Feld `Einspeisungsart` mit zwei Werten:
*Volleinspeisung* (12.792 Verbrennungseinheiten) und *Teileinspeisung
einschließlich Eigenverbrauch* (80.430). Es lag nahe, damit die
Industrieerzeugung abzugrenzen.

**Das trägt nicht.** Braunkohle steht zu 83 % der Leistung auf
„Teileinspeisung" und wird von SMARD trotzdem praktisch vollständig erfasst —
die Lücke beträgt dort genau den Eigenverbrauch. Das Feld unterscheidet also
nicht zwischen „speist ins öffentliche Netz" und „speist nicht", und wer es
dafür benutzt, bekommt eine Zahl ohne Bedeutung. Der Versuch steht hier,
damit ihn niemand ein zweites Mal unternimmt.

## Was offen bleibt

Der Anteil der industriellen Eigenerzeugung lässt sich mit den hier
verfügbaren Quellen **nicht beziffern**. Er ergibt sich als Rest, nachdem
Schwelle und Eigenverbrauch abgezogen sind — und ein Rest ist keine Messung.
Dafür bräuchte es die Erhebung der industriellen Kraftwerke, etwa über die
amtliche Statistik der Elektrizitätsversorgung.

Die Photovoltaik ist in Befund 3 nicht enthalten: ihre Einheiten liegen in
zwanzig Archivmitgliedern mit zusammen über 360 MB gepackt, und der Fall ist
ohnehin klar — es gibt kaum PV-Anlagen über 10 MW, und ein großer Teil der
Erzeugung wird hinter dem Zähler selbst verbraucht und erreicht die Netzlast
nie.
