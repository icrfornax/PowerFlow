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

**GESCHLOSSEN am 03.09.2026: Redispatch steht auf der Liste.** Die ENTSO-E
Transparency Platform war seit dem 31.08. rund 49 Stunden in Wartung (HTTP 503)
und antwortet seit dem 03.09.2026 wieder. Damit war die Liste erreichbar.

Beleg: *List of Data available for free re-use*, Fassung vom **18.10.2023**,
verlinkt im Artikel „Legal Terms and Conditions" des ENTSO-E-Hilfebereichs
(<https://transparencyplatform.zendesk.com/hc/en-us/articles/40921911218961-Legal-Terms-and-Conditions>,
Anhang `231018_List_of_Data_available_for_reuse.pdf`, 236.143 Bytes,
SHA-256 `b21717e8a5a41b9b8544db730d11c2a717abc9b07f89704437a89332b708ff9a`).
Das PDF wird **nicht** in dieses Repository kopiert — es ist ein fremdes
Dokument; die Belegkette braucht die Fundstelle, die Fassung und die
Prüfsumme.

Wörtlich aus der Liste, Zeilen 19 bis 21:

| # | Bezeichnung | Artikel VO 543/2013 |
|---|---|---|
| **19** | **Information relating to redispatching** | **13.1.a** |
| 20 | Information relating to countertrading | 13.1.b |
| 21 | Costs incurred from redispatching and countertrading and from any other remedial actions | 13.1.c |

Und die Bedingung, ebenfalls wörtlich: *„ENTSOE below publishes the list of data
which can be freely re-used by the Data Users in conformity with the open data
standards and licenses under a Creative Commons Attribution 4.0 International
License (CC-BY 4.0). Data Users may freely copy, redistribute, and adapt the
listed data for any purpose, by giving appropriate credit (attribution) to its
source and indicating if they have made any changes, with no need to seek for
the prior agreement of the respective Primary Owner of Data."*

**Die Ausnahmen betreffen uns nicht.** Ausgenommen sind Daten aus Moldau (MD)
und der Türkei (TR), die Datenpunkte #24, 26, 29, 30, 32–35 aus der Ukraine (UA)
und von BritNed sowie Daten der Interconnexion France-Angleterre. Deutschland
steht nicht darunter, und 19 bis 21 sind keine der ausgenommenen Nummern.

**Was daraus folgt.** Die Kette ist geschlossen: netztransparenz.de
veröffentlicht dieselben Maßnahmen, die als Artikel 13.1.a auf der ETP stehen,
und diese sind ausdrücklich unter CC BY 4.0 frei weiterverwendbar. Der Riegel
`--lizenz-geklaert` bleibt trotzdem stehen — er kostet nichts und zwingt jeden,
der das Skript startet, den Kopf zu lesen.

*(Bis zum 03.09.2026 stand hier: „Ob Redispatch auf dieser Liste steht, ist
nicht geprüft — die Seite mit der Liste beantwortet meine Abrufe mit HTTP 403."
Das war der Stand, solange die Plattform nicht erreichbar war.)*

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

---

## Zeitprofil über den Tag — belegt am 31.08.2026, erweitert am selben Tag

Bis hierher stand im ganzen Redispatch-Abschnitt keine einzige Uhrzeit. Man
sah, **wie viel** eingegriffen wurde und **warum**, aber nicht **wann**. Die
Quelle nennt zu jeder Maßnahme Beginn und Ende; daraus lässt sich ein
Tagesprofil bilden, ohne etwas anzunehmen.

Die erste Fassung war eine Reihe einfarbiger Säulen mit einem
`title`-Attribut. Sie sagte nur „mittags mehr als nachts" und beantwortete
keine Anschlussfrage — zu Recht als schwach zurückgewiesen. Die zweite Fassung
gliedert dieselbe Zählung nach vier Merkmalen auf.

### Was gezählt wird — und was ausdrücklich nicht

Gezählt wird je Stunde des Tages, **ob** eine Maßnahme in dieser Stunde lief.
Nicht gezählt wird, **wie viel Arbeit** auf diese Stunde entfiel.

Der Unterschied ist der Kern der Sache. Die Quelle nennt je Maßnahme eine
Gesamtarbeit und ein Fenster, nicht den Verlauf darin. Wer die Arbeit
gleichmäßig über das Fenster verteilt, nimmt konstante Leistung an — und genau
das ist nachweislich falsch: bei **253 von 1.187** geprüften Sätzen des August
2026 ist `MITTLERE_LEISTUNG_MW` der Mittelwert über die tatsächlich aktive
Zeit, nicht über das genannte Fenster (siehe oben in diesem Beleg). Eine
Arbeitskurve über den Tag wäre also eine Grafik über eine Annahme.

„Aktiv oder nicht aktiv" braucht diese Annahme nicht. Der Preis dafür: eine
kurze Maßnahme über 15 Minuten zählt in dieser Stunde genauso wie eine, die
sie ausfüllt. Das steht in der Bildunterschrift auf der Seite.

### Die fünf Reihen je Tag

| Feld | Was drinsteht |
|---|---|
| `aktive_je_stunde` | 24 Zähler: wie viele Maßnahmen liefen in dieser Stunde |
| `stunden_richtung` | dieselbe Zählung, getrennt nach hoch und runter |
| `stunden_je_grund` | nach dem **Grund**, im Wortlaut der Quelle |
| `stunden_je_uenb` | nach dem **anweisenden** Betreiber — das ist die Regelzone |
| `stunden_je_energieart` | nach der betroffenen Erzeugungsart |
| `stunden_dauer_h` | Summe der **Gesamt**dauern der laufenden Maßnahmen; geteilt durch ihre Zahl ergibt das die mittlere Dauer |

Die Aufgliederungen summieren sich je Stunde exakt auf `aktive_je_stunde` auf.
`scripts/validate.py` rechnet das für jeden der 2.052 Tage nach.

**Was die Quelle nicht hat**, und was deshalb auch nicht in der Ablesung steht:

- **Eine Stufe oder Priorität.** Es gibt kein solches Feld. Die 15 Felder sind
  oben in diesem Beleg aufgeführt.
- **Einen Ort.** `BETROFFENE_ANLAGE` ist eine Bezeichnung ohne Koordinate;
  76,9 % der Arbeit ließen sich keinem der 596 Kraftwerke und 5.259
  Umspannwerke zuordnen, und unscharfe Treffer waren teils falsch
  („Obernburg" gegen „Bernburg"). Das **Wo** wird deshalb über den anweisenden
  Betreiber beantwortet — das ist die Regelzone und die einzige belegbare
  Antwort darauf.

### Gemessen über 2021 bis 2026 (2.052 Tage, 657.831 Maßnahmen-Stunden)

| | Stunde | Anteil | im Mittel gleichzeitig |
|---|---|---|---|
| Höchstwert | 11:00 | 5,57 % | 17,9 Maßnahmen |
| Tiefstwert | 00:00 | 2,98 % | 9,5 Maßnahmen |

Das Verhältnis ist **1,87** — mittags läuft knapp doppelt so viel wie
nachts. Der Verlauf ist eine glatte Glocke mit Scheitel zwischen 10 und 13 Uhr.
Das passt zur Erzeugungsseite: die Mittagsspitze der Photovoltaik im Süden
trifft auf einen Transportbedarf, den das Netz nicht trägt.

An **1.335 von 2.052 Tagen (65 %)** lief in **allen 24 Stunden** mindestens
eine Maßnahme. Je Stunde des Tages gilt das an 1.674 bis 1.940 Tagen. Redispatch
ist also kein seltenes Ereignis, sondern Dauerbetrieb — die Frage ist nur, wie
viel gleichzeitig läuft.

### Zuordnung zum Kalendertag — zwei verschiedene Fragen

Die **Arbeit** einer Maßnahme zählt zum Tag ihres Beginns; das ist die
bekannte, im Ergebnis ausgewiesene Annahme (`arbeit_ueber_mitternacht_mwh`).
Die **Stunden** zählen dagegen auf dem Kalendertag, auf dem sie liegen. Eine
Maßnahme von 22 bis 02 Uhr steht mit ihrer Arbeit beim ersten Tag und mit zwei
Stunden beim zweiten. Beides ist richtig, weil es zwei verschiedene Fragen sind.

Ortszeit, wie überall auf dieser Seite. An den Umstellungstagen ist 02:00
doppelt belegt oder gar nicht — das bleibt so stehen und wird nicht geglättet.

### Prüfungen

- `scripts/validate.py`: jeder Tag hat genau 24 Zähler; keine Stunde des Tages
  ist über ein ganzes Jahr leer; die Summe der Maßnahmen-Stunden ist mindestens
  so groß wie die Zahl der Maßnahmen. Die mittlere Prüfung fängt einen Fehler
  ab, der beim Bauen tatsächlich auftrat: ein Zähler, der nur die Anfangsstunde
  jeder Maßnahme sieht, lässt die Nacht leer aussehen.
- `scripts/browsertest.mjs`: 24 Säulen, genau eine höchste, Profil nicht flach,
  jeder Stapel geht auf 100 % auf, die Ablesung geht beim Zeigen auf und führt
  vier Aufgliederungen, die Pfeiltaste rückt weiter, Escape schließt.

---

## ZURÜCKGENOMMEN am 31.08.2026: sechs Sätze ohne Richtung

Beim Gegenrechnen der neuen Stundenreihen ist aufgefallen, dass
`hoch + runter` an drei Tagen nicht auf die Gesamtzahl aufging. Ursache:

**Die Quelle schreibt „erhöhen" nicht immer gleich.** Meist steht dort
`Wirkleistungseinspeisung erhöhen` mit richtigem ö (U+00F6), an einzelnen
Sätzen aber `Wirkleistungseinspeisung erh¿hen` — an der Quelle ist der Umlaut
zu U+00BF zerfallen. Im Abrufskript stand ein Vergleich auf **Gleichheit** mit
dem vollen Wortlaut. Diese Sätze passten in keinen der beiden Zweige: ihre
Arbeit landete weder unter `erhoehen_mwh` noch unter `reduzieren_mwh` und
fehlte damit auch in `gesamt_mwh`. Als Maßnahme gezählt wurden sie trotzdem.

**Umfang, über alle sechs Jahre nachgemessen:**

| Jahr | betroffene Sätze | fehlende Arbeit | Anteil des Jahres |
|---|---|---|---|
| 2022 | 6 von 12.438 | 5.905 MWh | 0,03 % |
| alle übrigen | 0 | 0 | 0 |

Betroffen waren der 22., 23.04., 08.06. und 03.08.2022. Die Jahressumme 2022
steigt damit von 22,051 auf 22,057 TWh. Das ist klein — aber es ist dieselbe
Fehlerklasse wie das Dezimalkomma: **eine Zeichenkette der Quelle wurde
angenommen statt nachgesehen**, und niemand zählte mit.

Was jetzt dort steht:

1. `richtung()` sucht nicht mehr auf Gleichheit, sondern auf das, was den
   Zerfall überlebt: `reduzieren` ist reines ASCII, beim Gegenstück trägt das
   `erh` vor dem Umlaut.
2. Wer trotzdem nicht einzuordnen ist, wird in `saetze_ohne_richtung` und
   `arbeit_ohne_richtung_mwh` gezählt — und `fetch-redispatch.py` **bricht ab**,
   sobald dort etwas steht. Jede Maßnahme fährt hoch oder runter; ein Drittes
   gibt es nicht.
3. Dasselbe für den anweisenden Betreiber: was nicht zu den vier gehört, stand
   vorher in einem stillen `if u in ...` und fiel heraus. Jetzt zählt
   `anweiser_ausserhalb_der_vier` mit, und auch das bricht ab.
4. `scripts/validate.py` prüft beide Zähler in den fertigen Dateien nach.


---

## Nachtrag 02.09.2026: die Schieflage kippt

Die Aussage „das Hochfahren ist in jedem Jahr größer als das Herunterfahren"
gilt nicht mehr. Über die sechs Jahre gemessen:

| Jahr | hoch | runter | Schieflage |
|---|---|---|---|
| 2021 | 9,106 TWh | 6,313 TWh | +18,1 % |
| 2022 | 11,503 | 10,554 | +4,3 % |
| 2023 | 13,980 | 10,829 | +12,7 % |
| 2024 | 12,179 | 10,097 | +9,4 % |
| 2025 | 11,267 | 9,057 | +10,9 % |
| **2026** (bis 31.08.) | **6,392** | **6,820** | **−3,2 %** |

Der Seitentext nannte die Spanne zweimal falsch — erst mit 3,6 bis 25,4 % aus
den durch das Dezimalkomma lückenhaften Zahlen, danach mit „in jedem Jahr",
was für 2026 nicht mehr stimmt. Beides fiel niemandem auf, weil die Zahl in
Prosa stand und niemand nachrechnete.

`scripts/validate.py` rechnet die Spanne jetzt bei jedem Lauf aus den
Jahresdateien nach und vergleicht sie mit dem Wortlaut der Seite; ein
Negativtest verstellt sie absichtlich und muss anschlagen. Der Satz „in jedem
Jahr größer" darf nur dann dort stehen, wenn kein Jahr ein negatives Vorzeichen
hat.

---

## 03.09.2026: Redispatch von ENTSO-E geholt — und NICHT umgestellt

Auftrag war, Redispatch direkt von der ENTSO-E Transparency Platform zu holen,
nachdem die Lizenzkette dorthin führt. Der Abruf funktioniert. Umgestellt wird
trotzdem nicht, und zwar aus einem gemessenen Grund: **die ENTSO-E-Reihe ist
deutlich unvollständiger als netztransparenz.de.**

### Der Zugang — belegt, nicht angenommen

Die Dokumentation nennt zwei getrennte Datenpunkte: *RedispatchingInternal
[13.1.A]* und *RedispatchingCrossBorder [13.1.A]*, beide in der Fassung r3.2
(Hilfebereich der Plattform, zuletzt geändert 03.07. bzw. 10.07.2026).

Im RESTful API sind das:

| | Parameter |
|---|---|
| intern | `documentType=A63&businessType=A85&in_Domain=<CTA>&out_Domain=<CTA>` |
| grenzüberschreitend | `documentType=A63&businessType=A46&in_Domain=<CTA-A>&out_Domain=<CTA-B>` |

**Die Domäne ist die Regelzone, nicht die Gebotszone.** Mit
`10Y1001A1001A82H` (DE-LU) antwortet die API „No matching data found"; mit den
vier CTA-Codes (`10YDE-VE-------2`, `10YDE-RWENET---I`, `10YDE-EON------1`,
`10YDE-ENBW-----N`) kommt ein `TransmissionNetwork_MarketDocument`. Das ist
nicht geraten — die Fehlermeldung nennt den Datenpunkt, der angesprochen wurde.

**Einheit aus den Daten:** `quantity_Measurement_Unit.name` = `MWH`, im
Dateischema als `CapacityImpact[MWh/MTU]` bezeichnet. **`curveType` ist A03** —
ein Wert gilt, bis der nächste genannte Punkt kommt; die Punkte sind
lückenhaft numeriert (1, 5, 29, 33, 37 …). Wer sie ohne diese Ausdehnung
summiert, unterschätzt grob.

### Die Gegenprobe — acht Tage, dieselbe Frage

Summe der Arbeit je lokalem Kalendertag, vier Regelzonen, gegen unsere
netztransparenz-Datei:

| Tag | ENTSO-E | netztransparenz | Anteil | Reihen | Maßnahmen |
|---|---|---|---|---|---|
| 21.08.2026 | 9.312 MWh | 15.629 MWh | 59,6 % | 20 | 30 |
| 22.08. | 13.320 | 56.182 | 23,7 % | 22 | 65 |
| 23.08. | 21.834 | 52.280 | 41,8 % | 19 | 48 |
| 24.08. | 4.276 | 6.819 | 62,7 % | 17 | 19 |
| 25.08. | 24.280 | 60.567 | 40,1 % | 54 | 105 |
| 26.08. | 21.606 | 52.874 | 40,9 % | 35 | 75 |
| 27.08. | 77.912 | 250.184 | 31,1 % | 60 | 147 |
| 28.08. | 43.755 | 143.220 | 30,6 % | 51 | 108 |

**Grenzüberschreitendes Redispatch ist an diesen Tagen leer** — alle 80
Kombinationen der vier deutschen Regelzonen mit zehn Nachbarn ergaben null.

Die Lücke hängt nicht an der Auslegung von `curveType` A03: die beiden
denkbaren Alternativen (Wert gilt nur für seine eine MTU; oder die Zahl ist
Leistung statt Arbeit) machen die ENTSO-E-Summe **kleiner**, nicht größer.
Unabhängig davon zählt die Reihenzahl: **51 Zeitreihen gegen 108 Maßnahmen**
am 28.08. Es sind schlicht weniger Vorgänge veröffentlicht.

### Was daraus folgt

netztransparenz.de bleibt die Quelle. Ein Wechsel würde ein Drittel bis zwei
Drittel der Arbeit verlieren — genau der Fehler, den das Dezimalkomma schon
einmal verursacht hat, diesmal nur mit besserer Begründung.

Der Nutzen des ENTSO-E-Zugangs liegt anderswo und ist eingelöst: **die
Lizenzkette ist geschlossen** (Datenpunkt 19, Artikel 13.1.a, CC BY 4.0). Dass
die ETP-Reihe unvollständiger ist, ändert daran nichts — sie belegt die
Freigabe, sie muss nicht die Datenquelle sein.

Offen bleibt, WARUM die ETP-Reihe kürzer ist. Denkbar wäre eine Schwelle, eine
andere Abgrenzung des Begriffs oder ein Meldeverzug. Das ist nicht geprüft und
wird nicht behauptet.
