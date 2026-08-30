# Lizenzen der Daten

Der **Code** dieses Repositories steht unter der MIT-Lizenz (siehe `LICENSE`).
Für die **Daten** unter `data/` gilt das nicht. Sie stammen aus drei Quellen mit
drei verschiedenen Lizenzen. Die Unterschiede sind nicht kosmetisch — eine davon
verpflichtet zur Weitergabe unter denselben Bedingungen.

## Übersicht

| Dateien | Quelle | Lizenz | Namensnennung |
|---|---|---|---|
| `data/tage/*.json`, `data/tage-verzeichnis.json`, `data/kraftwerke.json` | SMARD, Bundesnetzagentur | CC BY 4.0 | `Bundesnetzagentur \| SMARD.de` |
| `data/grundkarte.json` | Natural Earth | gemeinfrei (public domain) | keine gefordert |
| `data/netz-hoechstspannung.json`, `data/netz-hochspannung.json`, `data/netz-umspannwerke.json` | OpenStreetMap | **ODbL 1.0** | `© OpenStreetMap contributors` |
| `data/redispatch/*.json` | netztransparenz.de (die vier ÜNB), auch über ENTSO-E | siehe unten — **teilweise ungeklärt** | `netztransparenz.de — 50Hertz, Amprion, TenneT, TransnetBW` |
| `data/mastr-wind.json` | Marktstammdatenregister, Bundesnetzagentur | **dl-de/by-2-0** | `Marktstammdatenregister, Bundesnetzagentur` + Hinweis auf die Veränderung |
| `data/regelzonen-flaeche.json` | **abgeleitet**, nicht erhoben — aus SMARD und OpenStreetMap | **ODbL 1.0** (die schärfere der beiden erbt) | `Bundesnetzagentur \| SMARD.de` und `© OpenStreetMap contributors` |

## SMARD — CC BY 4.0

<https://www.smard.de/home/datennutzung>

Teilen und bearbeiten erlaubt, Quelle muss genannt werden. Die geforderte
Namensnennung lautet wörtlich `Bundesnetzagentur | SMARD.de`. Die
Bundesnetzagentur schließt eine Haftung für Richtigkeit und Vollständigkeit aus.

## Natural Earth — gemeinfrei

<https://www.naturalearthdata.com/about/terms-of-use/>

Wörtlich: *"All versions of Natural Earth raster and vector map data found on
this website are in the public domain."* Keine Namensnennung gefordert. Sie
steht trotzdem in der Fußnote der Seite — wer eine Grafik prüfen will, soll
wissen, woher die Geometrie kommt.

## Marktstammdatenregister — Datenlizenz Deutschland, Namensnennung 2.0

<https://www.marktstammdatenregister.de/MaStR/Datendownload> nennt unmittelbar
neben dem XML-Gesamtdatenexport: *„Lizenz: Datenlizenz Deutschland –
Namensnennung – Version 2.0"*.

- **Namensnennung** nach Absatz 2 der Lizenz: Bezeichnung des Bereitstellers,
  der Vermerk der Lizenz mit Verweis auf den Lizenztext, und ein Verweis auf den
  Datensatz. Alle drei stehen im Kopf jeder `mastr-*.json`.
- **Veränderungshinweis** nach Absatz 3: *„Veränderungen, Bearbeitungen, neue
  Gestaltungen oder sonstige Abwandlungen sind im Quellenvermerk mit dem Hinweis
  zu versehen, dass die Daten geändert wurden."* Hier wird gefiltert und je Park
  zusammengefasst — das steht als eigenes Feld `_veraendert` in beiden Dateien.
- **Eine kleine Unschärfe, benannt:** das Impressum des Registers erklärt die
  Lizenz für Daten *„in den Formaten .xls und .csv"*. Der Gesamtdatenexport ist
  XML. Die Downloadseite selbst nennt die Lizenz aber unmittelbar neben genau
  diesem XML-Export, und das ist die speziellere Angabe. Sie wird hier
  zugrunde gelegt. Wer daran zweifelt, liest zuerst `docs/beleg-mastr.md`.
- Die Lizenz verlangt **kein** Share-alike. Sie färbt nicht auf die anderen
  Dateien und nicht auf den Code ab.

## OpenStreetMap — ODbL 1.0, mit Share-alike

<https://www.openstreetmap.org/copyright> ·
<https://opendatacommons.org/licenses/odbl/1-0/>

Das ist die Lizenz mit Folgen:

- **Namensnennung** wörtlich: `© OpenStreetMap contributors`. Sie steht in der
  Fußnote der Seite, im Popover der Karte und im Kopf jeder `netz-*.json`.
- **Share-alike.** Die Dateien `data/netz-*.json` sind eine *abgeleitete
  Datenbank* im Sinne der ODbL. Wer sie weitergibt oder in eigene Daten
  einarbeitet und diese veröffentlicht, muss das Ergebnis wieder unter ODbL
  stellen.
- **`data/regelzonen-flaeche.json` fällt ausdrücklich darunter.** Sie ist aus
  den OSM-Betreiberangaben *und* aus den SMARD-Kraftwerksdaten gerechnet. Wo
  ODbL und CC BY 4.0 zusammentreffen, gilt für das Ergebnis die schärfere
  Bedingung: ODbL mit Share-alike, und **beide** Namensnennungen. Beide stehen
  im Kopf der Datei. Inhaltlich ist die Datei keine Messung — siehe
  `docs/beleg-regelzonenflaeche.md`.
- Das gilt **nicht** für den Code und **nicht** für die anderen Datendateien.
  Die Lizenzen gelten getrennt nebeneinander, sie färben nicht aufeinander ab.
- Eine aus den Daten erzeugte *Darstellung* — etwa ein Bildschirmfoto der
  Karte — ist ein "Produced Work" und darf unter eigenen Bedingungen
  weitergegeben werden, solange die Namensnennung erhalten bleibt.

### Was die OSM-Daten nicht sind

Sie zeigen **Verlauf und Spannungsebene** von Leitungen und Umspannwerken —
**keinen Lastfluss und keine Auslastung**. Flüsse auf einzelnen Hoch- und
Höchstspannungsleitungen werden nach § 23c Abs. 2 EnWG nicht veröffentlicht.

OpenStreetMap ist außerdem eine Gemeinschaftserhebung, keine amtliche Quelle.
Die Erfassung kann unvollständig oder veraltet sein, besonders auf der
110-kV-Ebene. Mittelspannung ist dort kaum erfasst.

## Redispatch — worauf wir uns stützen, und was offen bleibt

Entschieden von Immo am 31.08.2026. Der Reihe nach, damit später nachvollziehbar
ist, was geprüft wurde:

**Was nicht trägt.** Die Seite
[netztransparenz.de/en/Ancillary-Services/System-operations/Redispatch](https://www.netztransparenz.de/en/Ancillary-Services/System-operations/Redispatch)
nennt **weder eine Rechtsgrundlage noch eine Aussage zur freien Verfügbarkeit**.
Ich habe sie im Volltext durchsucht. Und das Impressum verlangt für
Vervielfältigung die vorherige schriftliche Zustimmung der vier ÜNB.

**Was trägt.** Dieselbe Seite sagt: *„both feed-in management and redispatch
measures for all dates are published on the ENTSO-E Transparency Platform (ETP)
under Redispatch."* Dieselben Tatsachen liegen also auch auf der ENTSO-E
Transparency Platform. Deren Terms of Use führen nach **Klausel 2.5** eine Liste
von Daten, die *„open for free re-use with no need to seek the prior agreement
of the respective Primary Owner of Data"* sind; seit Februar 2022 gilt darauf
**CC BY 4.0** mit Namensnennung von ENTSO-E.

**Was offen bleibt.** Ob Redispatch auf dieser Liste steht, ist nicht geprüft: die
Seite mit der Liste beantwortet meine Abrufe mit HTTP 403. Das ist die einzige
offene Stelle in der Kette und im eingeloggten Portal mit einem Klick zu prüfen.

**Was daraus folgt.** Veröffentlicht werden **Tagesaggregate**, keine Kopie der
Messwertliste: Summen je Tag, je ÜNB und je Primärenergieart. Genannt werden
beide Wege. `scripts/fetch-redispatch.py` schreibt weiterhin nur mit
`--lizenz-geklaert`; der Riegel dokumentiert, worauf sich die Entscheidung
stützt.
