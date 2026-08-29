---
name: pruefpflichten
description: Pflichtpruefungen vor jeder Lieferung — unabhaengige Nachrechnung in einer zweiten Sprache, Gegenprobe gegen eine fremde Institution, Browsertest in Dark/Light/Mobil, Negativtests, sich gegenseitig kontrollierende Anzeigewerte. Nutzen vor jedem Commit, der Zahlen oder Anzeige veraendert.
---

# Pruefpflichten vor jeder Lieferung

## Unabhaengige Nachrechnung

Die Rechenkette ein zweites Mal implementieren, in einer anderen Sprache,
direkt aus den Rohdateien, **ohne eine Zeile des Originals zu uebernehmen**.
Alle Spalten des Exports vergleichen. Abweichungen duerfen nur der
Ausgaberundung entsprechen. Groessere Abweichung heisst: nicht liefern,
sondern die Ursache finden.

## Gegenprobe gegen eine fremde Institution

Eine Jahres- oder Gesamtsumme aus der eigenen Reihe rechnen und einer
unabhaengig erhobenen Zahl gegenueberstellen. Den Abstand in Prozent nennen.

Wichtig fuer dieses Projekt: SMARD gegen Energy-Charts ist **keine** Gegenprobe,
sondern eine Konsistenzpruefung — beide gehen auf dieselbe Erhebung zurueck.
Fuer die Gegenprobe eine anders erhobene Zahl heranziehen, etwa von AGEB, BDEW
oder Destatis.

## Browsertest

Vor jeder Lieferung, vollstaendig:

- Dark, Light und Mobil bei 390 px
- alle Info-Knoepfe
- jeder Bedienknopf, einschliesslich Zuruecksetzen
- beide Exporte
- kein waagerechter Ueberlauf
- keine Konsolenfehler

## Negativtests

Fuer alles, was etwas absichern soll. **Eine Pruefung, die du nie hast
fehlschlagen sehen, ist keine Pruefung.** Also: Datei entfernen, Feld leeren,
Wert verfaelschen — und nachweisen, dass die Pruefung anschlaegt.

## Selbstkontrolle der Anzeige

Mindestens eine Zahl so bauen, dass sie eine andere gegenrechnet, etwa
"fehlende Menge in Prozentpunkten" gegen "Ziel minus Projektion". Faellt eine
auseinander, ist der Fehler sofort sichtbar.

## Groessenordnung

Vor der Anzeige mindestens eine Kennzahl auf eine Bezugsgroesse umrechnen, die
ein Mensch beurteilen kann. Ein falscher Faktor 1000 faellt so auf, in einer
Tabelle nicht.
