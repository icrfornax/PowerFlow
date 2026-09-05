# Beleg: Vorschau auf morgen

Erstellt am 05.09.2026. Abrufskript: `scripts/fetch-vorschau.py`.
Datei: `data/vorschau.json`.

Diese Seite handelt sonst von der Vergangenheit. Der Abschnitt "Vorschau" ist
die einzige Stelle, an der etwas steht, das noch nicht gemessen wurde. Er muss
deshalb besonders deutlich sagen, was er ist -- eine **Ankuendigung**, kein
Messwert.

## Wie weit die Vorschau reicht -- und warum nicht weiter

**Bis morgen 23:45 Uhr, keine Minute laenger.** Das ist keine Bequemlichkeit,
sondern die Grenze der Sache: der Day-ahead-Markt wird mittags fuer den
Folgetag geraeumt. Danach steht der Preis fest, und die Uebertragungsnetz-
betreiber veroeffentlichen ihre Prognose fuer denselben Tag. Fuer uebermorgen
gibt es weder das eine noch das andere.

Die erste Fassung dieses Abschnitts hat das nicht gesagt und stattdessen
geschrieben, fuer morgen seien "96 von 96 Viertelstunden angekuendigt". Das ist
keine Aussage -- 96 von 96 ist immer die ganze Menge. Der Satz ist ersetzt.

## Geprueft und verworfen

| Quelle | Befund am 05.09.2026 |
|---|---|
| netztransparenz `/data/prognose/Wind`, `/Solar` | liefert Zeilen, aber **alle Wertespalten leer** |
| netztransparenz `/data/Spotmarktpreise` | erst rund **einen Monat spaeter** -- keine Vorschau |
| ENTSO-E 14.1.D (Erzeugungsprognose Wind/Solar) | steht **NICHT** auf der Freigabeliste (siehe `docs/beleg-redispatch.md`) |
| ENTSO-E 12.1.D (Day-ahead-Preise) | steht nicht auf der Freigabeliste; SMARD liefert dasselbe unter CC BY 4.0 |

Was traegt, kommt von SMARD unter CC BY 4.0.

## Die Filter-IDs sind NICHT dokumentiert -- sie sind gemessen

SMARD veroeffentlicht keine Liste seiner Filter-IDs, und im Frontend-Bundle
stehen sie nicht. Zugeordnet wurden sie deshalb ueber eine **Eigenschaft**: eine
Day-ahead-Prognose muss der spaeteren Messung derselben Groesse folgen. Gemessen
am 03.09.2026, viertelstuendlich ueber den ganzen Tag, Region DE:

| Filter | verglichen mit der Messung von | r | Verhaeltnis |
|---|---|---|---|
| 123 | Wind Onshore | 0,995 | 0,98 |
| 125 | Photovoltaik | 0,999 | 0,91 |
| 5097 | Wind Onshore + Offshore + PV | 0,998 | 0,98 |
| 122 | gesamte Erzeugung | 0,996 | 1,02 |
| 4169 | Grosshandelspreis Day-Ahead | -- reicht bis morgen 23:45 |

Zwei weitere IDs (715, 3791) antworten ebenfalls, liessen sich aber keiner
Groesse eindeutig zuordnen. Sie werden deshalb **nicht** verwendet. Wer eine ID
aendert, misst neu -- eine Vermutung reicht hier nicht.

## Die Einheit -- und der Fehler, den sie gekostet hat

**Die Werte sind MWh je Viertelstunde, nicht MW.** Beim Bauen habe ich sie als
Leistung gelesen. Das Ergebnis stand als "272 GWh Erzeugung, Spitze 16 GW" auf
der Seite und war um den **Faktor vier** daneben.

Gefangen hat es die Groessenordnungsprobe gegen den Vortag: am 03.09.2026 hat
SMARD 346,6 GWh Erzeugung gemessen und eine Lastspitze von 60,5 GW. Eine
Vorschau, die ein Drittel davon behauptet, kann nicht stimmen.

Nach der Korrektur, fuer den 06.09.2026:

    Erzeugung  1.088,1 GWh
    Spitze        64.920 MW  =  64,9 GW
    Preis         -1,81 bis 240,47 EUR/MWh

Leistung ist der Wert **mal vier**. Der Hinweis steht im Kopf der Datei und im
Kopf des Skripts.

## Zwei gerechnete Groessen, beide als Rechnung benannt

    wind_mwh       = 5097 - 125        (Wind an Land und auf See)
    wind_offshore  = 5097 - 123 - 125
    uebrige        = 122 - 5097        (konventionell, Biomasse, Wasser)

Sie koennen durch Rundung und unterschiedliche Prognosestaende leicht negativ
werden. Dann werden sie auf null geklemmt, und **wie oft** steht in den Feldern
`geklemmt_wind`, `geklemmt_offshore` und `geklemmt_uebrige`. Am 05.09.2026: alle
drei null.

## Warum Wind EIN Band ist

Die erste Fassung zeigte Wind Onshore und Wind Offshore als zwei Baender --
beide mit `--tr-wind`, weil dieses Projekt genau eine Windfarbe kennt. Der
grosse Verlauf fasst die beiden Reihen in `ELEMENTE` zur Gruppe "Wind"
zusammen, und "Braunkohle ist ueberall dieselbe Farbe" gilt auch fuer Wind.

Im Bild standen dadurch zwei gleichfarbige Flaechen uebereinander und in der
Legende zwei gleiche Punkte: die Aufteilung war unsichtbar, die Legende
irrefuehrend. Eine **zweite** Windfarbe waere die schlechtere Antwort gewesen --
dann haette Wind Offshore auf derselben Seite zwei Farben.

Die Aufteilung geht nicht verloren: `wind_onshore_mwh` und `wind_offshore_mwh`
stehen weiter in der Datei, und die Ablesung nennt sie je Viertelstunde unter
"Davon Wind".

Gefunden wurde das **nur im Bildschirmfoto**. Keine der 213 Browserpruefungen
hat es gemeldet -- sie zaehlten Baender, keine Farben. Jetzt prueft
`browsertest.mjs` die Zahl der Baender (drei) mit.

## Drei weitere Maengel, die erst das Hinsehen gezeigt hat

1. **Die Achse stand auf 0 / 17,5 / 35 / 52,5 / 70 GW.** `ceil(max/10)*10`
   geteilt durch vier ergibt beliebige Marken. Runde Marken sind kein
   Geschmack -- sie sind der Unterschied zwischen Ablesen und Schaetzen.
   `netteAchse()` sucht jetzt den kleinsten Schritt aus einer festen Leiter
   (1, 2, 2,5, 5, 10, 20, 25, 50 ...), mit dem hoechstens sechs Marken
   herauskommen. Geprueft wird, dass jede Marke durch 5 teilbar ist.
2. **Die Einheiten kollidierten.** "GW" stand als eigener Titel ueber der
   obersten Marke und ragte aus dem Bild; "EUR/MWh" lag auf der
   Datumsbeschriftung. Die Einheit haengt jetzt an der obersten Marke selbst
   ("80 GW", "250 EUR/MWh").
3. **Die Unterlegung fuer "morgen" toente die Traegerfarben.** Die Baender sind
   halbdurchsichtig; ein getoentes Rechteck ueber der rechten Haelfte liess
   dieselbe Traegerfarbe links und rechts verschieden aussehen. Die Markierung
   sitzt jetzt im Rand ueber dem Bild und beruehrt keine Flaeche. Geprueft wird
   ihre Hoehe.

## Was der Abschnitt sonst noch zeigt

Darunter steht die **Prognosegueten** der Vergangenheit -- ein Balken je Tag des
gewaehlten Zeitraums, aus `scripts/fetch-lastprognose.py`. Das ist eine andere
Frage und eine andere Quelle (ENTSO-E 6.1.B gegen 6.1.A) und deshalb ein
eigener Block. Beleg: `docs/beleg-lastprognose.md`.

**`fetch-lastprognose.py` schreibt seit dem 05.09.2026 keine `vorschau.json`
mehr.** Bis dahin taten es beide Skripte -- zwei Schreiber auf einer Datei sind
ein stiller Ueberschreiber: wer zuletzt lief, gewann, und das war die
Reihenfolge der Schritte im Workflow.

## Aktualisierung

Der taegliche Workflow ruft `fetch-vorschau.py` ab. Die Datei ist klein
(14 KB) und wird vollstaendig neu geschrieben; ein Nachtrag ist nicht noetig,
weil nichts davon Vergangenheit ist.
