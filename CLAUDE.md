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

## Offene Punkte — vor dem ersten Frontend-Code klaeren

- **Leitfrage (Vorschlag, von Immo noch zu bestaetigen):** Wie deckt Deutschland
  seinen Strombedarf an einem Tag, und welcher Anteil kommt von aussen?
- **Freie Variable (Vorschlag, noch zu bestaetigen):** das Referenzjahr, gegen
  das der Tageswert verglichen wird.

Solange beide Punkte offen sind: Datenquellen belegen und Abrufskripte bauen ist
erlaubt, Frontend-Code nicht.

## Umfang

Gemessen darstellbar und damit im Umfang:

- Erzeugung nach Quelle, Last, Import/Export als Tagesbilanz
- Redispatch als eigene Kachel (netztransparenz.de)
- Grenzueberschreitende Fluesse **je Kuppelstelle**

Nicht im Umfang: Fluesse auf einzelnen Hoch- und Hoechstspannungsleitungen. Nach
§ 23c Abs. 2 EnWG werden grenzueberschreitende Lastfluesse nur zusammengefasst je
Kuppelstelle veroeffentlicht; Standort- und Anlagendaten der Uebertragungsnetz-
betreiber sind vertraulich, auch in aggregierter oder ableitbarer Form.
Oeffentliche Leitungsauslastungen sind Modellrechnungen, keine Messung. Der
Wunsch gehoert in den Abschnitt "Was ich nicht belegen konnte", nicht in eine
Grafik.

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
- **Keine Zahl ohne Herkunft.** Uebernommene Zahl: Herausgeber, Dokument, Jahr.
  Selbst gerechnete Zahl: die Formel.

## Technik

- Statische Seite, kein Build-Schritt, kein Paketmanager im Frontend.
- Ein einziges Vanilla-JS-Modul als IIFE, das sein Markup selbst erzeugt und vor
  einem Anker in der `index.html` einhaengt. **Keine globalen Bindungen** —
  Top-Level-`const` kollidiert sonst mit vorhandenen Skripten derselben Seite.
- Datum immer lokal formatieren, **nie** `toISOString()`. Das rechnet nach UTC
  und verschiebt in Europa jeden Tag um eins.
- Kein `localStorage`. Aller Zustand kommt aus den Dateien im Repository.
- `data/` fuer CSV/JSON, `scripts/` fuer Python-Abrufskripte. Python-
  Standardbibliothek wo moeglich; jede zusaetzliche Abhaengigkeit begruenden.
- Cache-Buster an CSS und JS (`?v=JJJJMMTT-stichwort`), bei jeder Lieferung
  erhoeht.

## Gestaltung

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

## Ablauf

1. Offene Punkte oben klaeren.
2. Datenquellen belegen: Rohabruf zeigen, Felder erklaeren, Einheit aus den
   Daten selbst nachweisen, Gegenprobe rechnen. Erst danach Code.
3. Statischen Entwurf liefern und durchsprechen.
4. Abrufskript und Workflows liefern, einmal von Hand starten.
5. Interaktive Grafik liefern, mit Browsertest.
6. Methodik-PDF und Exporte liefern.
7. Live-Seite pruefen, Workflow-Laeufe pruefen, offene Punkte auflisten.

## Skills in diesem Repository

- `datenquellen-strom` — Quellen auswaehlen, abrufen, belegen, gegenpruefen
- `nachweispflicht` — Info-Popover, CSV-Export, Methodik-PDF
- `pruefpflichten` — Nachrechnung, Gegenprobe, Browsertest, Negativtests
- `actions-workflows` — GitHub Actions, Deploy, Validierung
