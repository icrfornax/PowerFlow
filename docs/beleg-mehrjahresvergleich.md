# Mehrjahresvergleich — Beleg

Gebaut am 15.09.2026. Erzeugt von `mehrjahresBlock()` in `assets/powerflow.js`,
gerechnet von `mehrjahresreihen()` und `mehrjahresstreuung()`.

Der Block beantwortet die Frage, die unmittelbar an der einen freien Variable
hängt: **wie stark hängt das Ergebnis am gewählten Zeitraum?** Gezeigt wird
derselbe Kalenderausschnitt in jedem verfügbaren Jahr — aus realen Messwerten,
kein Mittel, keine geglättete Kurve.

Gerechnet wurde das seit dem 14.09.2026 bereits, aber nur im CSV-Abzug
(`docs/beleg-gesamtlauf.md`). Wer wissen wollte, wie ungewöhnlich die gewählte
Woche war, musste die Datei herunterladen und selbst hineinsehen.

## Eine Rechnung, zwei Ausgaben

`mehrjahresreihen(von, bis)` und `mehrjahresstreuung(zeilen, hol)` sind die
einzige Stelle, an der gerechnet wird. Der CSV-Abzug **und** der Block auf der
Seite lesen von dort.

Das ist kein Schönheitsargument. Zwei Rechnungen für dieselbe Zahl laufen
auseinander, und gemerkt hätte es niemand — in diesem Projekt ist genau das
schon zweimal passiert (Verzeichnis der Blockerzeugung am 06.09.2026,
Redispatch-Schieflage am selben Tag). `validate.py` prüft, dass es beide
Funktionen genau einmal gibt.

Dabei ist eine alte Prüfung aufgefallen, die beim Auslagern still wirkungslos
geworden wäre: sie suchte wörtlich nach `belegt === z.k.tage`. Nach dem
Umbau heißt dieselbe Bedingung `k.belegt === k.tage` und steht in einer anderen
Funktion. Die Prüfung läuft jetzt über einen regulären Ausdruck und über die
Bedingung, nicht über die Schreibweise.

## Vier Größen nebeneinander, nicht eine zum Umschalten

Zwei Gründe:

1. **Ein Umschalter wäre ein zweites Bedienelement.** Die Seite hat genau
   eines, den Zeitraum. `scripts/validate.py` prüft, dass kein Schieberegler
   und kein drittes Datumsfeld dazukommt.
2. **Die Aussage steckt im Nebeneinander.** Gemessen für den 7.–13. September
   über zwölf Jahre:

| Größe | Spanne in % des Medians |
|---|---|
| Netzlast | **11,7 %** |
| Erzeugung | 27,1 % |
| Residuallast | **52,0 %** |
| Außensaldo | 764,7 % — und das Vorzeichen wechselt |

Die Netzlast ist die stabilste Größe; die Residuallast schwankt viermal so
stark, weil Wind und Photovoltaik den steuerbaren Rest zusammendrücken. Wer
umschalten müsste, sähe das nie.

## Jede Achse beginnt bei null

Ein abgeschnittener Balken macht aus 11,7 % Unterschied optisch das Doppelte
oder Dreifache. **Dass die Netzlastbalken fast gleich hoch sind, IST die
Aussage** — sie darf nicht weggezoomt werden.

Beim Außensaldo, der einzigen Größe hier mit Vorzeichenwechsel, reicht die
Achse vom kleinsten negativen bis zum größten positiven Wert; die Nulllinie ist
durchgezogen, die Medianlinie gestrichelt. **Beides steht im Maßstab über den
Balken** — zwei graue Striche in einem 110 px hohen Feld hält sonst niemand
auseinander, und genau daran hängt hier ein Vorzeichen.

Der Maßstab steht **über** den Balken, nicht darunter: wer die Balken schon
gelesen hat, liest ihn zu spät. Das ist dieselbe Regel wie beim Flussbild.

## Unvollständige Jahre

Ein Jahr gilt als vollständig, wenn **jeder Kalendertag** des Zeitraums Daten
hat. Nur diese Jahre gehen in Median und Spanne ein — ein halb belegtes Jahr
hat eine kleinere Summe, und das ist keine Aussage über den Verbrauch.

Unvollständige Jahre verschwinden aber nicht: sie stehen schraffiert im Bild,
ihre Jahreszahl ist kursiv, und die Ablesung nennt Kalendertage und belegte
Tage einzeln. Die Einleitung sagt, wie viele es sind.

Das tritt auf, sobald der gewählte Kalenderausschnitt im laufenden Jahr über
den letzten gemeldeten Tag hinausreicht.

## Der 29. Februar

`tagImJahr()` weicht in Nicht-Schaltjahren auf den 28. aus — dieselbe Regel wie
beim Vorjahresvergleich. Ein Zeitraum über den 29.02. ist in Schaltjahren einen
Tag länger; die Ablesung nennt deshalb bei **jedem** Jahr die Zahl der Tage.

## Der Erdgas-Bruch von 2018 steht dabei

Dieser Block lädt zu genau dem Vergleich ein, den der Bruch verdirbt. Die
SMARD-Erdgasreihe springt zwischen 2017 und 2018 um 68 %, während Eurostat für
dieselbe Größe ein MINUS von 4,9 % ausweist; 56 % des Anstiegs der
Gesamterzeugung entfallen auf diese eine Reihe. Beleg:
`docs/beleg-bilanzrest.md`.

Der Vorbehalt steht als gefalteter Satz über den Balken und nennt ausdrücklich,
was **nicht** betroffen ist: Netzlast und Residuallast laufen glatt durch.

Er erscheint nur, wenn der Zeitraum tatsächlich über 2018 hinweggeht
(`ueberGasbruch()`) — dieselbe Bedingung wie im Kopf des CSV-Abzugs. Da die
Jahresreihen 2015 beginnen und bis heute reichen, ist das derzeit immer der
Fall; die Bedingung bleibt trotzdem stehen, weil sie die richtige ist.

## Er lädt erst beim Hinsehen

Der Block braucht **alle** Jahresdateien — gemessen 2,99 MB in zwölf Dateien.
Die Seite selbst kommt mit zweien aus (laufendes Jahr und Vorjahr).

Sie beim Seitenaufruf mitzuladen wäre genau der Fehler, den der alte offene
Punkt fälschlich den Viertelstundenwerten unterstellt hat: eine Last, die jeder
trägt, auch wer sie nie braucht. Stattdessen steht ein Platzhalter da, der
**sagt**, was er nachlädt, und ein `IntersectionObserver` holt die Dateien,
sobald der Abschnitt ins Bild kommt. Ohne `IntersectionObserver` wird sofort
geladen — lieber einmal zu viel als ein leerer Kasten.

`browsertest.mjs` prüft beides, und die Platzhalter-Prüfung steht **ganz vorn**
im Testlauf: sobald eine spätere Prüfung durch die Seite scrollt, ist der Block
geladen und der Platzhalter für immer weg.

## Farben

Keine Trägerfarben. Das sind weder Energieträger noch Regelzonen, sondern
Kennzahlen — sie tragen den Bestandston Violett; das gewählte Jahr ist Teal und
seine Spalte zusätzlich schwach getönt, damit man es auch dann findet, wenn
sein Balken ein Strich ist (der Außensaldo kann nahe null liegen). Die zwei
Farbfamilien der Seite bleiben unberührt.

## Was geprüft wird

`scripts/browsertest.mjs`:

- der Platzhalter steht da und nennt die Nachladelast
- nach dem Hinscrollen: vier Reihen, benannt und in fester Reihenfolge
- jede Reihe nennt Achse, Median und Spanne
- die Netzlastachse beginnt bei 0,0
- so viele Spalten je Reihe wie Jahre auf der Achse
- vier Medianlinien
- genau ein Jahr ist als das gewählte markiert
- der Erdgas-Vorbehalt steht dabei
- die Ablesung öffnet **unter** dem Block (Lage gemessen), nennt alle vier
  Größen samt Abstand zum Median und markiert dasselbe Jahr in allen vier
  Reihen zugleich

`scripts/validate.py`: die Rechnung steht genau einmal da, „vollständig" heißt
belegt gleich Kalendertage, und die Streuung filtert darauf.
