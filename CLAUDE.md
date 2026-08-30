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
- Beschriftungen nennen Einheit und Bezug.
- Zugaenglichkeit: sichtbarer Fokus, aria-Beschriftungen an Knoepfen ohne Text,
  `prefers-reduced-motion` beachten, Tabellen und Grafiken mit eigenem
  Scrollcontainer.

## Umgang mit Fehlern

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

Noch offen: Methodik-PDF; Regelzonen als Flaeche auf
der Karte; Import und Export im Verlauf; Anlagen aus dem
Marktstammdatenregister.

## Redispatch

Eingebunden: Tagesaggregate 2021 bis heute, Kachel und eigener Abschnitt.
Beleg in `docs/beleg-redispatch.md`, Lizenzkette in `LIZENZ-DATEN.md`.

**Die Lizenzkette hat eine offene Stelle.** netztransparenz.de nennt keine
Lizenz; getragen wird die Veroeffentlichung davon, dass dieselben Massnahmen
ueber die ENTSO-E Transparency Platform laufen, deren Terms of Use in Klausel
2.5 eine Liste frei weiterverwendbarer Daten fuehren (CC BY 4.0 seit 02/2022).
Ob Redispatch auf dieser Liste steht, ist NICHT geprueft -- die Seite antwortet
mit HTTP 403. Veroeffentlicht werden deshalb nur Tagesaggregate, keine Kopie
der Messwertliste. Wer daran etwas aendert, liest zuerst den Beleg.

Drei Regeln aus der Belegarbeit, die nicht verloren gehen duerfen:
- **Immer `GESAMTE_ARBEIT_MWH` summieren, nie Leistung mal Dauer.** Bei 253 von
  1.187 Saetzen des August 2026 ist die mittlere Leistung der Mittelwert ueber
  die tatsaechlich aktive Zeit, nicht ueber das genannte Fenster.
- **Die Quelle liefert UTC.** Im Sommer zwei Stunden Unterschied. Das Feld
  ZEITZONE wird gelesen, nicht angenommen.
- **Hoch ist stets groesser als runter**, 3,6 bis 25,4 Prozent ueber die Jahre.
  Kein Fehler: bei grenzueberschreitenden Massnahmen wird laut Quelle nur der
  deutsche Teil veroeffentlicht.

## Bekannte Maengel der Daten — nicht wegglaetten

Belegt in `docs/beleg-tagesreihen.md`. Diese drei Punkte duerfen weder
stillschweigend korrigiert noch aus dem Seitentext entfernt werden:

1. **Der Bilanzrest geht nicht auf null auf.** Ueber 4.258 Tage gemessen liegt
   er zwischen -18,8 % und +12,0 %, im Median bei -2,6 %. Eine fruehere Angabe
   von 0,5 % war auf einen einzelnen Tag geeicht und ist zurueckgenommen.
2. **Vor 2019 ist die Regelzonenaufteilung unvollstaendig** - 2015 fehlen bis zu
   3,4 % der Last je Tag. Ursache nicht geklaert. Die Seite warnt sichtbar.
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
