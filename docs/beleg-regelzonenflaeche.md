# Regelzonen als Fläche — die einzige Ableitung im Projekt

Stand 31.08.2026. Erzeugt von `scripts/zonenflaeche.py`, Ergebnis in
`data/regelzonen-flaeche.json`.

**Diese Fläche ist keine Messung.** Sie ist die einzige Stelle im Projekt, an
der eine Geometrie abgeleitet statt belegt wird. Dieses Dokument sagt, warum
das nötig war, wie es gemacht wird und wie gut es trifft.

## 1. Warum es keine belegte Grenze gibt

Vor dem Bauen wurde gesucht, nicht vermutet.

**OpenStreetMap: null Treffer.** Abfrage an Overpass am 31.08.2026:

```
[out:json][timeout:120];
area["ISO3166-1"="DE"][admin_level=2]->.de;
(
  relation(area.de)["type"="boundary"]["operator"~"50Hertz|Amprion|TenneT|TransnetBW",i];
  relation(area.de)["boundary"~"power|control_zone|electricity",i];
);
out tags 40;
```

Antwort: `{"elements": []}` — kein einziges Objekt. Das OSM-Wiki
`Power_networks/Germany` verweist für eine Regelzonenkarte auf Wikipedia und
kennt kein Tagging für Regelzonengrenzen.

**Bundesnetzagentur:** veröffentlicht eine Netzkarte als PDF, keine Geodaten.

**Open Energy Platform, Open Power System Data:** keine Polygone der
Regelzonen gefunden.

**Bundeslandgrenzen sind kein Ersatz.** Die Zonen folgen ihnen nicht: Amprion
reicht in Niedersachsen, Hessen, Baden-Württemberg und Bayern hinein, TenneT
läuft von der dänischen Grenze bis in die Alpen. Eine Karte nach Bundesländern
wäre nicht ungenau, sondern falsch.

## 2. Was stattdessen belegt vorliegt

| Stützpunkt | Anzahl | Herkunft der Zonenangabe |
|---|---:|---|
| Kraftwerke | 596 | Feld `regelzone` in den SMARD-Stammdaten (Bundesnetzagentur) |
| Leitungsknoten 220/380 kV | 51.422 | Feld `operator` in OpenStreetMap |

Die Leitungsknoten werden auf ein 0,05-Grad-Raster ausgedünnt — je Zelle die
dort häufigste Zone, ein Punkt. Ohne das gewinnt die Zone mit den meisten
Knoten in einem Leitungszug statt der nächstgelegenen. Übrig bleiben **3.200
Leitungspunkte**, zusammen mit den Kraftwerken **3.796 Stützpunkte**.

**Bewusst nicht verwendet:** Leitungen mit dem Betreiber `RWE` (1.147
Abschnitte). RWE Transportnetz Strom ist der Vorgänger von Amprion; die
Gleichsetzung wäre eine Annahme, und Annahmen gehören nicht unbemerkt in die
Stützpunkte. Ebenso ausgelassen: alles mit Semikolon (`Amprion;Westnetz`, 91
Abschnitte) — mehrere Betreiber, nicht eindeutig.

## 3. Das Verfahren

Raster 0,02 Grad (rund 1,5 × 2,2 km, bei der Zoomstufe der Deutschlandkarte
etwa ein Bildpunkt). Jede Zelle, deren Mittelpunkt in einem Bundesland liegt,
bekommt die Zone ihres **nächstgelegenen Stützpunktes**. Weiter als 60 km wird
nichts zugeordnet — 79 Zellen bleiben deshalb leer statt geraten.

Ergebnis: 114.687 zugeordnete Zellen, zu 1.871 Rechtecken zusammengefasst
(50Hertz 435, Amprion 505, TenneT 670, TransnetBW 261), 40 kB.

## 4. Wie gut es trifft — die Kreuzprobe

Eine Interpolation ohne Fehlermaß ist eine Behauptung. Deshalb wird für **jedes
der 596 Kraftwerke** die Zone aus den *übrigen* Stützpunkten vorhergesagt und
mit der amtlichen Angabe verglichen.

**556 von 596 richtig — 93,3 %. 40 daneben.**

| Verwechslung | Anzahl |
|---|---:|
| Amprion als TenneT | 10 |
| TransnetBW als Amprion | 9 |
| Amprion als TransnetBW | 8 |
| TenneT als Amprion | 3 |
| 50Hertz als TenneT | 3 |
| TenneT als 50Hertz | 3 |
| übrige Paarungen | je 1 |

Die Fehler liegen dort, wo die echte Grenze verzahnt ist: am Oberrhein
(Amprion/TransnetBW), an der Grenze Bayern/Hessen (Amprion/TenneT) und im
Raum Rhein-Neckar. Das ist keine Schwäche der Methode, sondern die Wirklichkeit
— dort verlaufen die Netze tatsächlich ineinander.

Die 40 Fehltreffer stehen mit Koordinate in `data/regelzonen-flaeche.json`
unter `daneben`. Sie werden nicht entfernt und nicht geglättet.

`scripts/zonenflaeche.py` **bricht ab**, wenn die Quote unter 85 % fällt. Sinkt
sie durch neue Daten, verschwindet die Fläche, statt schlechter zu werden.

## 5. Auflagen für die Darstellung

1. Die Ebene ist auf der Karte **voreingestellt ausgeschaltet**.
2. Sie heißt in der Ebenenliste „Regelzonen als Fläche (**abgeleitet**)".
3. Die Trefferquote steht im Abschnitt „Grenzen", nicht im Kleingedruckten.
4. Im Quellenverzeichnis steht sie unter der eigenen Quelle
   „PowerFlow, abgeleitet — **KEINE Messung**", nicht neben den Messungen.
5. Sie wird blass gezeichnet (`fill-opacity` 0,20) und liegt **unter**
   Leitungen, Umspannwerken und Kraftwerken. Das Gemessene bleibt oben.

Wer eine dieser Auflagen aufweicht, macht aus einer benannten Näherung eine
behauptete Grenze. Dann ist die Ebene besser zu löschen.

## 6. Lizenz

Die Fläche ist aus OpenStreetMap-Daten abgeleitet. Nach ODbL 1.0 ist sie damit
eine abgeleitete Datenbank: **Namensnennung und Share-alike gelten weiter.**
Die Kraftwerksangaben stammen von SMARD (CC BY 4.0). Beide Nennungen stehen im
Kopf der Datei und in `LIZENZ-DATEN.md`.
