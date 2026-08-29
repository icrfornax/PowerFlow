---
name: datenquellen-strom
description: Primaerquellen fuer deutsche Strommarkt- und Netzdaten auswaehlen, abrufen, belegen und gegenpruefen. Nutzen, wenn Datenreihen ausgewaehlt, Abrufskripte geschrieben, Einheiten geklaert, Lizenzen genannt oder Zahlen gegen eine zweite Quelle geprueft werden.
---

# Datenquellen fuer PowerFlow

## Grundregel

Vor jeder Nutzung eines Endpunkts die aktuelle Dokumentation der Quelle
aufrufen. Die unten notierten Pfade und Felder sind Ausgangspunkte, kein
Ersatz fuer die Pruefung. Kein Abruf auf gut Glueck.

## SMARD (Bundesnetzagentur) — Primaerquelle

- Zeitreihen ueber einfache GET-Abrufe ohne Query-String; gefiltert wird ueber
  Pfad-Parameter. Zeitstempel-Liste und Zeitreihe sind getrennte Aufrufe.
- Basis: `https://www.smard.de/app/chart_data/{filter}/{region}/...`
- Jede Datenreihe hat eine numerische Filter-ID. Die IDs vor Gebrauch gegen die
  Dokumentation pruefen und im Skript als benannte Konstanten mit Kommentar
  hinterlegen, nie als nackte Zahl im Code.
- Lizenz: CC BY 4.0. Namensnennung woertlich: `Bundesnetzagentur | SMARD.de`.
- Herkunft: SMARD bezieht die Daten direkt von ENTSO-E; veroeffentlicht wird,
  was die Bundesnetzagentur geprueft hat.

## Energy-Charts (Fraunhofer ISE) — Zweitzugriff und Ausfallreserve

- `https://api.energy-charts.info/` — keine Registrierung, kein Token noetig.
- Grenzueberschreitender Stromhandel ueber den `cbet`-Endpunkt, Werte in GW.
  **Positive Werte sind Import, negative Werte Export.** Vorzeichen bei jeder
  Verwendung im Code kommentieren.
- Zeitstempel in ISO 8601, Tagesform oder UNIX-Sekunden, je nach Endpunkt.
- Weitgehend CC BY 4.0; die Lizenz je Endpunkt pruefen, sie ist nicht einheitlich.

## Unabhaengigkeit — wichtig fuer die Methodik

SMARD und Energy-Charts sind **keine unabhaengigen Quellen**. SMARD bekommt die
Daten von ENTSO-E, und Energy-Charts veroeffentlicht die Daten mehrerer
Gebotszonen unveraendert von SMARD unter CC BY 4.0.

Daraus folgt fuer die Beschriftung auf der Seite und im PDF:

- Abgleich SMARD gegen Energy-Charts heisst **Konsistenzpruefung**. Er belegt,
  dass Abruf, Einheit und Zeitzone stimmen — nicht, dass die Messung stimmt.
- Eine echte **Gegenprobe** braucht eine anders erhobene Zahl, etwa eine
  Jahressumme von AGEB, BDEW oder Destatis. Abstand in Prozent nennen.
- Diese Einschraenkung wird nie stillschweigend uebergangen. Sie steht im
  Methodik-PDF und in den Popovers der betroffenen Kennzahlen.

## Redispatch

netztransparenz.de, die gemeinsame Informationsplattform der vier deutschen
Uebertragungsnetzbetreiber. Zugangsweg, Aktualisierungsrhythmus und Lizenz vor
der ersten Nutzung pruefen und im Quellenverzeichnis festhalten.

## Was nicht verfuegbar ist

Fluesse auf einzelnen Hoch- und Hoechstspannungsleitungen. § 23c Abs. 2 EnWG
verlangt die Veroeffentlichung grenzueberschreitender Lastfluesse nur
zusammengefasst je Kuppelstelle. Anlagen- und Standortdaten der Netzbetreiber
sind vertraulich, auch in aggregierter oder ableitbarer Form. Oeffentlich
sichtbare Leitungsauslastungen sind Modellrechnungen. Sie werden in diesem
Projekt nicht als Messung dargestellt.

## Pflichten bei jeder neuen Reihe

1. Rohabruf zeigen, bevor Code entsteht — die tatsaechliche Antwort, nicht eine
   Beschreibung davon.
2. Felder einzeln erklaeren.
3. **Einheit aus den Daten selbst nachweisen**, nicht aus der Doku uebernehmen.
   Eine Groessenordnungsprobe gegen einen bekannten Wert rechnen.
4. Zeitzone pruefen. Tageswerte in lokaler Zeit bilden, nicht in UTC.
5. Aktualisierungsrhythmus und Nachmeldeverhalten notieren: werden zurueck-
   liegende Werte spaeter korrigiert? Wenn ja, wie das Skript damit umgeht.
6. Quelle, Abrufzeitpunkt, Lizenz und Namensnennung in den CSV-Kopf und ins
   Quellenverzeichnis.
