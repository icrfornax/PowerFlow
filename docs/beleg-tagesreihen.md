# Beleg: Tagesreihen und Datenqualität

Stand: 30.08.2026. Zuständige Skills: `datenquellen-strom`, `pruefpflichten`.

Die freie Variable der Seite ist der **Kalendertag**. Die Seite braucht deshalb
Tageswerte für viele Tage. Dieses Dokument belegt, woher sie kommen und was mit
ihnen nicht stimmt.

## Warum die Auflösung `day`

SMARD liefert dieselben Reihen auch vorsummiert je Tag. Der Index hat dann
**zwölf Jahresblöcke statt 609 Wochenblöcken** — ein Abruf je Filter und Jahr.

Geprüft, nicht angenommen:

```
Netzlast 19.08.2026, Auflösung day    1.209.350,67 MWh
Summe der 96 Viertelstundenwerte      1.209.350,65 MWh
Differenz                                      0,02 MWh
```

Das ist Rundung. Dieselbe Größe, nur vorsummiert. Alle zwölf Jahre liegen als
`data/tage/<jahr>.json` im Repository, je rund 260 kB.

## Ein eigener Fehler: fehlende Kernenergie

Die erste Fassung von `scripts/smard.py` hat Filter 1224 (Kernenergie)
**absichtlich aus der Erzeugungsliste gelassen**, weil er für aktuelle
Zeiträume HTTP 404 liefert. Das war falsch. Bis zum 15.04.2023 hat Kernenergie
erheblich beigetragen — 2015 noch 84,4 TWh. Ohne sie ging die Tagesbilanz aller
Jahre bis 2022 um bis zu 27 % nicht auf.

Aufgefallen ist das erst, als die Selbstkontrolle über **alle** Tage lief statt
über einen Stichtag. Der Fehler ist behoben: Kernenergie steht in `ERZEUGUNG`,
und der 404 wird über die Ausnahme `Nichtvorhanden` abgefangen.

| | Median Bilanzrest 2015 | Median 2025 |
|---|---:|---:|
| ohne Kernenergie | −25,05 % | −1,93 % |
| mit Kernenergie | −8,00 % | −1,93 % |

## Ein Fehler der Quelle: Schweiz-Import am 09.02.2015

```
Schweiz Import 09.02.2015     25.009.206 MWh
Nachbartage                    einige Zehntausend MWh
```

25 TWh an einem Tag — mehr als ein Drittel der schweizerischen Jahreserzeugung.
Das kann nicht stimmen.

Behandlung: Der Wert wird **als fehlend geführt, nicht korrigiert und nicht
geschätzt**. Der Originalwert steht unverändert in der Liste `auffaellig` der
Jahresdatei. `scripts/validate.py` prüft, dass dieser Eintrag samt Originalwert
erhalten bleibt, und hat dafür zwei Negativtests: einen für das Entfernen des
Eintrags und einen für ein stillschweigendes „Reparieren“ des Werts.

Ein systematischer Plausibilitätsfilter über alle zwölf Jahre und rund 50
Reihen findet **genau diesen einen** Wert.

> Der erste Anlauf dieses Filters hat 1.827 Fehlalarme erzeugt, weil ich
> Residuallast und Regelzonen-Last gegen die Grenzen der deutschen Gesamtlast
> geprüft habe. Falsch waren meine Grenzen, nicht die Daten. Die Grenzen gelten
> jetzt je Reihenart und sind in `scripts/fetch-tagesreihen.py` einzeln
> begründet.

## Der Bilanzrest ist nicht null

`Bilanzrest = Erzeugung + Import − Export − Netzlast`

Über alle **4.258 belegten Tage**:

| | Wert |
|---|---:|
| Minimum | −18,76 % |
| 1 %-Quantil | −14,69 % |
| Median | −2,59 % |
| 99 %-Quantil | +5,78 % |
| Maximum | +11,99 % |

**Eine frühere Fassung dieser Seite nannte 0,5 % als Sollwert. Das war auf
einen einzelnen günstigen Tag (19.08.2026, +0,07 %) geeicht und ist hiermit
zurückgenommen.** Der Rest ist keine enge Selbstkontrolle.

Darin stecken: Netzverluste, die unterschiedliche zeitliche Auflösung von
Erzeugung (Tageswert) und Außenhandel (Stundenwerte), und — vor 2018 deutlich —
Erfassungslücken der Quelle. Die Seite zeigt den Rest als eigene Kennzahl und
warnt, wenn er 5 % überschreitet.

### Was ich nicht belegen konnte

Die Jahressummen zeigen das Problem der frühen Jahre deutlich:

| Jahr | Netzlast | Erzeugung | Import | Export |
|---|---:|---:|---:|---:|
| 2015 | 502,0 TWh | 502,9 TWh | 28,6 TWh | 73,8 TWh |
| 2017 | 506,8 TWh | 514,5 TWh | 23,1 TWh | 76,4 TWh |
| 2020 | 485,4 TWh | 503,6 TWh | 42,5 TWh | 61,7 TWh |
| 2025 | 465,8 TWh | 437,9 TWh | 73,5 TWh | 55,2 TWh |

2015 stehen 502,9 TWh Erzeugung gegen 502,0 TWh Last **bei 45 TWh
Nettoexport**. Das kann nicht aufgehen — es fehlen rund 44 TWh Erzeugung oder
Import. Für 2025 stimmt die Erzeugungssumme dagegen auf 0,07 % mit Destatis
überein (siehe `beleg-smard.md`).

**Die Ursache für die Lücke vor 2018 ist nicht geklärt.** Naheliegend ist eine
unvollständige Erfassung in den frühen ENTSO-E-Daten. Belegen konnte ich das
nicht. Die Jahre bleiben abrufbar, die Seite warnt für Tage vor 2019.

## Regelzonen gegen Deutschland

Bei **Viertelstundenauflösung** summieren sich die vier Zonen exakt auf
Deutschland (0,00 GWh, siehe `beleg-smard.md`). Bei **Tagesauflösung über zwölf
Jahre** gilt das nicht überall:

| Jahr | Median Abw. Last | größte Abw. Last |
|---|---:|---:|
| 2015 | −11.223 MWh | −47.658 MWh (−3,40 %) |
| 2017 | −2.589 MWh | −10.375 MWh (−0,82 %) |
| 2019 | +3 MWh | +10 MWh (0,00 %) |
| 2025 | +0,1 MWh | +9,5 MWh (0,00 %) |

Ab 2019 stimmt es auf rund 10 MWh. Davor nicht. Der Türsteher prüft die
Zonensumme deshalb erst ab dem **01.01.2019** streng; für frühere Tage warnt die
Seite sichtbar.

Der Vergleich läuft **je Energieträger** und nur, wenn der Wert in Deutschland
und in allen vier Zonen vorliegt. Ein erster Anlauf verglich eine vollständige
Deutschlandsumme gegen eine Zonensumme mit Lücken und meldete 3.413 Ausreißer,
die keine waren — auch das war mein Fehler, nicht der der Quelle.

Es bleibt eine echte Ungenauigkeit der Quelle: **249 von 31.785 Vergleichen
(0,78 %) weichen um mehr als 60 MWh ab**, die größte Einzelabweichung liegt bei
24.029 MWh (08.12.2025, Pumpspeicher). Das wird nicht durch eine weite Toleranz
unsichtbar gemacht, sondern als **Budget** geführt: der Deploy hält an, wenn der
Anteil über 1,0 % oder die größte Abweichung über 50.000 MWh steigt.

## Erzeugung je Zone: ein zweiter, größerer Riss vor 2018

Nachgetragen am 31.08.2026, aufgefallen beim Bau des Regelzonen-Abschnitts.

Die Tabelle oben vergleicht die **Last**. Vergleicht man die **Erzeugung**, ist
der Riss vor 2018 deutlich größer:

| Jahr | Abw. Last | Abw. Erzeugung |
|---|---:|---:|
| 2015 | −0,66 % | **+7,52 %** |
| 2016 | −0,17 % | **+6,65 %** |
| 2017 | −0,22 % | −1,44 % |
| 2018 | +0,01 % | −0,76 % |
| 2019 | +0,00 % | −0,22 % |
| 2021–2026 | +0,00 % | ±0,03 % |

Die Zonensumme liegt 2015 also um mehr als sieben Prozent **über** der
Deutschlandsumme. Der Einzelposten ist gefunden:

| Reihe | DE 2015 | Summe der Zonen | Abw. |
|---|---:|---:|---:|
| Sonstige Konventionelle | 10.425.309 MWh | 55.252.172 MWh | **+430 %** |
| Biomasse | 39.751.085 MWh | 34.848.865 MWh | −12,3 % |
| Wasserkraft | 14.094.166 MWh | 13.103.322 MWh | −7,0 % |

„Sonstige Konventionelle" steht in der Zonenaufteilung 2015 rund **fünfmal so
hoch** wie für Deutschland insgesamt. 2016 noch 3,8-fach, ab 2017 kippt das
Vorzeichen. Beide Reihen kommen aus derselben Quelle und müssten gleich sein.

**Warum das die bestehende Prüfung nicht gemeldet hat:** der Türsteher prüft die
Zonensumme erst ab dem 01.01.2019 streng. Das war eine bewusste Festlegung wegen
der Lastlücke — sie hat aber den größeren Erzeugungsriss mit abgedeckt, ohne
dass er je benannt worden wäre. Das ist mein Fehler, nicht der der Quelle: eine
Toleranzgrenze, die man setzt, muss man auch daraufhin ansehen, was sie sonst
noch verdeckt.

**Wie oft es vorkommt**, über alle 4.258 belegten Tage gerechnet: an **1.173
Tagen** weicht die Zonensumme der Erzeugung um mehr als 1 % ab. Davon liegen
1.076 vor 2018, 97 zwischen 2018 und 2020 und **fünf ab 2021** — alle im
November und Dezember 2025, der größte am 09.12.2025 mit −2,84 %.

**Folge für die Seite:** die Warnung hängt nicht mehr an einer Jahreszahl,
sondern wird für den **gewählten Zeitraum nachgerechnet**
(`zonenAbweichung()` in `assets/powerflow.js`). Liegt sie über 1 %, sagt die
Seite es im Kasten „Hinweise zur Datenlage" und nennt die Zahl. Der
Regelzonen-Abschnitt zeigt die Gegenprobe außerdem immer an, auch wenn sie
aufgeht. Korrigiert oder angeglichen wird nichts.

## Was streng geprüft wird und aufgeht

- **Residuallast**: `Netzlast − Wind Onshore − Wind Offshore − Photovoltaik`
  stimmt an jedem belegten Tag auf unter 60 MWh mit der von SMARD getrennt
  gelieferten Reihe überein.
- **Größenordnung**: die mittlere Leistung liegt an jedem Tag zwischen 30 und
  90 GW. Ein Faktor 1000 fällt sofort auf.

## Prüfbefehl

```
python scripts/fetch-tagesreihen.py
python scripts/validate.py                 # 88 Pruefungen
python scripts/validate.py --negativtests  # 21 Negativtests
```
