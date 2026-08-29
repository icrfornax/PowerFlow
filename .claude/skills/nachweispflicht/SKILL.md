---
name: nachweispflicht
description: Die drei Nachweisebenen fuer jede angezeigte Zahl — Info-Popover an Karten und Kennzahlen, CSV-Export mit Kommentarkopf, sich selbst neu bauendes Methodik-PDF. Nutzen beim Bauen oder Aendern von Kacheln, Kennzahlen, Exporten oder der Methodik-Dokumentation.
---

# Nachweispflicht

Jede angezeigte Zahl bringt drei Ebenen mit. Alle drei sind Pflicht, keine ist
optional oder "spaeter".

## 1. Info-Knopf an jeder Karte und jeder Kennzahl

Ein kleines rundes "i", das beim Ueberfahren ein Popover oeffnet. Inhalt:

- **Aktueller Wert** — woher die Zahl stammt.
- **Maximum bzw. Grenzen** — was der Hoechstwert bedeutet und was ihn begrenzt.
- Darunter die verlinkten Quellen.
- Am Ende jedes Popovers ausdruecklich: **was daran Messung ist und was
  Annahme.** Dieser Satz fehlt nie.

Verhalten: schliesst beim Wegbewegen des Zeigers, aber nicht beim Scrollen,
solange der zugehoerige Knopf sichtbar bleibt. Klick heftet an, Escape
schliesst. `aria-label` am Knopf, sichtbarer Fokus.

## 2. CSV-Export mit Kommentarkopf

- Jede Zeile der Simulation als Datenzeile.
- Davor, mit `#` eingeleitet: alle Parameter, der vollstaendige Rechenweg als
  Formel, die Quellen mit Lizenz und Namensnennung, der Abrufzeitpunkt.
- Erklaerung im Kopf, dass die Anzeige auf der Seite deutsch formatiert ist
  (Tausenderpunkt, Dezimalkomma), die CSV-Datei aber maschinenlesbar mit Punkt
  als Dezimaltrennzeichen. Ohne diesen Hinweis haelt es jemand fuer einen Fehler.
- Ziel: **die Datei muss ohne die Seite pruefbar sein.**
- Zusaetzlich ein Gesamtlauf ueber alle Referenzjahre, damit sichtbar wird, wie
  stark das Ergebnis an der Jahreswahl haengt.

## 3. Methodik-PDF, das sich im Workflow selbst neu baut

Es rechnet alle Kennzahlen beim Bau frisch aus den Repository-Dateien, damit es
nie aelter ist als die Daten. Kein von Hand gepflegtes PDF.

Inhalt:

- Eingangsgroessen mit Quelle
- wie geprueft wurde
- der Rechenweg Zeile fuer Zeile
- eine Robustheitstabelle ueber alle Referenzjahre
- alle Annahmen an einer Stelle gesammelt
- das Quellenverzeichnis
- ein Abschnitt mit der Ueberschrift **"Was ich nicht belegen konnte"**

Der letzte Abschnitt wird nie leer gelassen, solange offene Punkte bestehen.
Fuer PowerFlow gehoert dort mindestens hinein, dass innerdeutsche
Leitungsfluesse nicht oeffentlich messbar sind und dass SMARD und Energy-Charts
einander nicht unabhaengig bestaetigen.
