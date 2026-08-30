# Beleg: Redispatch über die netztransparenz-API

Stand: 31.08.2026. Zuständige Skills: `datenquellen-strom`, `pruefpflichten`.

## Stand in einem Satz

**Der Zugang steht, die Daten sind verstanden — veröffentlicht wird nichts,
solange die Lizenz nicht geklärt ist.**

## Zugang

OAuth 2.0 mit Client Credentials. Registrierung kostenlos unter
<https://api-portal.netztransparenz.de/>.

```
POST https://identity.netztransparenz.de/users/connect/token
     grant_type=client_credentials&client_id=…&client_secret=…
  -> {"access_token": "…", "expires_in": …}

GET  https://ds.netztransparenz.de/api/v1/data/Redispatch/{von}/{bis}
     Authorization: Bearer …
  -> CSV, Semikolon getrennt
```

> **Stolperstein bei der Einrichtung:** Das Portal zeigt mehrere Felder, unter
> anderem einen frei wählbaren *Client-Namen*. In `NT_CLIENT_ID` gehört **nicht**
> der Name, sondern die vom Portal vergebene **Client-ID**. Mit dem Namen
> antwortet der Token-Endpunkt mit `invalid_client` — und zwar bei jeder
> Protokollvariante (Formularfelder, Basic roh, Basic prozentkodiert, mit und
> ohne `scope`), sodass der Fehler leicht nach einem Umsetzungsproblem aussieht.
> Er ist keins.

Werkzeuge: `scripts/netztransparenz.py` (OAuth-Client, gibt Zugangsdaten nie
aus), `scripts/nt-check.py` (prüft Zugang und sucht Pfade),
`scripts/fetch-redispatch.py` (Abruf und Tagesaggregat).

## Rohabruf

15 Spalten:

```
BEGINN_DATUM;BEGINN_UHRZEIT;ZEITZONE_VON;ENDE_DATUM;ENDE_UHRZEIT;ZEITZONE_BIS;
GRUND_DER_MASSNAHME;RICHTUNG;MITTLERE_LEISTUNG_MW;MAXIMALE_LEISTUNG_MW;
GESAMTE_ARBEIT_MWH;ANWEISENDER_UENB;ANFORDERNDER_UENB;BETROFFENE_ANLAGE;
PRIMAERENERGIEART
```

Ein Satz im Klartext:

```
01.08.2026 10:00 UTC bis 18:00 UTC | Strombedingter Redispatch
Wirkleistungseinspeisung reduzieren | 255 MW mittel, 340 MW maximal, 2038 MWh
Amprion weist an | angefordert von 50Hertz & Amprion & TenneT DE & TransnetBW
betroffen: NEURATH_F | Konventionell
```

`BETROFFENE_ANLAGE` nennt teilweise **den einzelnen Kraftwerksblock**
(`NEURATH_F`, `NIEDERAUSSEM_K`), teilweise ein Cluster, teilweise schlicht
`Börse`.

`RICHTUNG` kennt genau zwei Werte, `PRIMAERENERGIEART` drei, `ANWEISENDER_UENB`
vier, `GRUND_DER_MASSNAHME` sechs. Häufigster Grund im August 2026:
*Strombedingter Redispatch* mit 1.430 von 1.647 Sätzen.

## Einheitennachweis aus den Daten selbst

`GESAMTE_ARBEIT_MWH` gegen `MITTLERE_LEISTUNG_MW × Dauer`, August 2026:

| | |
|---|---:|
| geprüfte Sätze | 1.187 |
| Median der relativen Abweichung | **0,09 %** |
| stimmt auf 5 % | 934 Sätze |
| stimmt **nicht** | 253 Sätze |

Damit ist belegt: `MITTLERE_LEISTUNG_MW` ist eine Leistung in MW,
`GESAMTE_ARBEIT_MWH` eine Energie in MWh.

**Aber die Beziehung gilt nicht durchgehend**, und das ist wichtig. Die
Abweichler sind länger (Median 6,0 h gegen 2,75 h) und liegen im Median um
Faktor 1,5 daneben; die Extremfälle betreffen `Börse` und Countertrade und
weichen um mehr als Faktor 20 ab. `MITTLERE_LEISTUNG_MW` ist dort offenbar der
Mittelwert über die **tatsächlich aktive** Zeit, nicht über das genannte
Fenster.

> **Regel daraus:** immer `GESAMTE_ARBEIT_MWH` summieren, **niemals** Leistung
> mal Dauer.

## Zeitzone

Die Datei sagt es selbst: `ZEITZONE_VON = UTC`, in allen 1.647 Sätzen des
August. Im Sommer sind das **zwei Stunden** Unterschied zur Ortszeit —
`01.08.2026 00:45 UTC` ist `01.08.2026 02:45 CEST`. Wer das übersieht, ordnet
Maßnahmen dem falschen Tag zu. `fetch-redispatch.py` liest das Feld und rechnet
um; es nimmt die Zeitzone nicht an.

## Zwei Fallen der API

1. **Eine Bereichsabfrage liefert Überhänge.** `2026-08-01/2026-08-31` gibt
   1.647 Sätze zurück, davon beginnen 323 **vor** dem 1. August. Es wird nach
   dem Abruf noch einmal selbst gefiltert.
2. **Die Reihe beginnt 2021.** Für 2020 und früher antwortet die API mit
   HTTP 400. Die Seite deckt 2015 bis heute ab — Redispatch gibt es also nur
   für den kleineren Teil davon.

## Eine benannte Annahme

Eine Maßnahme wird dem lokalen Kalendertag ihres **Beginns** zugeordnet. Die
Alternative wäre, die Arbeit über Mitternacht zu verteilen — das setzte
gleichmäßige Leistung voraus, und genau die ist bei einem Teil der Sätze
nachweislich nicht gegeben.

**Größe der Annahme:** im August 2026 stecken **209.853 MWh in Maßnahmen, die
über Mitternacht laufen — 22,2 % des Monats.** Das ist nicht klein. Der Wert
steht in jeder erzeugten Datei unter `arbeit_ueber_mitternacht_mwh` und gehört
neben jede Zahl, die daraus gebildet wird.

## Größenordnungsprobe

August 2026:

| | MWh | Anteil |
|---|---:|---:|
| Redispatch gesamt | 945.822 | |
| davon hochgefahren | 444.630 | 47,0 % |
| davon heruntergefahren | 501.192 | 53,0 % |
| Amprion weist an | 395.557 | 41,8 % |
| TenneT DE | 266.671 | 28,2 % |
| 50Hertz | 207.120 | 21,9 % |
| TransnetBW | 76.474 | 8,1 % |
| konventionell betroffen | 592.811 | 62,7 % |
| erneuerbar betroffen | 288.229 | 30,5 % |

**Gegen eine bekannte Bezugsgröße:** die Netzlast des Monats betrug
33.256 GWh. Redispatch entspricht **2,84 %** davon — die Bundesnetzagentur
nennt für Deutschland Größenordnungen im niedrigen einstelligen
Prozentbereich. Die Zahl ist plausibel.

**Selbstkontrolle:** Hoch- und Herunterfahren sollten sich weitgehend
ausgleichen, weil Redispatch die Bilanz nicht verändern soll. 444,6 gegen
501,2 GWh sind 12 % Unterschied. Der Rest steckt in Countertrade und in der
Zuordnung über Mitternacht.

## Lizenz — ungeklärt, deshalb nichts veröffentlicht

Für die Daten auf netztransparenz.de ist **keine Lizenz auffindbar**:

- Es gibt dort **keine Seite „Datennutzung"** und keine
  „Nutzungsbedingungen" — jede geprüfte Adresse antwortet mit HTTP 503, auch
  nach mehreren Versuchen.
- Das **Impressum** sagt wörtlich: *„Inhalt und Gestaltung der Internetseiten
  sind urheberrechtlich geschützt. Eine Vervielfältigung der Seiten oder ihrer
  Inhalte bedarf der vorherigen schriftlichen Zustimmung der deutschen
  Übertragungsnetzbetreiber per E-Mail, soweit die Vervielfältigung nicht
  ohnehin gesetzlich gestattet ist."*

Das ist etwas völlig anderes als CC BY 4.0 bei SMARD oder gemeinfrei bei
Natural Earth. **Solange das nicht geklärt ist, gehören diese Daten nicht in
ein öffentliches Repository und nicht auf eine öffentliche Seite.**

`scripts/fetch-redispatch.py` hat dafür einen Riegel: ohne
`--lizenz-geklaert` schreibt es nichts nach `data/`. Mit `--pruefen VON BIS`
läuft es rein lesend und gibt nur eine Zusammenfassung auf die Konsole — das
ist Belegarbeit, keine Veröffentlichung.

### Wege, das zu klären

1. **Nachfragen.** Die ÜNB veröffentlichen Redispatch aufgrund einer
   gesetzlichen Pflicht (§ 13 EnWG, dazu die EU-Transparenzverordnung). Eine
   kurze Anfrage nach den Bedingungen der Weiterverwendung ist üblich.
   Adressen aus dem Impressum: info@50hertz.com, presse@amprion.net,
   info@tennet.eu, info@transnetbw.de.
2. **Nach den Nutzungsbedingungen des API-Portals sehen.** Bei der
   Registrierung wird in aller Regel etwas akzeptiert; dieses Dokument ist für
   die API maßgeblicher als das Impressum der Webseite.
3. **Nur Kennzahlen statt Daten.** Ein Tagesaggregat ist etwas anderes als eine
   Kopie der Datenbank. Ob das trägt, ist eine Rechtsfrage — und keine, die ich
   entscheide.

Wer den Riegel löst, trägt hier ein, **worauf** er sich stützt.

## Was daraus werden soll

Redispatch ist die **gemessene** Antwort auf die Frage nach dem Netzengpass:
wo wurde heruntergefahren, wo hochgefahren, von welchem Netzbetreiber
angewiesen, welche Anlage war betroffen. Das ist etwas anderes als ein
Lastfluss auf einer Leitung — den gibt es weiterhin nicht — aber es ist der
beste öffentlich belegbare Hinweis darauf, wo das Netz an seine Grenze kommt.

Geplant: eine eigene Kachel, ein Balken je ÜNB, und — weil
`BETROFFENE_ANLAGE` teilweise Blocknamen nennt — der Versuch, sie den
Kraftwerkskoordinaten aus `data/kraftwerke.json` zuzuordnen. Das wäre eine
Karte der tatsächlichen Eingriffe. Erst nach der Lizenzklärung.
