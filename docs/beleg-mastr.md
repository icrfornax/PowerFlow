# Marktstammdatenregister — Windparks (und warum Solar draußen bleibt)

Stand 31.08.2026. Abgerufen von `scripts/fetch-mastr.py`, Ergebnis in `data/mastr-wind.json`.

## 1. Die Quelle und das Mengenproblem

Das Marktstammdatenregister der Bundesnetzagentur veröffentlicht einen
**Gesamtdatenexport als ZIP mit 3,16 GB**. Darin stecken 434 Dateien. Zwei
davon werden gebraucht, die dritte Zeile steht hier, weil sie die Entscheidung
gegen Solar erklärt:

| Datei | entpackt | gepackt |
|---|---:|---:|
| `Katalogwerte.xml` | 0,41 MB | — |
| `EinheitenWind.xml` | 202,7 MB | **8,0 MB** |
| `EinheitenSolar_1…65.xml` | 22,1 GB | **1,08 GB** |

Ein ZIP trägt sein Inhaltsverzeichnis am Ende. Der Server beantwortet
`Accept-Ranges: bytes`, also lässt sich gezielt lesen, was gebraucht wird. Das
Abrufskript tut genau das: **für Wind werden 9,5 MB übertragen statt 3.160 MB.**
Das Verfahren ist keine Spielerei, sondern der Unterschied zwischen einem
Abruf, der monatlich in einem Workflow läuft, und einem, der es nicht tut.

## 2. Rohabruf — der erste Datensatz, unverändert

```
EinheitMastrNummer                         SEE940146675093
LokationMaStRNummer                        SEL911577226093
Landkreis                                  Werra-Meißner-Kreis
Ort                                        Helsa
Laengengrad                                9.739374
Breitengrad                                51.270068
Inbetriebnahmedatum                        2017-09-01
EinheitBetriebsstatus                      35
NameStromerzeugungseinheit                 WEA 5
Energietraeger                             2497
Bruttoleistung                             3000.000
Nettonennleistung                          3000.000
NameWindpark                               Windpark Kreuzstein
WindAnLandOderAufSee                       888
Typenbezeichnung                           E-115
Nabenhoehe                                 149.080
Rotordurchmesser                           115.710
```

Die Zahlencodes sind Schlüssel in `Katalogwerte.xml` (1.737 Einträge) und
werden **aus der Datei aufgelöst, nicht geraten**:

| Feld | Code | Bedeutung |
|---|---|---|
| `Energietraeger` | 2497 | Wind |
| `EinheitBetriebsstatus` | 35 | In Betrieb |
| `WindAnLandOderAufSee` | 888 / 889 | Windkraft an Land / auf See |

## 3. Einheitennachweis aus den Daten selbst

Die Dokumentation wird nicht abgeschrieben. Der Nachweis kommt aus dem
Zusammenhang zwischen Typenbezeichnung und Zahlenwert:

| Anlagen | Typ | `Nettonennleistung` | tatsächliche Nennleistung |
|---:|---|---:|---|
| 574 | Enercon E-115 | 3000.000 | 3,0 MW |
| 565 | Enercon E-101 | 3050.000 | 3,05 MW |
| 489 | Vestas V90 | 2000.000 | 2,0 MW |
| 590 | Enercon E-82 E2 | 2300.000 | 2,3 MW |

**Die Werte stehen in Kilowatt.** Wären es Megawatt, hätte eine E-115 drei
Gigawatt.

## 4. Größenordnungsprobe gegen eine unabhängige Reihe

Summe der Nettonennleistung aller Anlagen mit Status „In Betrieb":

| | Anlagen | Leistung |
|---|---:|---:|
| Windkraft an Land | 30.379 | 70,65 GW |
| Windkraft auf See | 1.773 | 10,97 GW |
| zusammen | 32.152 | **81,62 GW** |

Gegengeprüft an den SMARD-Stundenreihen, die im Repository liegen — eine
**andere Erhebung**, nicht dieselbe Quelle:

| | gemessene Spitze | Anteil an der installierten Leistung |
|---|---:|---:|
| Wind Offshore | 8,45 GW (02.02.2026, 21 Uhr) | 77 % |
| Wind Onshore | 48,50 GW (21.12.2023, 11 Uhr) | 69 % |
| Wind zeitgleich | 53,23 GW (25.03.2026, 7 Uhr) | 65 % |

Die gemessene Spitze liegt unter der installierten Leistung und bei einem
Anteil, der für Wind plausibel ist. Ein Faktor 1000 in der Einheit wäre hier
sofort aufgefallen.

## 5. Was zusammengefasst wird — und dass das eine Rechnung ist

**Wind:** einzelne Anlagen werden über die Betreiberangabe `NameWindpark` zu
Parks zusammengefasst. Das ist die Angabe des Registers, keine eigene
Gruppierung. Anlagen ohne Parknamen (565) bleiben für sich. **Der Ort eines
Parks ist der Mittelwert der Anlagenorte** — das ist gerechnet und steht so im
Kopf der Datei und im Popover auf der Seite.

Ergebnis: 10.833 Gruppen, davon **4.030 Parks ab 5 MW mit zusammen 67,62 GW**
(47 auf See mit 10,97 GW, 3.983 an Land mit 56,66 GW). Der größte ist Borkum
Riffgrund 3 mit 958,6 MW aus 83 Anlagen.

**1.030 Anlagen in Betrieb haben keine Koordinate** und fehlen deshalb. Das ist
eine Grenze der Quelle, keine Auswahl.

## 5a. Solar: geprüft und verworfen

Solar war vorgesehen und ist **bewusst nicht aufgenommen**. Die Prüfung steht
hier, damit niemand die 1,08 GB ein zweites Mal lädt, um dasselbe
herauszufinden.

- Die 65 `EinheitenSolar_*.xml` sind **1,08 GB gepackt** und 22,1 GB entpackt.
- Gemessen an zwei der 65 Dateien (200.000 Einheiten): hochgerechnet blieben
  **ab 1 MW rund 11.500 Standorte** übrig, ab 2 MW noch rund 6.500.
- Auf einer Karte, die vom Netz und von den großen Erzeugern handelt, ist das
  kein Zugewinn, sondern ein Nadelkissen: die Marken lägen dichter als die
  Leitungen darunter.
- Die Felder sind dieselben wie bei Wind; zusammenfassen ließe sich über die
  `LokationMaStRNummer` des Registers oder ersatzweise über die gerundete
  Koordinate. Beides ist erprobt und funktioniert — es fehlt nicht an der
  Technik, sondern am Nutzen an dieser Stelle.

Wer es später doch will, findet in der Versionsgeschichte des Repositorys den
lauffähigen Solarteil von `scripts/fetch-mastr.py`.

## 6. Die Schwelle ist eine Wahl und wird benannt

Koordinaten sind im Register **nicht durchgängig vorhanden** — bei den
Solareinheiten insgesamt nur zu 11,6 %, bei Wind zu 97,0 %. Sie sind aber
vollständig da, sobald die Anlage eine gewisse Größe hat. Gemessen an zwei der
65 Solardateien (200.000 Einheiten):

| Schwelle | Anlagen | Leistung | mit Koordinate |
|---:|---:|---:|---:|
| 100 kW | 4.632 | 2,59 GW | **100,0 %** |
| 500 kW | 1.285 | 1,85 GW | **100,0 %** |
| 1.000 kW | 353 | 1,23 GW | **100,0 %** |

Gewählt wurde **5 MW je Windpark**. Darunter fehlen ohnehin häufig die
Koordinaten, und die Karte würde zum Nadelkissen.

## 7. Auswahl auf der Karte — Darstellung, nicht Daten

Die Datei unter `data/` ist **vollständig** und steht im Abzug. Die Karte
zeigt eine Auswahl, weil 4.030 Windmarken die Leitungen darunter zudecken:

- **alle Windparks auf See** (47) — dort sind es wenige und sie sind der
  interessante Teil,
- die **20 größten Windparks an Land**.

Das steht an der Ebene selbst („alle auf See, 20 größte an Land"), nicht im
Kleingedruckten.

## 8. Lizenz

Die Downloadseite nennt unmittelbar neben dem XML-Export: *„Lizenz:
Datenlizenz Deutschland – Namensnennung – Version 2.0"*.

Absatz 2 der Lizenz verlangt drei Dinge im Quellenvermerk: Bezeichnung des
Bereitstellers, Lizenzvermerk mit Verweis auf den Lizenztext, Verweis auf den
Datensatz. Alle drei stehen im Kopf der Datei.

Absatz 3: *„Veränderungen, Bearbeitungen, neue Gestaltungen oder sonstige
Abwandlungen sind im Quellenvermerk mit dem Hinweis zu versehen, dass die Daten
geändert wurden."* Hier wird gefiltert und zusammengefasst — der Hinweis steht
als eigenes Feld `_veraendert` in der Datei.

**Eine Unschärfe, die benannt bleibt:** das Impressum des Registers erklärt die
Lizenz für Daten *„in den Formaten .xls und .csv"*. Der Gesamtdatenexport ist
XML und dort nicht genannt. Die Downloadseite nennt die Lizenz aber unmittelbar
neben genau diesem XML-Export; das ist die speziellere Angabe und wird hier
zugrunde gelegt. Anders als bei Redispatch ist das keine Lücke in der Kette,
sondern eine Doppelung mit unterschiedlicher Reichweite.

## 9. Was diese Datei nicht sagt

Sie ist ein **Stammdatum**. Sie sagt, wo eine Anlage steht und was sie kann —
nicht, was sie erzeugt hat. Die Erzeugung steht in den SMARD-Reihen und wird
dort gemessen. Eine Zuordnung einzelner Parks zu einer Regelzone führt das
Register nicht; die Parks tragen deshalb keine Zonenfarbe und treten beim
Hervorheben einer Zone zurück, statt eine Zugehörigkeit vorzutäuschen.
