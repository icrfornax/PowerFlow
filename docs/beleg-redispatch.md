# Beleg: Redispatch über die netztransparenz-API

Stand: 31.08.2026. Zuständige Skills: `datenquellen-strom`, `pruefpflichten`.

## Stand in einem Satz

**Zugang steht, Daten belegt, Tagesaggregate 2021–2026 sind eingebunden.** Die
Lizenzkette hat eine offene Stelle, die benannt ist — siehe unten und
`LIZENZ-DATEN.md`.

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

## Jahresmengen und eine zweite Größenordnungsprobe

| Jahr | hochgefahren | heruntergefahren | Schieflage |
|---|---:|---:|---:|
| 2021 | 6.752 GWh | 4.173 GWh | 23,6 % |
| 2022 | 8.290 GWh | 7.234 GWh | 6,8 % |
| 2023 | 11.154 GWh | 6.670 GWh | 25,2 % |
| 2024 | 9.908 GWh | 6.391 GWh | 21,6 % |
| 2025 | 9.277 GWh | 5.518 GWh | 25,4 % |
| 2026 (bis 30.08.) | 4.649 GWh | 4.327 GWh | 3,6 % |

Gesamtvolumen also 15 bis 18 TWh im Jahr — die Bundesnetzagentur nennt für
Deutschland Größenordnungen im zweistelligen TWh-Bereich. Plausibel.

**Hoch ist in jedem Jahr größer als runter**, und das ist keine Panne: die
Quellenseite sagt, dass bei grenzüberschreitenden Redispatch- und
Countertrade-Maßnahmen *„only the part relating to plants or exchange trading
within Germany will be published"*. Der ausländische Gegenpart fehlt also
systematisch. `scripts/validate.py` führt dafür ein Budget von 40 % statt einer
stillen Toleranz — die gemessene Spanne liegt bei 3,6 bis 25,4 %.

## Lizenz — die Kette, und wo sie offen ist

Entschieden von Immo am 31.08.2026. Geprüft und festgehalten, was trägt und was
nicht:

**Was nicht trägt.** Für die Daten auf netztransparenz.de ist keine Lizenz
auffindbar:

- Es gibt dort **keine Seite „Datennutzung"** und keine
  „Nutzungsbedingungen" — jede geprüfte Adresse antwortet mit HTTP 503, auch
  nach mehreren Versuchen.
- Die Seite *Ancillary Services → System operations → Redispatch* nennt
  **weder eine Rechtsgrundlage noch eine Aussage zur freien Verfügbarkeit**. Ich
  habe sie im Volltext durchsucht.
- Das **Impressum** sagt wörtlich: *„Inhalt und Gestaltung der Internetseiten
  sind urheberrechtlich geschützt. Eine Vervielfältigung der Seiten oder ihrer
  Inhalte bedarf der vorherigen schriftlichen Zustimmung der deutschen
  Übertragungsnetzbetreiber per E-Mail, soweit die Vervielfältigung nicht
  ohnehin gesetzlich gestattet ist."*

**Was trägt.** Dieselbe Seite sagt: *„both feed-in management and redispatch
measures for all dates are published on the ENTSO-E Transparency Platform (ETP)
under Redispatch."* Dieselben Tatsachen liegen also auch dort. Die Terms of Use
der ENTSO-E Transparency Platform führen nach **Klausel 2.5** eine Liste von
Daten, die *„open for free re-use with no need to seek the prior agreement of
the respective Primary Owner of Data"* sind; seit Februar 2022 gilt darauf
**CC BY 4.0**.

**Was offen bleibt.** Ob Redispatch auf dieser Liste steht, ist nicht geprüft —
die Seite mit der Liste beantwortet meine Abrufe mit HTTP 403. Das ist die
einzige offene Stelle und im eingeloggten Portal mit einem Klick zu prüfen.

**Was daraus folgt.** Veröffentlicht werden **Tagesaggregate** — Summen je Tag,
je ÜNB und je Primärenergieart — keine Kopie der Messwertliste. Genannt werden
beide Wege. `scripts/fetch-redispatch.py` schreibt weiterhin nur mit
`--lizenz-geklaert`; der Riegel trägt die Begründung im Kopf.

### Der sauberere Weg: direkt von ENTSO-E

Weil die Lizenzkette ohnehin über die ENTSO-E Transparency Platform läuft, wäre
es folgerichtig, die Daten **auch dort zu holen**. Dann stützt sich alles auf
eine Quelle mit ausdrücklichen Nutzungsbedingungen, statt über eine zweite
Plattform zu argumentieren.

Geprüft am 31.08.2026: die API liegt unter `https://web-api.tp.entsoe.eu/api`
und antwortet ohne Token mit **HTTP 401** und einem
`Acknowledgement_MarketDocument`. Der Zugang:

1. Konto auf <https://transparency.entsoe.eu/> anlegen.
2. E-Mail an **transparency@entsoe.eu**, Betreff **„RESTful API access"**, im
   Text die registrierte E-Mail-Adresse. Freischaltung binnen drei Werktagen.
3. Nach der Freischaltung im Konto unter *My Account Settings* das Token
   erzeugen.
4. Übergabe als Parameter `securityToken` bei GET.

Aufwand: eine E-Mail und ein paar Tage warten. Gewinn: die Lizenzfrage wird von
einer Argumentation zu einer Zusage.

### Falls sich das ändern soll

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


## Nachtrag 31.08.2026 — die drei bisher ungenutzten Felder

Die Schnittstelle liefert **15 Felder**; bis zu diesem Tag wurden sieben
gelesen. Nachgesehen wurde über das Jahr 2025 (19.257 Maßnahmen, 14,80 TWh).

### GRUND_DER_MASSNAHME — 14 Werte

| Grund | Maßnahmen | Arbeit | Anteil |
|---|---:|---:|---:|
| Strombedingter Redispatch | 17.177 | 11,485 TWh | 77,6 % |
| Strombedingter Countertrade DE-DK1 | 258 | 2,497 TWh | 16,9 % |
| Probefahrt | 377 | 0,346 TWh | 2,3 % |
| Probestart (NetzRes) | 215 | 0,214 TWh | 1,4 % |
| Spannungsbedingter Redispatch | 201 | 0,171 TWh | 1,2 % |
| Testfahrt (bnBm) | 203 | 0,026 TWh | 0,2 % |
| Strombedingter Countertrade DE-DK2 | 232 | 0,025 TWh | 0,2 % |
| Strom- und Spannungsbedingter RD | 484 | 0,016 TWh | 0,1 % |
| Testfahrt (KapRes) | 81 | 0,009 TWh | 0,1 % |
| übrige (kurativ, Probeabruf, Funktionstest, DE-NO2) | 29 | 0,004 TWh | 0,0 % |

**Zusammen sind 889 Maßnahmen mit 4,1 % der Arbeit Probebetrieb** — angemeldete
Probefahrten, Probestarts, Testfahrten, Probeabrufe, Funktionstests. Das ist
kein Eingriff im Notfall. Die Seite nannte Redispatch vorher pauschal „Eingriff
ins Netz"; für diesen Teil war das falsch und ist korrigiert.

**Und 16,9 % der Arbeit sind Countertrade** — ein Gegengeschäft über eine
Kuppelstelle, kein Eingriff an einer Anlage im Inland.

Gruppiert wird **in der Anzeige, nicht im Abrufskript**: `data/redispatch/*.json`
führt unter `je_grund` den Wortlaut der Quelle. Die Zuordnung steht in
`assets/powerflow.js` unter `RD_GRUNDGRUPPEN` und wird auf der Seite je Gruppe
mit dem Originalwortlaut belegt. Eine Entscheidung dabei: „Strom- und
Spannungsbedingter RD" zählt zur Spannungshaltung, nicht zum Engpass — das
betrifft 0,1 % der Arbeit.

### ANFORDERNDER_UENB — wer das Problem hatte

Angewiesen hat immer einer der vier deutschen Betreiber. **Angefordert** haben
2025 **27 verschiedene Stellen**, darunter ausländische Übertragungsnetz-
betreiber: RTE (Frankreich), APG (Österreich), swissgrid, CEPS (Tschechien),
Statnett (Norwegen), TenneT NL, Energinet (EnDK Ost und West) — und zwei
Verteilnetzbetreiber (50H VNB Mitnetz, WEMAG Netz).

| Anforderer | Maßnahmen | Arbeit |
|---|---:|---:|
| 50Hertz & Amprion & TenneT DE & TransnetBW | 12.659 | 9,161 TWh |
| TenneT DE | 3.489 | 3,976 TWh |
| 50Hertz | 735 | 0,252 TWh |
| Amprion & RTE | 326 | 0,190 TWh |

**Mehrfachnennungen werden nicht aufgeteilt.** Die Quelle sagt nicht, welcher
Anteil auf wen entfällt; eine Aufteilung wäre geraten. Gezählt wird die
Zeichenkette als Ganzes.

### Dauer

Aus BEGINN und ENDE gerechnet. Median **4 Stunden**, kürzeste 0,25 h, längste
25 h (Tag der Zeitumstellung — die Quelle liefert UTC, gerechnet wird lokal).

| Dauer | Maßnahmen | Anteil der Arbeit |
|---|---:|---:|
| bis 1 h | 3.542 (18,4 %) | 1,4 % |
| bis 4 h | 9.665 (50,2 %) | 12,3 % |
| bis 12 h | 16.021 (83,2 %) | 48,1 % |
| bis 24 h | 19.248 (100,0 %) | 99,9 % |

Kurz heißt also nicht wenig Menge: fast jede fünfte Maßnahme dauert höchstens
eine Stunde, trägt aber zusammen nur 1,4 % der Arbeit.

### BETROFFENE_ANLAGE — für eine Karte nicht brauchbar

404 verschiedene Bezeichnungen. Gegen die 596 Kraftwerke aus den
SMARD-Stammdaten **und** die 5.259 Umspannwerke aus OpenStreetMap abgeglichen:

| Zuordnung | Maßnahmen | Anteil der Arbeit |
|---|---:|---:|
| nicht zuordenbar | 10.685 | 76,9 % |
| „Börse" (kein Ort) | 1.192 | 13,3 % |
| Kraftwerk | 1.419 | 8,4 % |
| Umspannwerk | 417 | 1,2 % |

Und die unscharfen Treffer sind teils **falsch**: „Obernburg" wäre „Bernburg"
geworden, „Gebersdorf" wäre „Ebersdorf" geworden — jeweils zwei verschiedene
Orte. Eine Karte daraus wäre eine Behauptung. Der offene Punkt auf der Seite
sagt das jetzt mit Zahlen statt „steht aus".


## ZURÜCKGENOMMEN am 31.08.2026 — die Zahlen waren zu niedrig

Beim Nachrechnen des Jahres 2025 fiel eine Lücke auf: die Seite zeigte 14.883
Maßnahmen, der Rohabruf lieferte 19.257. Die Differenz von 4.374 stand als
`unvollstaendige_saetze` in der Jahresdatei — seit Monaten, ungelesen.

**Die Ursache: das Dezimaltrennzeichen der Quelle ist ein Komma.** Im
Abrufskript stand `float(s["GESAMTE_ARBEIT_MWH"])` ohne Umwandlung. Ein Satz
mit `1306,25` warf `ValueError`, wurde als unvollständig gezählt und mitsamt
seiner Arbeit weggeworfen. Sätze mit glatten Werten (`7`, `29`) gingen durch —
deshalb fiel es nicht auf.

### Wie viel gefehlt hat

| Jahr | vorher | berichtigt | Differenz |
|---|---:|---:|---:|
| 2021 | — | 15,419 TWh | |
| 2022 | — | 22,051 TWh | |
| 2023 | — | 24,809 TWh | |
| 2024 | — | 22,277 TWh | |
| **2025** | **14,796 TWh** | **20,324 TWh** | **+37,4 %** |
| 2026 (bis 30.08.) | — | 13,180 TWh | |

Für 2025 nachgemessen: **4.374 von 19.257 Sätzen (22,7 %)** und **5,529 von
20,324 TWh (27,2 %)** fehlten. Die größte einzelne verlorene Maßnahme war
26.101,10 MWh am 10.02.2025.

Betroffen war auch die abgeleitete Aussage zur Asymmetrie: „hoch gegen runter"
liegt nach der Berichtigung bei **3,2 bis 18,1 %** statt der früher genannten
3,6 bis 25,4 %. Die Lücke hatte die Asymmetrie übertrieben.

### Warum es unentdeckt blieb — und was sich dadurch ändert

Der Zähler `unvollstaendige_saetze` war da. Er wurde nur nie geprüft. **Ein
Zähler, den niemand prüft, ist kein Zähler.**

Zwei Prüfungen stehen jetzt dort, wo vorher Vertrauen war:

1. `scripts/fetch-redispatch.py` **bricht ab**, sobald mehr als 1 % der Sätze
   unlesbar sind — mit dem ausdrücklichen Hinweis, die Grenze nicht anzuheben.
2. `scripts/validate.py` prüft, dass in **keiner** Jahresdatei ein verworfener
   Satz steht. Aktuell: null in allen sechs.

Der Fehler gehört in dieselbe Reihe wie die Textsuchen über eigene Kommentare
und die Zeilenenden: jedes Mal wurde die Fundstelle repariert und nicht die
Bedingung geprüft. Die Regel steht jetzt in CLAUDE.md unter „Umgang mit
Fehlern".
