# Beleg: Kraftwerks-Stammdaten und Erzeugung je Block

Stand: 30.08.2026. Zuständiger Skill: `datenquellen-strom`.

## Herkunft — undokumentiert

Der Endpunkt steht in **keiner** veröffentlichten SMARD- oder
bundesAPI-Dokumentation. Er wurde aus dem JavaScript-Bundle des
SMARD-Downloadcenters rekonstruiert
(`/resource/themes/bnetza/js/apps/download-center-209416-10.js`), in dem er als
einer von nur sechs Endpunkten auftaucht:

```
"/app/chart_configuration/date_range.json"
"/app/power_plant_data/power_plant_metadata.json"
"/nip-download-manager/nip/download"
```

```
https://www.smard.de/app/power_plant_data/power_plant_metadata.json
→ HTTP 200, 980.071 Bytes, application/json
```

**Das ist ein Risiko und gehört ins Methodik-PDF:** ein undokumentierter
Endpunkt kann ohne Ankündigung verschwinden oder seine Struktur ändern.
`scripts/validate.py` prüft deshalb die Struktur der abgeleiteten Datei und
nicht nur, dass sie existiert.

## Inhalt

**596 Anlagen, davon 596 mit Koordinaten (100 %).**

Felder je Anlage: `name`, `company`, `code` (EIC), `regionCode`, `regionId`,
`postalCode`, `city`, `address`, `state`, `country`, `power`, `resource`,
`coordinates`, `description`, `blocks`.

Felder je Block: `id`, `blockNumber`, `blockCode`, `productionId`,
`outagesId`, `commissioning`, `status`, `power`, `resource`, `otherResource`,
`eeg`, `chp`, `network`, `nameChart`, `color`.

Textfelder tragen Übersetzungsschlüssel wie `KW-Energieträger.Erdgas`; das
Präfix wird beim Verschlanken abgeschnitten.

| Regelzone | Anlagen | Leistung |
|---|---:|---:|
| Amprion | 214 | 36.172,5 MW |
| 50Hertz | 144 | 20.920,7 MW |
| TenneT | 174 | 17.418,6 MW |
| TransnetBW | 64 | 10.194,1 MW |
| **Summe** | **596** | **84.705,9 MW** |

Häufigste Energieträger: Erdgas 227, Wasser 90, Abfall 55, Batteriespeicher 54,
Biomasse 48, Pumpspeicher 30, Steinkohle 25, Wärme 21, Mineralölprodukte 19,
Braunkohle 17.

**Windparks und Solarparks sind nicht einzeln geführt.** Die Stammdaten
enthalten überwiegend konventionelle Anlagen, Wasserkraft und Speicher.

## Die deutschen Regelzonen reichen über die Staatsgrenze

Ein Befund aus der Prüfung: **15 Anlagen mit zusammen 4.469 MW liegen nicht in
Deutschland**, gehören aber zu deutschen Regelzonen.

| Ort | Region | Regelzone | Leistung |
|---|---|---|---:|
| Stolzembourg | Vianden (LU) | Amprion | 1.294,0 MW |
| Gaschurn | Vorarlberg (AT) | TransnetBW | 525,0 MW |
| Silz | Tirol (AT) | TenneT | 500,0 MW |
| Partenen | Vorarlberg (AT) | TransnetBW | 380,0 MW |
| Vandans | Vorarlberg (AT) | TransnetBW | 295,0 MW |
| Kühtai | Tirol (AT) | TenneT | 289,0 MW |
| Gaschurn | Vorarlberg (AT) | TransnetBW | 288,0 MW |
| Tschagguns | Vorarlberg (AT) | TransnetBW | 280,0 MW |
| Vandans | Vorarlberg (AT) | TransnetBW | 200,0 MW |
| Partenen | Vorarlberg (AT) | TransnetBW | 157,0 MW |
| Laufenburg | Aargau (CH) | TransnetBW | 104,0 MW |
| Rheinfelden | Aargau (CH) | TransnetBW | 93,3 MW |
| Partenen | Vorarlberg (AT) | TransnetBW | 36,0 MW |
| Rheinfelden | Aargau (CH) | TransnetBW | 15,7 MW |
| Vandans | Vorarlberg (AT) | TransnetBW | 12,0 MW |

Überwiegend Pump- und Speicherkraftwerke. Wer diese Anlagen künftig
herausfiltert, weil sie „nicht in Deutschland liegen“, verfälscht die
Regelzonenbilanz. `scripts/validate.py` hält den Fall deshalb als eigene
Prüfung fest, und `fetch-kraftwerke.py` führt das Feld `staat` ausdrücklich
mit.

> Dieser Befund kam aus einem **fehlgeschlagenen Plausibilitätstest**: die
> ursprüngliche Rahmenprüfung (47,0 bis 55,5 Grad Nord) hat fünf Anlagen
> aussortiert. Falsch war nicht die Quelle, sondern meine Annahme, die
> deutsche Regelzone ende an der Staatsgrenze. Die Grenze wurde korrigiert und
> der Grund im Code notiert.

## Erzeugung je Kraftwerksblock

**211 der 1.956 Blöcke tragen eine `productionId`.** Diese ID funktioniert als
Filter im normalen `chart_data`-Endpunkt — aber nur mit der **Regelzone der
Anlage** als `region`:

```
/app/chart_data/1042/Amprion/index_quarterhour.json   → HTTP 200
/app/chart_data/1042/DE/index_quarterhour.json        → HTTP 404
/app/chart_data/1042/50Hertz/index_quarterhour.json   → HTTP 404
```

Verifizierte Beispiele, Tag 19.08.2026, Viertelstundenwerte in MWh:

```
filter=4046 region=Amprion  → 96 Punkte | 25.086,0 MWh | Spitze 1.048,8 MW  (Blockleistung 1.052 MW)
filter=946  region=50Hertz  → 96 Punkte | 20.637,8 MWh | Spitze   869,3 MW
filter=876  region=50Hertz  → 96 Punkte | 17.032,3 MWh | Spitze   820,0 MW
filter=1042 region=Amprion  → 96 Punkte |      0,0 MWh | Block stand still
```

Die 211 Blöcke decken **53,3 %** der in den Stammdaten geführten Leistung ab
(53.443 von 100.348 MW über alle Blöcke).

Verteilung: Amprion 86, 50Hertz 60, TenneT 41, TransnetBW 24.

## Fallen, die das Abrufskript kennen muss

1. **404 statt leer.** Eine `productionId` mit falscher Regelzone liefert
   HTTP 404. Dasselbe Muster wie bei Kernenergie und bei Wind Offshore in
   Amprion. Ein Skript, das 404 als Abbruch behandelt, bricht grundlos ab; ein
   Skript, das 404 als Null verbucht, verfälscht die Bilanz. Beides ist
   falsch — `scripts/smard.py` wirft dafür die eigene Ausnahme
   `Nichtvorhanden`.
2. **`meta_data.created` ist kein Datenstand.** Bei den Stammdaten steht dort
   der Zeitpunkt der Dateierzeugung, nicht der Stand der Anlagenliste.
3. **`power` kann `null` sein.** Auf Blockebene kommt das vor und hat beim
   Sortieren schon einen Absturz verursacht.

## Was daraus nicht folgt

Die Stammdaten sind **Standortdaten, keine Messung**. Sie sagen, wo eine
Anlage steht und wie groß sie ist — nicht, wohin ihr Strom fließt. Für 385 der
596 Anlagen gibt es überhaupt keine Erzeugungsreihe.

Leitungen und Umspannwerke sind in dieser Quelle **nicht enthalten**. Deren
Geografie muss aus einer anderen Quelle belegt werden; das ist noch offen.

## Prüfbefehl

```
python scripts/fetch-kraftwerke.py
python scripts/validate.py
python scripts/validate.py --negativtests
```

---

## Eingebunden am 05.09.2026: die Erzeugung je Block auf der Karte

Der Befund von oben — 211 Blöcke mit `production_id` — ist jetzt benutzt.
Abrufskript `scripts/fetch-blockerzeugung.py`, Daten unter
`data/blockerzeugung/<jahr>.json`.

### Warum es überhaupt tragbar ist

Der Filter kennt **alle** Auflösungen, auch `index_day`. Damit sind es **zehn
Jahresblöcke je Block statt 365 Viertelstundenblöcken** — 2.110 Abrufe für die
ganze Reihe statt über hunderttausend. Der tägliche Workflow holt nur das
laufende und das vorige Jahr, also rund 420.

**Gegenprobe, Block 4046 am 19.08.2026:**

| Weg | Wert |
|---|---|
| Tagesreihe (`index_day`) | 25.086,0 MWh |
| Summe von 96 Viertelstunden | 25.086,0 MWh |

Abweichung 0,028 MWh, reine Rundung. Die Tagesreihe ist also die Summe der
Viertelstunden und keine eigene Größe. Der Wert stimmt außerdem mit dem
überein, der am 19.08.2026 von Hand geprüft und weiter oben notiert wurde.

### Der wichtigste Vorbehalt: die Abdeckung schwankt stark

Das war nicht zu erwarten und ist beim Nachrechnen aufgefallen — die
Jahressumme 2018 lag bei 48 TWh zwischen 194 (2017) und 99 (2019). Das ist
kein Rückgang der Erzeugung, sondern eine Meldelücke:

| Jahr | Abdeckung | Median Tage je Block |
|---|---|---|
| 2017 | 98,7 % | 365 |
| **2018** | **21,0 %** | **23** |
| **2019** | **61,1 %** | 196 |
| 2020 | 96,4 % | 366 |
| 2021 | 93,4 % | 362 |
| 2022 | 94,3 % | 361 |
| 2023 | 98,1 % | 365 |
| 2024 | 94,1 % | 366 |
| 2025 | 97,1 % | 364 |
| 2026 | 63,1 % | 241 (Jahr läuft) |

An der Quelle nachgesehen, Block 876 (Boxberg, 840 MW): 366 Werte in 2016,
365 in 2017, **22 in 2018**. Es ist die Quelle, nicht der Abruf.

Die Zahl steht als `abdeckung_prozent` in jeder Jahresdatei, und
`scripts/validate.py` rechnet sie nach.

### Was die Seite daraus macht

Beim Klick auf ein Kraftwerk steht unter den Stammdaten:

- **die tatsächliche Erzeugung im Zeitraum** in GWh,
- **wie viele Tage des Zeitraums überhaupt gemeldet sind** — steht als Warnung
  da, sobald es weniger sind als der Zeitraum hat,
- **die Auslastung**, gerechnet über die **gemeldeten** Tage. Über den ganzen
  Zeitraum gerechnet würde jede Meldelücke sie nach unten ziehen, und aus einem
  fehlenden Wert würde ein stillstehender Block. Sie kann über 100 % gehen; die
  Nettoleistung ist ein Stammdatum und keine Obergrenze der Messung.
- **der Verlauf** als kleine Linie, an nicht gemeldeten Tagen unterbrochen,
- **die Aufteilung auf die Blöcke** der Anlage,
- und die Zahl der Blöcke **ohne** Reihe, mit dem Hinweis, dass das eine Grenze
  der Quelle ist.

Auf der Karte tragen Anlagen mit Reihe einen hellen Ring — keine zweite Farbe:
die Farbe gehört dem Energieträger.

### Was dabei aufgefallen ist und nichts mit Blöcken zu tun hat

Beim Nachrechnen hat die Gegenprobe „Stundenwerte reproduzieren den Tageswert"
angeschlagen. Ursache war **ein Fehler im Nachtrag der Stundenwerte**: er hing
alles an, wenn die erste geholte Marke nicht in der Datei stand. Der September
2026 hatte danach 164 Einträge mit **48 Doubletten**, und die erste Stunde des
Monats fehlte. Der Schnitt ist jetzt chronologisch, und `validate.py` prüft
direkt auf doppelte Stundenmarken — erlaubt ist genau eine je Jahr, die Stunde
02 am Tag der Rückstellung im Oktober.
