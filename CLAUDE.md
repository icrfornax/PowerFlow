# PowerFlow

Statisches Daten-Dashboard auf GitHub Pages zu Stromfluessen und -mengen im
deutschen Stromnetz.

- Repository: `icrfornax/PowerFlow` (public)
- Zielpfad: `icrfornax.github.io/PowerFlow/`
- Vorbild: `icrfornax/de-gas-storage-tracker-bnetza` ("Flussbilanz-Labor").
  Aufbau, Gestaltung und Sorgfaltsniveau werden von dort uebernommen.

## Arbeitsumgebung

Dieses Projekt laeuft **lokal mit Claude Code und git** unter
`C:\Projekte\PowerFlow`. Du schreibst Dateien direkt, committest und pusht.

Die urspruengliche Projektanweisung stammt aus einem reinen Browser-Workflow.
Folgende Regeln von dort gelten hier **nicht** mehr und sind bewusst gestrichen:
kein Terminal, kein lokaler Klon, Dateilieferung per Upload, Dateinamen ohne
Bindestriche, Arbeit ueber die Browser-Erweiterung. Dateinamen duerfen normal
mit Bindestrichen benannt werden.

## Leitfrage — entschieden am 30.08.2026

**Wo wird in Deutschland an einem Tag Strom erzeugt, wo verbraucht, und wie
gross ist das Ungleichgewicht je Regelzone?** Dazu, welcher Anteil von aussen
kommt — je Kuppelstelle.

Nord-Sued und Ost-West erscheinen als **Folgerung aus gemessenen Groessen**,
nicht als eigene Zahl. Grund: Fluesse zwischen den vier Regelzonen werden nicht
veroeffentlicht (Deutschland und Luxemburg sind eine einzige Gebotszone, die
EU-Verordnung 543/2013 Art. 12.1(g) verlangt physikalische Fluesse nur zwischen
Gebotszonen). Ein Pfeil "50Hertz nach TransnetBW: X GW" waere eine
Modellrechnung und ist damit ausgeschlossen. Beleg: `docs/beleg-smard.md`.

## Freie Variable — entschieden am 30.08.2026, erweitert am 31.08.2026

**Der dargestellte Zeitraum.** Ein einzelner Tag ist der Sonderfall von = bis.
Genau ein Regler auf der Seite, sonst keiner. Er besteht aus zwei Datumsfeldern
und bleibt trotzdem eine einzige freie Variable; `scripts/validate.py` prueft,
dass es genau zwei sind und kein Schieberegler dazukommt. Die Schnellwahl
(Letzte 7 Tage, Voriger Monat, ...) setzt denselben Regler und ist keine
zweite Variable.

Waehlbar ist jeder Zeitraum ab 01.01.2015.

Der **Bezugswert ist damit fest**: derselbe Zeitraum ein Jahr frueher, reale
Messwerte. Kein Monatsmittel, keine geglaettete Kurve.

**Darstellungstiefe folgt der Laenge:** bis einschliesslich sieben Tage
stuendlich (`data/verlauf/`), darueber tageweise (`data/tage/`). Eine Woche sind
168 Punkte und noch gut zu lesen; ein Monat in Stundenwerten waere Kammputz.
Vorbild fuer die Darstellung ist energy-charts.info.

## Umfang

Gemessen oder als Stammdatum bereitgestellt und damit im Umfang:

- Erzeugung nach Quelle, Last, Import/Export als Tagesbilanz — **belegt**
- Erzeugung und Last **je Regelzone**; die vier Zonen summieren sich exakt auf
  Deutschland — **belegt**
- Grenzueberschreitende Fluesse **je Kuppelstelle**, Import und Export getrennt
  je Nachbarland — **belegt**, `docs/beleg-aussenhandel.md`
- **596 Kraftwerksstandorte mit Koordinaten**, davon 211 Bloecke mit
  viertelstuendlicher Erzeugung — **belegt**, `docs/beleg-kraftwerksdaten.md`
- Redispatch als eigene Kachel (netztransparenz.de) — noch nicht erschlossen,
  braucht ein Zugangstoken
- Geografie von Leitungen und Umspannwerken — **belegt**,
  `docs/beleg-netzgeometrie.md`: 10.022 Abschnitte 220/380 kV, 39.452 Abschnitte
  110 kV, 5.259 Umspannwerke aus OpenStreetMap. Mittelspannung ist dort kaum
  erfasst und bleibt aussen vor. Masten (207.805) sind nicht im Umfang.

Nicht im Umfang, weil nicht messbar: **Fluesse auf einzelnen Leitungen** und
**Fluesse zwischen den vier Regelzonen**. Nach § 23c Abs. 2 EnWG werden
grenzueberschreitende Lastfluesse nur zusammengefasst je Kuppelstelle
veroeffentlicht; Standort- und Anlagendaten der Uebertragungsnetzbetreiber sind
vertraulich, auch in aggregierter oder ableitbarer Form. Oeffentliche
Leitungsauslastungen sind Modellrechnungen, keine Messung.

Die Geografie einer Leitung darf gezeigt werden, sobald sie belegt ist. Ihre
Auslastung nicht. Der Unterschied wird auf der Seite ausdruecklich benannt und
gehoert in den Abschnitt "Was ich nicht belegen konnte", nicht in eine Grafik.

Merkposten: Die deutschen Regelzonen enden nicht an der Staatsgrenze. 15
Anlagen mit 4.469 MW in Luxemburg, Oesterreich und der Schweiz gehoeren zu
Amprion, TenneT und TransnetBW. Wer sie geografisch herausfiltert, verfaelscht
die Regelzonenbilanz.

## Arbeitsweise

- Erst Dokumentation lesen, dann handeln. Kein Ausprobieren auf gut Glueck.
  Sorgfalt vor Geschwindigkeit.
- Shell-Kommandos immer als Einzeiler, nie mehrzeilig.
- Vor jedem CLI-Aufruf die aktuelle Dokumentation pruefen, nicht aus dem
  Gedaechtnis zitieren.
- Keine Passwoerter, Tokens oder API-Schluessel eingeben oder in Dateien
  schreiben. Secrets gehoeren in GitHub Actions Secrets oder in eine lokale
  `.env`, die gitignored ist.
- Kein irreversibler Schritt ohne ausdrueckliches Ja von Immo im Chat: kein
  `push --force`, kein Loeschen, keine Aenderung an Repository-Einstellungen
  oder Pages-Konfiguration.
- Read-only-Diagnose vor jeder Aenderung.

## Datendisziplin

- **Messen statt modellieren.** Tagesgenaue Messreihen aus Primaerquellen. Wo
  eine Vergangenheit fortgeschrieben wird, der reale Wert desselben Kalendertags
  aus dem gewaehlten Referenzjahr — kein Monatsmittel, keine geglaettete Kurve.
- **Genau eine freie Variable.** Alles Uebrige kommt aus der Messung.
- **Jede Annahme wird als Annahme benannt** — im Seitentext, im CSV-Kopf und im
  PDF. Dazu, ob sie das Ergebnis bewegt oder nur die Beschriftung.
- **Groessenordnung pruefen**, bevor eine Zahl angezeigt wird. Mindestens eine
  Kennzahl auf eine menschlich beurteilbare Bezugsgroesse umrechnen.
- **Zahlformate:** Anzeige deutsch ueber `Intl.NumberFormat("de-DE")`, CSV
  maschinenlesbar mit Punkt als Dezimaltrennzeichen. Den Unterschied im
  Dateikopf erklaeren.
- **Das Dezimaltrennzeichen jeder neuen Quelle wird NACHGESEHEN, nicht
  angenommen** -- und das Ergebnis als Kommentar an die Lesestelle geschrieben.
  Es hat einmal 27 % der Redispatch-Arbeit gekostet: netztransparenz.de
  schreibt `1306,25`, `float()` warf ValueError, die Ausnahme wurde still
  verschluckt. Stand der Pruefung vom 31.08.2026:

  | Quelle | Format | Lesestelle |
  |---|---|---|
  | SMARD | echte JSON-Zahlen, kein Text | `smard.py::reihe` prueft den Typ |
  | netztransparenz.de | CSV, **Komma** | `fetch-redispatch.py::zahl` |
  | Marktstammdatenregister | XML, **Punkt** | `fetch-mastr.py::zahl` |
  | OpenStreetMap | Text, `voltage` mit `;` | `fetch-netz.py::spannung` |
  | Natural Earth | GeoJSON-Zahlen | keine Umwandlung |

- **Ein `except: return 0` oder `continue` beim Zahlenlesen ist verboten, wenn
  niemand mitzaehlt.** Genau so verschwand die Redispatch-Arbeit. Jede
  Lesestelle zaehlt, was sie nicht lesen konnte, schreibt den Zaehler in die
  Datei, und das Abrufskript BRICHT AB, wenn er ueber ein enges Budget steigt.
  `validate.py` prueft die Zaehler in den fertigen Dateien noch einmal nach.
  Ein Zaehler, den niemand prueft, ist kein Zaehler.
- **Keine Zahl ohne Herkunft.** Durchgesetzt durch `scripts/quellen.py`: es
  ordnet jede Datei unter `data/` einer Quelle zu und **bricht ab**, wenn eine
  ohne Zuordnung auftaucht. Das Ergebnis steht als Tabelle am Seitenende.
  Es werden ausschliesslich gemessene oder als Stammdatum veroeffentlichte
  Werte gefuehrt -- nichts modelliert, nichts geschaetzt. Uebernommene Zahl: Herausgeber, Dokument, Jahr.
  Selbst gerechnete Zahl: die Formel.

## Technik

- Statische Seite, kein Build-Schritt, kein Paketmanager im Frontend.
- Ein einziges Vanilla-JS-Modul als IIFE, das sein Markup selbst erzeugt und vor
  einem Anker in der `index.html` einhaengt. **Keine globalen Bindungen** —
  Top-Level-`const` kollidiert sonst mit vorhandenen Skripten derselben Seite.
- Datum immer lokal formatieren, **nie** `toISOString()`. Das rechnet nach UTC
  und verschiebt in Europa jeden Tag um eins.
- Kein `localStorage`. Aller Zustand kommt aus den Dateien im Repository.
- **Drei Datenlizenzen, getrennt zu fuehren:** CC BY 4.0 (SMARD), gemeinfrei
  (Natural Earth), ODbL 1.0 mit Share-alike (OpenStreetMap). Siehe
  `LIZENZ-DATEN.md`. Der Code bleibt MIT. Die Lizenzen faerben nicht
  aufeinander ab, aber die ODbL-Namensnennung darf nirgends fehlen.
- `data/` fuer CSV/JSON, `scripts/` fuer Python-Abrufskripte. Python-
  Standardbibliothek wo moeglich; jede zusaetzliche Abhaengigkeit begruenden.
- Cache-Buster an CSS und JS (`?v=JJJJMMTT-stichwort`), bei jeder Lieferung
  erhoeht.
- `.nojekyll` im Wurzelverzeichnis. Ohne die Datei laeuft die Auslieferung
  durch Jekyll; das ist fuer eine reine Vanilla-Seite unnoetig und kann Dateien
  unterschlagen. Nicht loeschen.

## Gestaltung

- **Zwei Farbfamilien, zwei Bedeutungen, nie gemischt.** Energietraeger faerben
  die Kraftwerkspunkte auf der Karte UND die Baender im Verlaufsdiagramm --
  mit denselben Tokens. Braunkohle ist ueberall dieselbe Farbe, unabhaengig vom
  Betreiber. Regelzonen faerben die Hoechstspannungsleitungen; die
  Strichstaerke folgt der Spannungsebene. Farbe sagt WER, Staerke sagt WELCHE
  SPANNUNG.
- **Kein Balken ohne genannten Massstab.** Zwei Saeulen nebeneinander werden
  verglichen, ob man will oder nicht. Getrennte Massstaebe machen daraus eine
  Falschaussage: 170 GWh Einfuhr aus Frankreich standen als kurzer Strich neben
  278 GWh Ausfuhr nach Oesterreich als vollem Balken -- das las sich wie ein
  Vielfaches und ist das 1,6-fache. Seitdem gilt: Einfuhr und Ausfuhr teilen
  einen Massstab (dieselbe Groesse, zwei Richtungen), die Energietraeger haben
  einen eigenen (eine Groessenordnung groesser, sonst waere jedes Land
  unsichtbar), und **jede Saeule schreibt ihren Massstab ueber die Liste** --
  darueber, nicht darunter. Wer die Balken schon gelesen hat, liest den
  Massstab zu spaet.
- Dunkles Grundschema mit hellem Gegenstueck, beide gleichwertig gepflegt.
  Akzent Teal fuer Zufluss/positiv, Orange fuer Warnung und Luecke, Gruen fuer
  den Zielpfad, gedaempftes Violett fuer den Bestand. Semantische Farbe nie
  dekorativ.
- Aufbau von oben nach unten: Kennzahlen-Kacheln, zentrale Grafik mit Zufluss
  links, Bestand Mitte, Abfluss rechts, dann Zeitachse mit Wochen- und
  Monatsraster, darunter Downloads, darunter die Quellenfussnote.
- Jede Karte zeigt den Tageswert gross und darunter klein den Bezugswert
  (Jahresmittel, Vorjahr, Norm). Nie nur eine Zahl ohne Massstab.
- Regler nur fuer die freie Variable. Gemessenes bekommt den Hinweis
  "kein Regler — gemessener Tageswert".
- Zuruecksetzen-Knopf stellt exakt den Zustand des ersten Seitenaufrufs her,
  inklusive gerundeter Reglerstellungen.
- Popover schliessen beim Wegbewegen des Zeigers, aber nicht beim Scrollen,
  solange ihr Knopf sichtbar bleibt. Klick heftet an, Escape schliesst.
- **Gesaettigte Fuellung gehoert an kleine Marken, nie an grosse Flaechen.**
  Die Baender des Verlaufs tragen ihren Traegerton stark gedaempft; die
  Saettigung sitzt in Legende, Oberkante und Ablesung. Getrennt werden zwei
  Baender durch eine haarduenne Oberkante, nicht durch eine Umrandung ringsum.
  Textur ist ein Zuschaltmerkmal fuer Ausdruck und Farbsehschwaeche, kein
  Grundzustand -- eine frueher gelieferte Fassung mit dauerhafter Schraffur auf
  jedem Band ist zurueckgenommen, sie war selbst die Stoerung.
- **Netzlast und Preis sind keine Energietraeger.** Sie haben eigene Tokens
  (`--last-linie`, `--preis-linie`) ausserhalb der Traegerfamilie, damit die
  Netzlast nicht als Wind und der Preis nicht als Photovoltaik gelesen wird.
- **Die Preisachse steht fest bei -100 bis 400 Euro je MWh** -- ein fester
  Rahmen macht zwei Zeitraeume vergleichbar. Sie weitet sich, sobald der
  Zeitraum darueber hinausgeht; die Quelle kennt -500,00 Euro (02.07.2023,
  14 Uhr) und +936,28 Euro (12.12.2024, 17 Uhr). Ein gemessener Wert wird nie
  am Bildrand abgeschnitten.
- **Ein Farb-Token ist keine Schriftfamilie.** `font-family: var(--schrift)` ist
  ungueltig und faellt stillschweigend auf die geerbte Schrift zurueck -- eine
  Beschriftung stand dadurch in der Ziffernschrift. Sichtbar nur im
  Bildschirmfoto, in keiner Pruefung; `validate.py` prueft es jetzt.
- Beschriftungen nennen Einheit und Bezug.
- Zugaenglichkeit: sichtbarer Fokus, aria-Beschriftungen an Knoepfen ohne Text,
  `prefers-reduced-motion` beachten, Tabellen und Grafiken mit eigenem
  Scrollcontainer.

## Umgang mit Fehlern

- **Jeder behobene Fehler bekommt eine Pruefung, nicht nur einen Flicken.**
  Dreimal ist dieselbe Klasse wiedergekommen, weil nur die Fundstelle
  repariert wurde: Textsuchen, die ueber eigene Kommentare stolperten;
  Template-Literale, in denen `\.` zu `.` zerfaellt; und Schreibstellen ohne
  `newline`, die unter Windows CRLF erzeugen. Erst als validate.py bzw. der
  Browsertest die BEDINGUNG geprueft hat statt der Stelle, war es vorbei. Die
  Frage nach jeder Behebung lautet deshalb: welche Pruefung haette das
  gemeldet, und steht sie jetzt da?
- Eigenen Fehler als solchen benennen und sagen, was ihn verursacht hat. Keine
  Beschoenigung.
- Eine frueher aufgestellte Behauptung, die nach dem Nachrechnen nicht haelt,
  ausdruecklich zuruecknehmen und ueberall korrigieren — auch im PDF und in den
  Popovers.
- Nicht Belegbares bleibt als offener Punkt im Dokument stehen, es wird nicht
  weggelassen.
- Bevor du Text in einer Datei aenderst, die du nicht selbst geschrieben hast:
  pruefen, ob ein Skript oder ein Workflow auf genau diesen Text prueft.

## Stand

Erledigt: Leitfrage entschieden; SMARD-Reihen fuer Last, Erzeugung, Regelzonen
und Aussenhandel belegt; Kraftwerksstammdaten belegt; Abrufskripte, Rumpf der
Seite und Validierungsskript mit Negativtests liegen im Repository.

Ausserdem erledigt: Tagesreihen 2015-2026 in SMARD-Aufloesung "day", Tagesregler
mit Zuruecksetzen, Grundkarte aus Natural Earth (gemeinfrei, ohne fremde
Kartenkacheln), CSV-Export je gewaehltem Tag.

Ausserdem erledigt: Tagesverlauf als gestapeltes Flaechendiagramm mit geprueften
Farben, zoom- und verschiebbare Karte mit Klickauswahl statt Mouseover,
gemessene Flussrichtung an den Kuppelstellen.

Ausserdem erledigt: Zeitraumwahl mit Schnellwahl, Karte fuellt ihren Rahmen,
drei GitHub-Actions-Workflows (taeglicher SMARD-Abruf, monatliche Stammdaten,
Tuersteher bei jeder Aenderung).

Ausserdem erledigt (31.08.2026): der Verlauf ist ruhig gestellt -- gedaempfte
Flaechen statt Schraffur, Netzlast in eigenem Blau, Preis als Stufenflaeche in
gedaempftem Gelb mit fester Achse. Achte Kennzahl: Anteil der Erneuerbaren an
der Netzlast.

Ausserdem erledigt (31.08.2026): Zufluss zeigt Erzeugung UND Import als zwei
eigene Saeulen, die Mittelsaeule rechnet die Bilanz vor, und ein eigener
Abschnitt zeigt die Erzeugung nach Energietraeger je Regelzone -- mit den
Traegerfarben, fester Stapelreihenfolge und der Gegenprobe gegen die
Deutschlandsumme. Der Zeitraumblock bleibt beim Scrollen oben stehen und
enthaelt jetzt den Hell/Dunkel-Knopf; die Abschnittsueberschrift "Freie
Variable" ist weg.

Ausserdem erledigt (31.08.2026): Regelzonen als Flaeche auf der Karte -- siehe
den eigenen Abschnitt unten.

Ausserdem erledigt (31.08.2026): Windparks aus dem Marktstammdatenregister --
siehe eigenen Abschnitt unten. Ausserdem behoben:
Marken auf der Karte werden absteigend nach Leistung gezeichnet (der kleine
Kreis liegt oben) und behalten beim Zoomen ihre Bildschirmgroesse, damit ein
Zoom eine Haeufung ueberhaupt aufloest.

## Offene Punkte -- durchgegangen am 31.08.2026

Mit Immo Punkt fuer Punkt sortiert. Die Liste auf der Seite hat seither eine
Reihenfolge; was oben steht, traegt die Markierung "Als Naechstes".

**Hoch:** Redispatch direkt von der ENTSO-E Transparency Platform holen statt
von netztransparenz.de -- die Lizenzkette laeuft ohnehin ueber die ETP.

**Erledigt am 03.09.2026:** die Lizenzfrage (Punkt 1, siehe oben), der
ENTSO-E-Zugang (Punkt 2 -- der Schluessel wirkt, HTTP 200) und das Methodik-PDF
(Punkt 3, `scripts/methodik.py`). Die drei standen noch als "Als Naechstes" auf
der Seite, obwohl zwei davon laengst lagen. Was erledigt ist, gehoert nicht in
eine Liste offener Punkte -- sonst glaubt sie irgendwann niemand mehr.

**Niedrig:** Gesamtlauf ueber alle Vergleichsjahre als CSV; Viertelstundenwerte
(48 statt 12 MB, die jeder mitlaedt); die 1.030 Windanlagen ohne Koordinate im
Register.

**Erledigt am 31.08.2026:** Import und Export im Verlauf. `data/verlauf/*.json`
fuehrt jetzt `import_mwh` und `export_mwh` je Stunde, summiert ueber alle elf
Nachbarlaender. Anlass war die Frage nach dem Preis der Ein- und Ausfuhr --
die MUSS stuendlich gewichtet werden, mit Tagesmitteln kommt etwas anderes
heraus (67,53 statt 77,65 Euro je MWh fuer die Ausfuhr 2023-2026). Beleg:
`docs/beleg-verlauf.md`.

**Gestrichen:** kleine Windparks unter 5 MW; Solaranlagen. Beide Entscheidungen
bleiben in `docs/beleg-mastr.md` belegt.

**Nach "Grenzen" verschoben**, weil eine Grenze der Quelle keine Aufgabe ist:
eine Regelzone je Windpark; Redispatch auf der Karte.

## Marktstammdatenregister

Erledigt am 31.08.2026. Beleg: `docs/beleg-mastr.md`, Abruf durch
`scripts/fetch-mastr.py`.

**Der Gesamtdatenexport ist ein ZIP von 3,16 GB.** Gebraucht wird ein Bruchteil.
Ein ZIP traegt sein Inhaltsverzeichnis am Ende, und der Server beantwortet
Range-Anfragen -- das Skript liest deshalb gezielt einzelne Archivmitglieder.
Fuer Wind sind das **9,5 MB statt 3.160 MB**. Wer das Skript umbaut, behaelt
diesen Weg; ein voller Download waere in einem Workflow nicht tragbar.

- **Einheit aus den Daten bewiesen:** E-115 = 3000, V90 = 2000, E-101 = 3050.
  Das sind KILOWATT. Die Doku wurde nicht abgeschrieben.
- **Groessenordnungsprobe gegen SMARD:** 81,62 GW Wind in Betrieb gegen eine
  gemessene Spitze von 53,23 GW zeitgleich -- 65 %, plausibel.
- **Zahlencodes werden aus `Katalogwerte.xml` aufgeloest, nie geraten.**
- **Die Schwelle ist eine Wahl:** Windparks ab 5 MW. Grund ist nicht
  Geschmack: unterhalb fehlen im Register haeufig die Koordinaten.
- **Zusammengefasst wird ueber eine Angabe des Registers**, nicht ueber eigene
  Naehe: `NameWindpark`. Der Ort eines Parks ist der Mittelwert der
  Anlagenorte -- eine Rechnung, und sie wird benannt.
- **Die Karte zeigt eine Auswahl, die Datei nicht:** alle Parks auf See und die
  20 groessten an Land. Das steht an der Ebene. Die Datei unter `data/` bleibt
  vollstaendig und steht im Abzug.
- **SOLAR IST GEPRUEFT UND VERWORFEN.** 1,08 GB gepackt, und selbst ab 1 MW
  blieben rund 11.500 Standorte -- kein Zugewinn auf einer Karte, die vom Netz
  und von den grossen Erzeugern handelt. Entschieden von Immo am 31.08.2026.
  Die Pruefergebnisse stehen in `docs/beleg-mastr.md`, damit niemand die
  1,08 GB ein zweites Mal laedt, um dasselbe herauszufinden.
- **Lizenz dl-de/by-2-0**, siebte Lizenz im Projekt. Absatz 3 verlangt den
  Hinweis, DASS veraendert wurde -- er steht als Feld `_veraendert` in der
  Datei. Kein Share-alike.
- **1.030 Windanlagen in Betrieb haben keine Koordinate** und fehlen. Das ist
  eine Luecke der Quelle und steht in den offenen Punkten.

## Regelzonen als Flaeche -- die einzige Ableitung

Erledigt am 31.08.2026, aber unter Auflagen. Beleg:
`docs/beleg-regelzonenflaeche.md`, erzeugt von `scripts/zonenflaeche.py`.

**Eine belegte Geometrie der Regelzonen gibt es nicht.** Overpass liefert fuer
Grenzrelationen der vier UeNB NULL Treffer, die Bundesnetzagentur
veroeffentlicht eine Netzkarte als PDF. Bundeslandgrenzen sind kein Ersatz --
die Zonen folgen ihnen nicht.

Die Flaeche ist deshalb **interpoliert**: jede Rasterzelle (0,02 Grad) bekommt
die Zone ihres naechstgelegenen Stuetzpunktes. Stuetzpunkte sind 596 Kraftwerke
mit amtlicher Zonenangabe aus den SMARD-Stammdaten und 3.200 ausgeduennte
Leitungsknoten mit eindeutigem OSM-Betreiber. Leitungen mit dem Betreiber "RWE"
bleiben bewusst draussen -- die Gleichsetzung mit Amprion waere eine Annahme.

**Gemessene Trefferquote: 93,3 %.** Fuer jedes der 596 Kraftwerke wird die Zone
aus den uebrigen Stuetzpunkten vorhergesagt; 556 stimmen, 40 nicht, vor allem
am Oberrhein und an der Grenze Bayern/Hessen. Das Skript BRICHT AB, wenn die
Quote unter 85 % faellt.

Fuenf Auflagen, die nicht aufgeweicht werden duerfen:
1. Die Ebene ist auf der Karte **voreingestellt aus**.
2. Sie heisst in der Ebenenliste ausdruecklich "abgeleitet".
3. Die Trefferquote steht im Abschnitt "Grenzen", nicht im Kleingedruckten.
4. Im Quellenverzeichnis steht sie unter der eigenen Quelle "PowerFlow,
   abgeleitet -- KEINE Messung", nicht neben den Messungen.
5. Sie wird blass gezeichnet und liegt UNTER Leitungen, Umspannwerken und
   Kraftwerken. Das Gemessene bleibt oben.

Der Satz "nichts modelliert" im Quellenverzeichnis gilt weiterhin fuer jede
ZAHL. Fuer Geometrie gilt er nicht mehr uneingeschraenkt, und der Hinweis sagt
das jetzt selbst. `scripts/validate.py` prueft beides.

## Redispatch

Eingebunden: Tagesaggregate 2021 bis heute, Kachel und eigener Abschnitt.
Beleg in `docs/beleg-redispatch.md`, Lizenzkette in `LIZENZ-DATEN.md`.

**Die Lizenzkette ist seit dem 03.09.2026 geschlossen.** netztransparenz.de
nennt keine Lizenz; getragen wird die Veroeffentlichung davon, dass dieselben
Massnahmen ueber die ENTSO-E Transparency Platform laufen, deren Terms of Use in
Klausel 2.5 eine Liste frei weiterverwendbarer Daten fuehren (CC BY 4.0 seit
02/2022). Diese Liste ist jetzt nachgesehen: Redispatch ist **Datenpunkt 19,
"Information relating to redispatching", Artikel 13.1.a** der Verordnung
543/2013, Fassung vom 18.10.2023; ausgenommen sind nur Moldau, die Tuerkei,
einzelne Datenpunkte der Ukraine sowie BritNed und Interconnexion
France-Angleterre. Beleg mit Fundstelle und Pruefsumme in
`docs/beleg-redispatch.md`. Bis dahin galt: nicht geprueft, die Seite antwortet
mit HTTP 403. Veroeffentlicht werden weiterhin Tagesaggregate; das ist jetzt
eine Wahl und kein Zwang.

**Am 31.08.2026 eingebaut: Grund, Anforderer und Dauer.** Die Aufgliederung
nach dem Grund ist die wichtigste davon, weil sie eine falsche Aussage der
Seite korrigiert: Redispatch hiess dort pauschal "Eingriff ins Netz", obwohl
rund 4 % der Arbeit angemeldeter Probebetrieb sind. Gruppiert wird IN DER
ANZEIGE (`RD_GRUNDGRUPPEN` in `assets/powerflow.js`), die Datei behaelt den
Wortlaut der Quelle unter `je_grund`; jede Gruppe nennt ihr Original auf der
Seite. Wer daran etwas aendert, laesst diese Belegkette stehen.

**Am 31.08.2026 nachgesehen, was die Quelle sonst noch liefert.** Sie hat 15
Felder; genutzt werden bisher sieben. Die Befunde ueber das Jahr 2025 (19.257
Massnahmen, 14,80 TWh):

- **GRUND_DER_MASSNAHME**, 14 Werte, bisher ungenutzt und der groesste Gewinn:
  Strombedingter Redispatch 77,6 % der Arbeit, **Countertrade an der daenischen
  Grenze 16,9 %**, Spannungsbedingter Redispatch 1,2 %, und **889 Massnahmen
  mit 4,1 % der Arbeit sind Probefahrten und Tests** -- also gerade KEIN
  Eingriff im Notfall. Die Seite nennt Redispatch bisher pauschal "Eingriff ins
  Netz"; das ist fuer diesen Teil falsch.
- **ANFORDERNDER_UENB** (wer das Problem hatte) gegen ANWEISENDER_UENB (wer
  handelte): 12.659 Massnahmen fordern alle vier gemeinsam an, TenneT allein
  3.976 TWh... und es tauchen **auslaendische Betreiber auf**: RTE, APG,
  swissgrid, EnDK Ost. Deutschland greift auf Anforderung der Nachbarn ein.
- **Dauer**: Median 4 Stunden, laengste 25 (Zeitumstellung), 18,4 % hoechstens
  eine Stunde -- aber nur 1,4 % der Arbeit.
- **BETROFFENE_ANLAGE ist fuer eine Karte NICHT brauchbar.** 404 Bezeichnungen,
  gegen 596 Kraftwerke und 5.259 Umspannwerke geprueft: 76,9 % der Arbeit ohne
  Ort, und unscharfe Treffer sind teils falsch ("Obernburg" gegen "Bernburg").
  13,3 % der Arbeit laufen ueber die "Boerse" und haben gar keinen Ort. Der
  offene Punkt auf der Seite sagt das jetzt mit Zahlen.

### ZURUECKGENOMMEN am 31.08.2026: die Redispatch-Zahlen waren zu niedrig

**Das Dezimaltrennzeichen der Quelle ist ein KOMMA.** Bis zum 31.08.2026 stand
im Abrufskript `float(s["GESAMTE_ARBEIT_MWH"])` ohne Umwandlung. Jeder Satz mit
Nachkommastellen -- "1306,25" -- warf ValueError, wurde als "unvollstaendig"
gezaehlt und mitsamt seiner Arbeit weggeworfen.

Ueber 2025 gemessen: **4.374 von 19.257 Saetzen (22,7 %) und 5,529 von 20,324
TWh (27,2 %)**. Die Seite hat monatelang zu niedrige Redispatch-Zahlen gezeigt.
Alle sechs Jahresdateien sind neu abgerufen; die Werte lauten jetzt 15,42 (2021),
22,06 (2022), 24,81 (2023), 22,28 (2024), 20,32 (2025) und 13,18 TWh (2026 bis
30.08.).

**Wie es unentdeckt bleiben konnte:** das Feld `unvollstaendige_saetze` stand
die ganze Zeit in jeder Jahresdatei. Es hat nur niemand hineingesehen. Ein
Zaehler, den keiner prueft, ist kein Zaehler. Deshalb jetzt zweifach geprueft:
`fetch-redispatch.py` bricht ab, sobald ueber 1 % der Saetze unlesbar sind, und
`validate.py` prueft, dass in keiner Jahresdatei ein verworfener Satz steht.

Seit dem 31.08.2026 steht je Tag ein **Zeitprofil** in der Datei:
`aktive_je_stunde`, 24 Zaehler in Ortszeit, dazu dieselbe Zaehlung aufgegliedert
nach Grund, anweisendem Betreiber, Erzeugungsart und Richtung sowie die Summe
der Dauern (`stunden_je_grund`, `stunden_je_uenb`, `stunden_je_energieart`,
`stunden_richtung`, `stunden_dauer_h`). Auf der Seite ist daraus EIN Block
geworden -- "Wann und warum eingegriffen wurde": die Saeule zeigt wie viele,
ihre Farbe warum, und beim Zeigen oeffnet sich eine echte Ablesung. Kein
`title`-Attribut mehr; dort steht eine Zeile ohne Umbruch, ohne Farbe und ohne
Tastaturzugang.

**Was die Quelle nicht hat und was deshalb nirgends behauptet wird:** eine
Stufe oder Prioritaet (kein solches Feld unter den 15) und einen Ort der
betroffenen Anlage (`BETROFFENE_ANLAGE` ist eine Bezeichnung ohne Koordinate,
76,9 % der Arbeit ohne Zuordnung). Das WO wird ueber den anweisenden Betreiber
beantwortet -- das ist die Regelzone. Gezaehlt wird, OB eine Massnahme in
dieser Stunde lief -- nicht, wie viel Arbeit auf sie entfiel. Eine Arbeit je
Stunde gaebe es nur unter der Annahme gleichmaessiger Leistung, und genau die
traegt nicht (siehe die Regel zu GESAMTE_ARBEIT_MWH). Gemessen ueber 2.052
Tage: Spitze um 11:00 mit im Mittel 17,9 gleichzeitigen Massnahmen, Tiefpunkt um
00:00 mit 9,5; an 65 % der Tage lief rund um die Uhr mindestens eine. Beleg:
`docs/beleg-redispatch.md`.

Fuenf Regeln aus der Belegarbeit, die nicht verloren gehen duerfen:
- **Keine Zeichenkette der Quelle wird auf Gleichheit geprueft.** Die Quelle
  schreibt "Wirkleistungseinspeisung erhöhen" an einzelnen Saetzen mit
  zerfallenem Umlaut ("erh¿hen", U+00BF). Ein `==` gegen den vollen Wortlaut
  hat 6 Saetze und 5.905 MWh aus BEIDEN Summen fallen lassen -- gezaehlt wurden
  sie trotzdem. `richtung()` sucht deshalb auf das, was den Zerfall ueberlebt,
  und was uebrig bleibt, wird gezaehlt und bricht den Abruf ab. Dieselbe Regel
  gilt fuer den anweisenden Betreiber: ein stilles `if x in liste` ist ein
  stiller Verlust.
- **Das Dezimaltrennzeichen ist ein Komma.** Siehe oben. `zahl()` in
  `fetch-redispatch.py` wandelt um; ein Tausenderpunkt waere vorher zu
  entfernen, sonst wird aus "1.306,25" die Zahl 1,30625.
- **Immer `GESAMTE_ARBEIT_MWH` summieren, nie Leistung mal Dauer.** Bei 253 von
  1.187 Saetzen des August 2026 ist die mittlere Leistung der Mittelwert ueber
  die tatsaechlich aktive Zeit, nicht ueber das genannte Fenster.
- **Die Quelle liefert UTC.** Im Sommer zwei Stunden Unterschied. Das Feld
  ZEITZONE wird gelesen, nicht angenommen.
- **Arbeit zaehlt zum Tag des Beginns, Stunden zum Tag, auf dem sie liegen.**
  Das sind zwei verschiedene Fragen; sie werden getrennt beantwortet und nicht
  vermischt.
- **Hoch ist MEIST groesser als runter** -- ueber die sechs Jahre zwischen
  -3,2 % (2026, bis 31.08.) und +18,1 % (2021). Kein Fehler: bei
  grenzueberschreitenden Massnahmen wird laut Quelle nur der deutsche Teil
  veroeffentlicht. Der Satz stand zweimal falsch auf der Seite: erst mit
  3,6 bis 25,4 % aus den lueckenhaften Zahlen, dann mit "in jedem Jahr
  groesser", was 2026 nicht mehr gilt. **Eine Zahl in Prosa veraltet still.**
  `validate.py` rechnet die Spanne jetzt aus den Jahresdateien nach und
  vergleicht sie mit dem Seitentext; ein Negativtest verstellt sie absichtlich.

## Bekannte Maengel der Daten — nicht wegglaetten

Belegt in `docs/beleg-tagesreihen.md`. Diese drei Punkte duerfen weder
stillschweigend korrigiert noch aus dem Seitentext entfernt werden:

1. **Der Bilanzrest geht nicht auf null auf.** Ueber 4.258 Tage gemessen liegt
   er zwischen -18,8 % und +12,0 %, im Median bei -2,6 %. Eine fruehere Angabe
   von 0,5 % war auf einen einzelnen Tag geeicht und ist zurueckgenommen.
2. **Vor 2019 ist die Regelzonenaufteilung unvollstaendig** - 2015 fehlen bis zu
   3,4 % der Last je Tag. Ursache nicht geklaert. Die Seite warnt sichtbar.
   Bei der **Erzeugung** ist der Riss groesser als bei der Last: die Zonensumme
   liegt 2015 um +7,5 % und 2016 um +6,6 % ueber der Deutschlandsumme, weil die
   Reihe "Sonstige Konventionelle" in der Zonenaufteilung fuenfmal so hoch
   steht. An 1.173 von 4.258 Tagen weicht die Zonensumme um mehr als 1 % ab,
   davon fuenf ab 2021 (alle Nov/Dez 2025, groesster −2,84 % am 09.12.2025).
   Die Warnung haengt deshalb **nicht an einer Jahreszahl**, sondern wird fuer
   den gewaehlten Zeitraum nachgerechnet. Diese Abweichung war von der auf 2019
   gesetzten Toleranzgrenze verdeckt -- eine Grenze, die man setzt, muss man
   auch daraufhin ansehen, was sie sonst noch zudeckt.
3. **Tages- und Stundenwerte muessen im SELBEN Lauf geholt werden.** SMARD
   meldet zurueckliegende Werte nach: am 30.08.2026 stand der 28.08. zuerst bei
   1.214.078,00 MWh und nach dem naechsten Abruf bei 1.213.793,75 MWh. Wer die
   beiden Reihen zu verschiedenen Zeiten holt, bekommt zwei Staende, und die
   Gegenprobe schlaegt zu Recht an.
4. **Der Tagesverlauf wird ueber den ZEITSTEMPEL geschluesselt, nie ueber die
   lokale Stundenmarke.** Am Tag der Rueckstellung gibt es 02:00 zweimal; eine
   Marke als Schluessel verliert dort eine Stunde. Genau das ist einmal
   passiert, an elf Oktobertagen. Siehe `docs/beleg-verlauf.md`.
5. **Ein Wert der Quelle ist falsch:** Schweiz-Import am 09.02.2015 mit
   25.009.206 MWh. Er wird als fehlend gefuehrt, nicht korrigiert; der
   Originalwert bleibt in der Liste `auffaellig` sichtbar.

## Ablauf

1. Offene Punkte oben klaeren.
2. Datenquellen belegen: Rohabruf zeigen, Felder erklaeren, Einheit aus den
   Daten selbst nachweisen, Gegenprobe rechnen. Erst danach Code.
3. Statischen Entwurf liefern und durchsprechen.
4. Abrufskript und Workflows liefern, einmal von Hand starten.
5. Interaktive Grafik liefern, mit Browsertest.
6. Methodik-PDF und Exporte liefern.
7. Live-Seite pruefen, Workflow-Laeufe pruefen, offene Punkte auflisten.

## Browsertest

Er braucht **keine** zusaetzliche Software. Chrome spricht das
DevTools-Protokoll von Haus aus, Node bringt seit v22 einen WebSocket-Client
mit. `scripts/browsertest.mjs` startet einen eigenen Chrome mit wegwerfbarem
Profil und prueft Dark, Light, 390 px, alle Info-Knoepfe, jedes Bedienelement,
den CSV-Abzug und die Konsole. Er laeuft im Workflow `pruefen.yml` mit.

**Die Bildschirmfotos ansehen, nicht nur die Haken zaehlen.** Drei echte Maengel
sind nur beim Hinsehen aufgefallen und von keiner Pruefung gemeldet worden --
siehe `docs/beleg-browsertest.md`.

## Skills in diesem Repository

- `datenquellen-strom` — Quellen auswaehlen, abrufen, belegen, gegenpruefen
- `nachweispflicht` — Info-Popover, CSV-Export, Methodik-PDF
- `pruefpflichten` — Nachrechnung, Gegenprobe, Browsertest, Negativtests
- `actions-workflows` — GitHub Actions, Deploy, Validierung
