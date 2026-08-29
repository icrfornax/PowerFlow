# Beleg: SMARD-Zeitreihen für Last und Erzeugung

Stand: 30.08.2026. Zuständiger Skill: `datenquellen-strom`.
Belegtag: **Mittwoch, 19.08.2026**, Region `DE` und die vier Regelzonen.

## Endpunkte

Geprüft gegen `bundesAPI/smard-api` (`openapi.yaml`) und gegen das
SMARD-Frontend-Bundle, in dem die URL-Bildung wörtlich steht:

```js
`/app/chart_data/${t}/${e}/${t}_${e}_${i}_${n}.json`
`/app/chart_data/${t}/${e}/index_${i}.json`
```

- Index: `https://www.smard.de/app/chart_data/{filter}/{region}/index_{resolution}.json`
- Reihe: `https://www.smard.de/app/chart_data/{f}/{r}/{f}_{r}_{resolution}_{timestamp}.json`

`resolution` ∈ `hour, quarterhour, day, week, month, year`.
`region` ∈ `DE, AT, LU, DE-LU, DE-AT-LU, 50Hertz, Amprion, TenneT, TransnetBW, APG, Creos`.

## Felder der Antwort

| Feld | Bedeutung |
|---|---|
| `meta_data.version` | Versionszähler. Steht bei **allen** geprüften Blöcken auf `1`. |
| `meta_data.created` | Erzeugungszeitpunkt der Datei, Unix-Millisekunden. **Nicht** der Datenstand. |
| `series[i][0]` | Unix-**Millisekunden**, UTC-basiert, Intervall**beginn**. |
| `series[i][1]` | Messwert, `null` bei Lücke. |

Der Index enthält 609 Wochenzeitstempel, Abstand exakt 7,0 Tage, jeder ein
**Montag 00:00 Ortszeit**: der erste 2014-12-29 mit `+01:00`, der letzte
2026-08-24 mit `+02:00`. Der UTC-Offset wechselt mit der Sommerzeit mit — die
Blockgrenzen sind lokale Tagesgrenzen.

## Einheitennachweis — aus den Daten, nicht aus der Doku

Dieselbe Reihe (Filter 410) in zwei Auflösungen, Woche ab 17.08.2026:

```
Stunde                | h-Wert   | Summe der 4 q | Mittel der 4 q
2026-08-17 08:00 CEST | 54423.17 |      54423.17 |       13605.79
2026-08-17 09:00 CEST | 56860.56 |      56860.57 |       14215.14
2026-08-17 10:00 CEST | 58037.25 |      58037.25 |       14509.31

über alle 168 Stunden:  max |Summe4 − h| = 0.02      max |Mittel4 − h| = 44358.12
```

Der Stundenwert ist die **Summe** der vier Viertelstundenwerte, nicht ihr
Mittel. Der Wert ist damit eine **Energiemenge je Intervall in MWh**, keine
mittlere Leistung. Leistung in MW = Wert / Intervalllänge in Stunden.

Gegenprobe der Größenordnung: 54.423 MWh in einer Stunde = 54,4 GW. Die
Deutung „MW“ ergäbe 13,6 GW und wäre offensichtlich falsch.

## Tagesbilanz 19.08.2026, Region DE

| ID | Energieträger | MWh | Anteil |
|---|---|---:|---:|
| 4067 | Wind Onshore | 270.954,73 | 23,1 % |
| 4068 | Photovoltaik | 244.707,88 | 20,8 % |
| 1223 | Braunkohle | 153.251,98 | 13,0 % |
| 4071 | Erdgas | 147.769,20 | 12,6 % |
| 4069 | Steinkohle | 91.325,14 | 7,8 % |
| 4066 | Biomasse | 90.264,01 | 7,7 % |
| 1225 | Wind Offshore | 67.602,12 | 5,8 % |
| 1227 | Sonstige Konventionelle | 41.382,75 | 3,5 % |
| 1226 | Wasserkraft | 39.058,39 | 3,3 % |
| 4070 | Pumpspeicher | 26.178,72 | 2,2 % |
| 1228 | Sonstige Erneuerbare | 2.154,12 | 0,2 % |
| | **Erzeugung gesamt** | **1.174.649,04** | |
| 410 | **Netzlast** | **1.209.350,65** | |

Netzlast: Mittel 50,39 GW, Spitze 59,88 GW um 08:45, Minimum 40,14 GW um
02:15. PV-Spitze 30,02 GW um 13:00, nachts exakt 0,0.

### Bilanzprobe

```
Erzeugung 1.174,65 + Import 167,16 − Export 131,60 − Netzlast 1.209,35 = +0,86 GWh  (+0,071 %)
```

Die Bilanz schließt. Das beweist zugleich, dass der **Pumpspeicherverbrauch
(26,43 GWh, Filter 4387) in der Netzlast bereits enthalten** ist: zieht man ihn
zusätzlich ab, klafft die Bilanz um rund −2 % auf.

> **Korrektur einer eigenen Fehlrechnung.** Beim ersten Anlauf habe ich den
> Pumpspeicherverbrauch abgezogen und stand bei −2,05 %, ohne die Ursache zu
> prüfen. Erst der Vergleich beider Varianten hat die richtige Lesart gezeigt.
> Die Aussage „Pumpen ist Teil der Netzlast“ ist damit belegt und keine Annahme.

### Selbstkontrolle

`Netzlast − Wind Onshore − Wind Offshore − Photovoltaik = 626,09 GWh`,
identisch mit der von SMARD getrennt gelieferten Residuallast (Filter 4359).
Zwei Reihen, die einander gegenrechnen.

## Regelzonen

Die vier Übertragungsnetzbetreiber sind als `region` eigenständig abrufbar:

| Regelzone | Netzlast | Erzeugung | Saldo |
|---|---:|---:|---:|
| 50Hertz | 271,57 GWh | 339,78 GWh | **+68,20** |
| TenneT | 403,05 GWh | 407,24 GWh | +4,19 |
| Amprion | 377,94 GWh | 292,38 GWh | **−85,56** |
| TransnetBW | 156,78 GWh | 135,25 GWh | **−21,53** |
| **Summe** | **1.209,35** | **1.174,65** | −34,70 |
| Region DE | 1.209,35 | 1.174,65 | −34,70 |
| Abweichung | **0,00** | **0,00** | |

Die vier Zonen summieren sich exakt auf Deutschland.

**Der Saldo ist kein Fluss von einer Zone in eine andere.** Er ist der
Austausch der Zone mit allem — den anderen Regelzonen *und* dem Ausland. Jede
Zone hat eigene Außengrenzen: 50Hertz zu Polen, Tschechien und Dänemark,
Amprion zu den Niederlanden, Belgien, Frankreich und der Schweiz.

Nicht jeder Energieträger existiert in jeder Zone. SMARD liefert dafür **HTTP
404, kein Nullarray**:

- Amprion: Wind Offshore fehlt
- TransnetBW: Braunkohle und Wind Offshore fehlen

Das Abrufskript protokolliert diese Fälle in der Spalte `nicht_vorhanden` der
CSV-Datei, statt sie stillschweigend als Null zu verbuchen.

## Gegenprobe gegen eine fremde Institution

Destatis erhebt eigenständig bei den Betreibern, nicht über ENTSO-E.

| | 2025 |
|---|---:|
| SMARD, Summe der 11 Erzeugungsreihen, Region DE | 437,90 TWh |
| Destatis, „erzeugt und in das Netz eingespeist“ ([PM Nr. 073 vom 06.03.2026](https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/03/PD26_073_43312.html)) | 438,2 TWh |
| **Abstand** | **−0,30 TWh = −0,07 %** |

Die Definitionen passen zueinander: Destatis zählt ausdrücklich nicht mit, was
Industriekraftwerke direkt im Betrieb verbrauchen und was Haushalts-PV selbst
verbraucht — also genau das, was auch nicht im öffentlichen Netz auftaucht.

**Je Energieträger stimmt es nicht**, und das darf nicht unterschlagen werden:

| | SMARD | Destatis | Abstand |
|---|---:|---:|---:|
| Wind (on + off) | 132,96 | 131,3 | +1,3 % |
| Photovoltaik | 73,78 | 70,1 | +5,3 % |
| Kohle (Braun + Stein) | 95,33 | 96,8 | −1,5 % |
| Wasserkraft | 14,18 | 15,8 | −10,3 % |
| Erdgas | 60,55 | 70,6 | **−14,2 %** |
| Biomasse / Biogas | 35,87 | 27,4 | **+30,9 %** |

SMARD folgt der ENTSO-E-Systematik mit der Sammelposition „Sonstige
Konventionelle“, Destatis der Brennstoffstatistik. Eine Trägerzuordnung
SMARD ↔ Destatis ist damit **nicht belegt** und darf nirgends als Bestätigung
auftreten. Der Abgleich trägt nur auf der Summe.

**Menschlicher Maßstab:** 1.209.350,65 MWh ÷ 83,5 Mio. Einwohner
([Destatis, Stichtag 31.03.2026](https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Bevoelkerungsstand/_inhalt.html))
= **14,5 kWh pro Kopf und Tag**. Der Tageswert liegt bei 94,8 % des
Tagesmittels von 2025 — für einen Sommer-Mittwoch plausibel.

## Konsistenzprüfung gegen Energy-Charts — keine Gegenprobe

```
Netzlast      max. Abw. 0.06 MW | Tagessumme SMARD 1209.35 GWh | EC 1209.35 GWh | −0.0000 %
Photovoltaik  max. Abw. 0.06 MW |                  244.71      |    244.71      | +0.0000 %
Wind Onshore  max. Abw. 0.06 MW |                  270.95      |    270.95      | −0.0001 %
Braunkohle    max. Abw. 0.06 MW |                  153.25      |    153.25      | +0.0000 %
```

Wertidentisch bis auf Rundung. Energy-Charts gibt SMARD für Deutschland
unverändert weiter. Als Gegenprobe wertlos, als Konsistenzprüfung nützlich.
Einheit dort **MW** und nicht MWh — sie ist je Endpunkt zu prüfen.

## Nachmeldeverhalten

```
Woche ab 2026-08-17 | version 1 | created 2026-08-24 23:27 |     7 Tage danach
Woche ab 2026-06-08 | version 1 | created 2026-06-25 16:03 |    17 Tage danach
Woche ab 2024-01-08 | version 1 | created 2025-03-11 11:29 |   428 Tage danach
Woche ab 2021-03-08 | version 1 | created 2025-03-11 10:55 | 1.464 Tage danach
Woche ab 2016-05-09 | version 1 | created 2026-05-29 21:54 | 3.672 Tage danach
```

`version` bleibt immer `1`, und `created` liegt selbst bei elf Jahre alten
Wochen im Jahr 2026. **Beide Felder eignen sich nicht, um Nachmeldungen zu
erkennen.** Das Abrufskript muss zurückliegende Tage erneut abrufen und die
Werte selbst vergleichen.

## Kernenergie

Filter `1224` ist korrekt, liefert für aktuelle Wochen aber **HTTP 404**. Der
eigene Index endet 2024-01-29; die letzten echten Werte laufen bis
**15.04.2023 23:45** und fallen dort auf 12,75 MWh. Das Abrufskript muss 404
als „Reihe existiert für diesen Zeitraum nicht“ behandeln und von einem echten
Abruffehler unterscheiden — dafür gibt es in `scripts/smard.py` die eigene
Ausnahme `Nichtvorhanden`.

## Lizenz

CC BY 4.0. Geforderte Namensnennung wörtlich laut
[smard.de/home/datennutzung](https://www.smard.de/home/datennutzung):
**`Bundesnetzagentur | SMARD.de`**. Haftung für Richtigkeit und
Vollständigkeit wird ausgeschlossen.

## Was ich nicht belegen konnte

1. **Flüsse zwischen den vier Regelzonen.** Deutschland und Luxemburg bilden
   eine einzige Gebotszone; die EU-Verordnung 543/2013 Art. 12.1(g) verlangt
   die Veröffentlichung physikalischer Flüsse nur *zwischen Gebotszonen*.
   SMARD hat keinen entsprechenden Filter. **Einschränkung dieser Aussage:**
   die ENTSO-E-Wissensdatenbank hat auf mehrere Abrufversuche HTTP 400
   geliefert; die Aussage stützt sich auf den Verordnungstext und die
   Gebotszonenstruktur, nicht auf eine gelesene ENTSO-E-Seite. Eine endgültige
   Klärung braucht einen Zugang zur Transparency Platform.
2. **Flüsse auf einzelnen Leitungen.** § 23c Abs. 2 EnWG. Öffentlich sichtbare
   Leitungsauslastungen sind Modellrechnungen.
3. **AGEB als zweite Gegenprobe.** Das PDF `Strerz-Abgabe-2025-02.pdf` ließ
   sich nicht auslesen. Ausgewichen auf Destatis.
