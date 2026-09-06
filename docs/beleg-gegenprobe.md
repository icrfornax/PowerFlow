# Beleg: die erste echte Gegenprobe

Erstellt am 06.09.2026. Abrufskript: `scripts/fetch-gegenprobe.py` ueber
`scripts/eurostat.py`. Datei: `data/gegenprobe.json`.

## Warum es sie vorher nicht gab

Dieses Projekt hat bis zum 06.09.2026 **keine einzige echte Gegenprobe**
gehabt. Der Grund steht seit dem ersten Tag im Skill `datenquellen-strom` und
ist nie umgesetzt worden:

> SMARD und Energy-Charts sind **keine unabhaengigen Quellen**. SMARD bekommt
> die Daten von ENTSO-E, und Energy-Charts veroeffentlicht die Daten mehrerer
> Gebotszonen unveraendert von SMARD unter CC BY 4.0.
>
> Abgleich SMARD gegen Energy-Charts heisst **Konsistenzpruefung**. Er belegt,
> dass Abruf, Einheit und Zeitzone stimmen — nicht, dass die Messung stimmt.

Dasselbe gilt fuer alles Uebrige hier: netztransparenz.de sind die vier
Uebertragungsnetzbetreiber selbst, die ENTSO-E Transparency Platform ist die
europaeische Sammelstelle derselben Meldungen. Alle Reihen dieses Projekts
haengen an einem einzigen Meldeweg.

## Warum Eurostat und nicht AGEB oder Destatis

Geprueft am 06.09.2026:

| Quelle | Befund |
|---|---|
| **Destatis GENESIS** (Tabelle 43311, Bruttostromerzeugung) | Der REST-Dienst antwortet, aber der Katalogaufruf ohne Anmeldung liefert HTML statt Daten. Ein Zugang braucht ein **zweites Geheimnis** im Workflow. Zurueckgestellt. |
| **AGEB** (AG Energiebilanzen) | Veroeffentlicht XLSX und PDF, nennt aber keine Lizenz fuer die Weiterverwendung. Ohne belegte Lizenzkette nicht verwendbar -- dieselbe Huerde wie bei netztransparenz.de. |
| **Eurostat** | Offene API ohne Anmeldung, CC BY 4.0, und die Erhebung laeuft ueber die nationalen Verwaltungen. **Genommen.** |

Fuer Deutschland ist der Weg zu Eurostat der ueber das Statistische Bundesamt.
Die Zahl ist damit dieselbe Familie wie Destatis -- nur ohne zweites Geheimnis.

## Der Beleg, dass Eurostat nicht auch nur ENTSO-E ist

Das ist die entscheidende Frage: eine Gegenprobe gegen eine Quelle, die
dieselben Meldungen weiterreicht, waere keine.

Die Metadaten des Datensatzes
(`https://ec.europa.eu/eurostat/cache/metadata/en/nrg_quant_esms.htm`,
abgerufen am 06.09.2026) nennen als Herkunft:

> "National Administrations competent for energy statistics" -- National
> Statistical Institutes, Ministries, Energy Agencies, Professional
> Associations.

Rechtsgrundlage ist **Verordnung (EG) Nr. 1099/2008** ueber die
Energiestatistik, Anhang B (jaehrlich) und Anhang C (monatlich). Die
Uebermittlung laeuft ueber den Single Entry Point (eDAMIS).

**Uebertragungsnetzbetreiber und ENTSO-E werden an keiner Stelle als Quelle
genannt.** Das ist ein anderer Meldeweg als der, aus dem SMARD schoepft.

## Lizenz -- die achte in diesem Projekt

**CC BY 4.0**, Grundlage ist der Beschluss 2011/833/EU der Kommission vom
12.12.2011 ueber die Weiterverwendung von Kommissionsdokumenten. Die
gewerbliche Weiterverwendung ist fuer Daten der EU-Mitgliedstaaten
ausdruecklich erlaubt (ausgenommen sind Daten von Drittstaaten sowie einzelne
Handelsdaten -- beides betrifft uns nicht).

Die verlangte Namensnennung fuer Datensaetze lautet
`Source: <DOI>, <Abrufdatum>`. Sie steht als Feld `_namensnennung` in der Datei:

    Source: 10.2908/NRG_BAL_C und 10.2908/NRG_CB_E, abgerufen am 2026-09-06

Die DOI wird nicht abgeschrieben, sondern aus der Antwort gelesen
(`Tabelle.doi()`).

## Welche Datensaetze -- und welcher NICHT

| Datensatz | Was daraus kommt |
|---|---|
| `nrg_bal_c`, `nrg_bal=GEP` | Bruttostromerzeugung je Energietraeger, jaehrlich |
| `nrg_cb_e` | Strombilanz: NEP (netto), GEP (brutto), IMP, EXP, Verluste |
| ~~`nrg_cb_pem`~~ | **Verworfen**, siehe unten |

**Der Monatsdatensatz ist unvollstaendig und wird nicht verwendet.** Er nennt
fuer 2023 eine Nettoerzeugung von 456,0 TWh; der Jahresdatensatz derselben
Quelle nennt 498,7 TWh. Das sind **42,7 TWh Widerspruch innerhalb von
Eurostat**. Wer den Monatsdatensatz nimmt, misst diesen Widerspruch mit und
haelt ihn fuer einen Abstand zu SMARD.

Zwei Fallen im Monatsdatensatz, notiert fuer den Fall, dass ihn jemand doch
einmal anfasst -- beide sind vom Zuschnitt her dieselbe Falle wie B04 bei den
Engpasskosten:

* `CF_R` (brennbare erneuerbare Stoffe) steckt in `CF` **und** in `RA000`.
* `RA130` (Pumpspeicher) steckt in `RA100`, aber **nicht** in `RA000`.

Die Identitaet lautet deshalb

    TOTAL = CF + N9000 + X9900 + (RA000 - CF_R) + RA130

und geht auf die Stelle genau auf (2024: 441,20 gegen 441,20 TWh). Wer stumpf
`CF + N9000 + RA000 + X9900` addiert, liegt 2,55 % zu hoch.

## Einheit und Format

* **Einheit GWH**, aus der Dimension `unit` der Antwort **gelesen**, nicht aus
  der Doku uebernommen. Das Skript bricht ab, wenn dort etwas anderes steht.
* **Kein Dezimaltrennzeichen** -- die Werte sind echte JSON-Zahlen.
  `eurostat.py::pruefe_zahlen` prueft den Typ bei jedem Lauf und bricht ab,
  sobald einer keine Zahl ist.
* **Groessenordnungsprobe:** die deutsche Jahreserzeugung muss zwischen 300 und
  800 TWh liegen. Wer GWh fuer MWh haelt, landet um den Faktor 1000 daneben und
  das Skript bricht ab.

Das Antwortformat ist **JSON-stat 2.0**. Sein Wertefeld ist eine flache Karte;
der Schluessel ist ein Index ueber das Kreuzprodukt aller Dimensionen in der
Reihenfolge von `id` mit den Laengen aus `size`. **Diese Reihenfolge wird aus
dem Dokument gelesen und nicht angenommen** -- wer sie raet, bekommt lautlos
die Zahl eines anderen Energietraegers.

## DAS ERGEBNIS

### Die Summe

SMARD zaehlt die Einspeisung ins **oeffentliche Netz**. Eurostat zaehlt die
**gesamte Erzeugung in Deutschland**, einschliesslich dessen, was Industrie und
Kleinanlagen selbst erzeugen und selbst verbrauchen. Die beiden messen also
nicht dasselbe, und der Abstand ist die Groesse dieses Unterschieds:

| Jahr | SMARD | Eurostat netto | Eurostat brutto | Abstand zu netto |
|---:|---:|---:|---:|---:|
| 2015 | 502,9 | 610,3 | 648,3 | **−17,6 %** |
| 2016 | 510,5 | 614,3 | 650,4 | **−16,9 %** |
| 2017 | 514,5 | 619,1 | 653,7 | **−16,9 %** |
| 2018 | 545,2 | 605,7 | 640,5 | **−10,0 %** |
| 2019 | 521,4 | 575,9 | 606,9 | −9,5 % |
| 2020 | 503,6 | 547,7 | 575,5 | −8,0 % |
| 2021 | 511,3 | 563,4 | 592,8 | −9,3 % |
| 2022 | 500,0 | 550,1 | 578,9 | −9,1 % |
| 2023 | 453,6 | 498,7 | 522,9 | −9,1 % |
| 2024 | 437,7 | 491,0 | 514,0 | −10,9 % |

Alle Angaben in TWh.

### Der wichtigste Befund: 2018

**Der Abstand springt zwischen 2017 und 2018 von 16,9 auf 10,0 Prozent** und
bleibt danach stabil bei 8 bis 11 Prozent. 6,9 Prozentpunkte an einer
Jahresgrenze.

Das ist eine **unabhaengige Bestaetigung eines Befundes, den wir schon hatten**.
`docs/beleg-bilanzrest.md` hat am 03.09.2026 festgehalten:

> Der Bruch von 2018 ist Erdgas: die Reihe springt von 25,6 auf 42,9 TWh
> (+3,4 % der Netzlast), der Rest verbessert sich um 5,9 Prozentpunkte. Ein
> realer Zubau in dieser Hoehe hat nicht stattgefunden -- die Erfassung hat
> sich geaendert.

Damals war das eine Vermutung aus dem Verhalten der SMARD-Reihe selbst. Jetzt
sagt eine Quelle, die nichts mit SMARD zu tun hat, dasselbe: die deutsche
Gesamterzeugung ist zwischen 2017 und 2018 **gesunken** (619,1 auf 605,7 TWh),
waehrend SMARD einen **Anstieg** um 30,7 TWh zeigt. Eine Erzeugung, die real
faellt und in der Veroeffentlichung steigt, ist eine Aenderung der Erfassung
und kein Zubau.

**Vor 2018 sind die SMARD-Jahressummen deshalb nicht mit denen ab 2018
vergleichbar.** Das steht jetzt auf der Seite.

### Je Energietraeger

SMARD (Netzeinspeisung, netto) gegen Eurostat (Erzeugung, brutto), 2024:

| Traeger | SMARD | Eurostat | Abstand |
|---|---:|---:|---:|
| **Wind** | 138,2 | 138,9 | **−0,5 %** |
| Braunkohle | 71,0 | 78,9 | −10,0 % |
| Photovoltaik | 63,1 | 75,4 | −16,2 % |
| Steinkohle | 27,3 | 36,4 | −24,8 % |
| Wasserkraft | 17,6 | 23,8 | −26,3 % |
| Biomasse | 36,2 | 52,4 | −31,0 % |
| Erdgas | 56,9 | 90,5 | −37,1 % |

Das Muster ist genau das, was man erwarten muss, wenn die eine Reihe das
oeffentliche Netz zaehlt und die andere alles:

* **Wind stimmt auf ein halbes Prozent.** Windparks haben keine
  Eigenerzeugung fuer den Eigenbedarf und speisen praktisch vollstaendig ins
  Netz. Das ist der schaerfste Beleg dafuer, dass Abruf, Einheit und Zeitzone
  dieser Seite stimmen -- eine Zahl aus einem anderen Meldeweg trifft dieselbe
  Groesse.
* **Erdgas hat den groessten Abstand.** Industrielle Kraft-Waerme-Kopplung
  erzeugt Strom fuer den eigenen Betrieb; er erreicht das oeffentliche Netz
  nie.
* **Photovoltaik −16 %** ist der eigenverbrauchte Dachanlagenstrom.
* **Biomasse und Wasserkraft** sind viele kleine Anlagen unterhalb der
  Meldegrenze von SMARD.
* Der Rest von rund 8 bis 10 Prozent bei Kohle und Kernenergie ist der
  **Eigenverbrauch der Kraftwerke** -- der Unterschied zwischen brutto und
  netto. Eurostat weist ihn nur in der Summe getrennt aus (NEP gegen GEP), nicht
  je Traeger; deshalb steht in der Tabelle je Traeger die Bruttozahl, und das
  ist so benannt.

### Ein- und Ausfuhr

| Jahr | SMARD Einfuhr | Eurostat | SMARD Ausfuhr | Eurostat |
|---:|---:|---:|---:|---:|
| 2015 | 28,6 | 37,0 (−22,8 %) | 73,8 | 85,3 (−13,4 %) |
| 2020 | 42,5 | 47,9 (−11,1 %) | 61,7 | 66,9 (−7,8 %) |
| 2024 | 75,4 | 81,7 (−7,7 %) | 50,2 | 55,4 (−9,3 %) |

Der Abstand schrumpft ueber die Jahre von 23 auf 8 Prozent. **Die Ursache ist
nicht geklaert** und steht als offener Punkt auf der Seite. Denkbar sind
unterschiedliche Abgrenzungen (physikalischer Fluss gegen kommerziellen
Aussenhandel) und die Behandlung von Durchleitungen. Was nicht geht: die
Differenz mit einer Vermutung zu beschriften.

## Was diese Gegenprobe NICHT belegt

* Sie belegt **nicht**, dass die stuendlichen oder viertelstuendlichen Werte
  richtig sind. Verglichen werden Jahressummen.
* Sie belegt **nicht** die Aufteilung auf die vier Regelzonen -- Eurostat kennt
  nur Deutschland.
* Sie ist **nicht** die Aufloesung des Bilanzrests. Der Bilanzrest vergleicht
  Erzeugung plus Einfuhr gegen die Netzlast innerhalb von SMARD; hier geht es
  um die Vollstaendigkeit der Erzeugungsreihe gegenueber einer anderen
  Erhebung. Die beiden beruehren sich beim Bruch von 2018, sind aber
  verschiedene Fragen.

## Aktualisierung

Eurostat aktualisiert die Jahresdaten wenige Male im Jahr (Stand beim Abruf:
`nrg_bal_c` vom 02.06.2026, `nrg_cb_e` vom 11.08.2026). Der Abruf laeuft
deshalb **monatlich** im Workflow `daten-stammdaten.yml` und nicht taeglich.
Das letzte vergleichbare Jahr ist 2024; ein angefangenes Jahr wird
uebersprungen, weil ein Vergleich von zwoelf gegen acht Monate nichts sagt.
