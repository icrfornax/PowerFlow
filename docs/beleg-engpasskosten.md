# Kosten des Engpassmanagements — Beleg

Erschlossen am 03.09.2026. Quelle: ENTSO-E Transparency Platform, Datenpunkt
**13.1.C** der Verordnung 543/2013, „Costs of congestion management".
Abrufskript: `scripts/fetch-engpasskosten.py`, Zugang: `scripts/entsoe.py`.

## Warum diese Quelle und keine andere

netztransparenz.de führt die Kosten **nicht** über ihre Web-API. Ich habe die
57 dokumentierten Endpunkte der Fassung v1.14 (Februar 2025) durchgesehen —
Redispatch ja, Kosten nein. Damit ist die Transparency Platform die Quelle.

Sie darf es auch sein: 13.1.C steht als Datenpunkt 21 auf der *List of Data
available for free re-use* (Fassung 18.10.2023) und damit unter **CC BY 4.0**.
Dieselbe Liste, über die schon die Lizenzkette des Redispatch läuft — siehe
`docs/beleg-redispatch.md`.

## Der Rohabruf

```
GET https://web-api.tp.entsoe.eu/api
    ?documentType=A92
    &in_Domain=<Regelzone>&out_Domain=<Regelzone>
    &periodStart=YYYYMM010000&periodEnd=YYYYMM010000
```

**Die Domäne ist die REGELZONE, nicht die Gebotszone.** Mit
`10Y1001A1001A82H` (DE-LU) antwortet die Plattform „No matching data found";
mit den vier CTA-Codes kommt ein `TransmissionNetwork_MarketDocument`.

**Aus den Daten belegt, nicht aus der Doku übernommen:**

| Feld | Wert | Bedeutung |
|---|---|---|
| `resolution` | `P1M` | **ein Wert je Monat** — keine Tageswerte, keine Kosten je Maßnahme |
| `currency_Unit.name` | `EUR` | Währung; wird bei jedem Satz geprüft |
| `congestionCost_Price.amount` | z. B. `-84430.14` | Betrag, Dezimaltrennzeichen **Punkt** |

Ein volles Jahr auf einmal beantwortet die Plattform mit HTTP 400 („The number
of instances exceeds the allowed maximum"). Deshalb wird monatsweise gefragt,
in acht Strängen.

## Die wichtigste Falle: B04 ist die Summe

Je Monat und Zone kommen bis zu drei Zeitreihen, unterschieden durch
`businessType` (Codeliste der Plattform, Artikel „BusinessType", Stand
29.06.2023):

| Code | Bedeutung |
|---|---|
| `A46` | System Operator re-dispatching → Redispatch-Kosten |
| `B03` | Counter trade → Countertrade-Kosten |
| `B04` | **Congestion costs → die GESAMTSUMME** |

`B04` ist **kein dritter Posten**. Über 16 Stichmonate 2025 geprüft: in 13
davon gilt `A46 + B03 = B04` **auf den Cent**, in den übrigen bleibt eine
kleine Differenz — die Position `OtherCosts` des Dateischemas.

**Mein erster Lauf hat genau diesen Fehler gemacht** und alle drei Reihen
addiert: 3,64 statt 1,82 Mrd. EUR für 2025. Aufgefallen ist es nur, weil die
Größenordnung nicht zu den Zahlen der Bundesnetzagentur passte.

Die Datei führt deshalb `sonstiges` als eigenes, ausgerechnetes Feld, und
`scripts/validate.py` prüft bei jedem Lauf die Identität
`redispatch + countertrade + sonstiges = gesamt` auf zwei Stellen. Wer `gesamt`
fälschlich als dritten Posten addiert, verletzt sie sofort.

## Gemessen

| Jahr | gesamt | Redispatch | Countertrade | Sonstiges |
|---|---|---|---|---|
| 2019 | 1.057,8 Mio. € | 890,2 | 167,4 | 0,3 |
| 2020 | 1.174,2 | 937,9 | 235,9 | 0,3 |
| 2021 | 1.809,9 | 1.237,1 | 572,1 | 0,7 |
| **2022** | **3.473,3** | 3.101,3 | 370,9 | 1,1 |
| 2023 | 2.785,2 | 2.608,4 | 176,7 | 0,0 |
| 2024 | 1.977,9 | 1.879,7 | 98,2 | −0,0 |
| 2025 | 1.820,4 | 1.725,1 | 96,0 | −0,7 |
| 2026 (bis Juli) | 961,7 | 784,5 | 34,3 | **142,8** |

2025 je Regelzone: TenneT 55,9 %, Amprion 21,2 %, 50Hertz 13,9 %,
TransnetBW 9,0 %.

**2026 fällt aus der Reihe:** der Posten „Sonstiges" springt von praktisch null
auf 142,8 Mio. €. Was ihn ausmacht, sagt die Quelle nicht — sie liefert nur die
Gesamtsumme und die zwei benannten Posten. Die betroffenen Monate stehen in der
Datei unter `monate_mit_sonstigem`, und die Seite weist den Posten aus, statt
ihn in eine der anderen Zahlen zu schieben.

## Ein falsch etikettierter Wert der Quelle

Für **50Hertz im Dezember 2021** steht in allen drei Reihen die Währung
**`BAM`** — die bosnische konvertible Mark. Die Beträge (33,8 und 34,6 Mio.)
sind als Euro plausibel; als BAM wären sie rund halb so groß.

Behandelt wie der falsche Schweiz-Import vom 09.02.2015 in den Tagesreihen:
**der Monat wird als fehlend geführt, nicht umgerechnet und nicht
stillschweigend als Euro gelesen.** Wir wissen nicht, ob das Etikett falsch ist
oder die Zahl. Der Originalwert bleibt in der Datei unter `auffaellig`
sichtbar, und die Seite nennt ihn.

Gefunden hat ihn die Prüfung `currency_Unit.name == "EUR"`, die beim ersten
Lauf sofort abgebrochen hat. Ohne sie wären 34,6 Mio. BAM stillschweigend als
Euro in die Summe gelaufen.

## Was die Zahl bedeutet — und was nicht

- **Es gibt keine Kosten je Maßnahme.** Die Quelle ist monatlich. Ein Preis je
  Maßnahme wäre erfunden. Die Seite bildet deshalb eine Summe nur über **volle
  Monate** im gewählten Zeitraum und sagt es, wenn keiner darin liegt.
- **Der Preis je MWh ist gerechnet**, aus zwei Veröffentlichungen derselben
  vier Netzbetreiber: Kosten von ENTSO-E, Arbeit von netztransparenz.de. 2025:
  1.725,1 Mio. € auf 20,32 TWh = **84,9 €/MWh**.
- **Der Cent-Betrag je kWh ist eine Umrechnung**, kein Rechnungsposten:
  1.820,4 Mio. € auf 465,8 TWh Netzlast = 3,91 €/MWh = **0,39 ct/kWh**. Was
  und wie umgelegt wird, regelt das Netzentgeltrecht — das ist nicht dieselbe
  Zahl.

## Prüfungen

- `fetch-engpasskosten.py` **bricht ab** bei einem unbekannten `businessType`
  (sonst fehlte ein Kostenposten in der Summe) und bei einem nicht lesbaren
  Betrag.
- `validate.py`: Einheit EUR, Auflösung P1M, mindestens 60 Monate, die
  Identität der Posten auf zwei Stellen, kein unlesbarer Betrag, jeder
  auffällige Wert mit Originalbetrag und Begründung, die verzeichneten Monate
  mit nennenswertem „Sonstiges".
- `browsertest.mjs`: der Block steht da, nennt seinen Maßstab, sagt, dass es
  keine Kosten je Maßnahme gibt, und zeigt bei einem Zeitraum ohne vollen Monat
  keine Summe.
