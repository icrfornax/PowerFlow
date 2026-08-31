# Beleg: Tagesverlauf und Diagrammfarben

Stand: 30.08.2026. Zuständige Skills: `datenquellen-strom`, `pruefpflichten`.

## Wann stündlich, wann tageweise

Bis **sieben Tage** einschließlich wird stündlich gezeigt, darüber tageweise.
Eine Woche sind 168 Punkte — auf 900 px noch gut zu lesen. Vorbild ist die
Darstellung von [energy-charts.info](https://www.energy-charts.info/charts/power/chart.htm?c=DE):
gestapelte Flächen für die Erzeugung, die Netzlast als Linie darüber, eine
Achse.

Damit eine Woche in Stundenwerten nicht zu einer einzigen Kurve verschwimmt:

- eine **senkrechte Trennlinie um Mitternacht**
- die Achse trägt **Wochentag und Datum** statt 168 Stundenzahlen
- die Ablesung nennt Datum **und** Uhrzeit

Die Voreinstellung der Seite ist die letzte Woche und läuft damit stündlich.

## Woher die Stundenwerte kommen

SMARD in der Auflösung `hour`, Region DE: Netzlast und zwölf Energieträger.
Die Blöcke sind wochenweise, ein voller Lauf über zwölf Jahre sind rund **8.000
Abrufe**. Abgelegt als **Monatsdateien** unter `data/verlauf/`, rund 80 kB je
Monat — wer innerhalb eines Monats blättert, lädt nichts nach.

Viertelstundenwerte wären viermal so groß (rund 40 MB). Für eine Tageskurve
reichen 24 Punkte; Morgenspitze, PV-Mittag und Abendspitze sind damit
vollständig zu sehen.

## Gegenprobe: Stunden gegen Tage

Die Tageswerte (`data/tage/`) und die Stundenwerte (`data/verlauf/`) sind
**getrennt abgerufene Reihen derselben Quelle** — `day` gegen `hour`. Dass ihre
Summen übereinstimmen müssen, ist deshalb eine echte Gegenprobe der Abrufkette,
nicht bloß eine Umformung.

`scripts/validate.py` rechnet sie für **jeden** belegten Tag nach, Toleranz
5 MWh.

### Was diese Gegenprobe gefunden hat

Beim ersten Lauf schlug sie an **elf Tagen** an, der erste war der 25.10.2015.
Alle elf sind Tage der **Zeitumstellung im Oktober** — die Tage mit 25 Stunden.

Ursache war ein Fehler von mir: ich hatte die Stundenwerte über die lokale
Marke `JJJJ-MM-TTTHH` geschlüsselt. Am Tag der Rückstellung gibt es `02` aber
**zweimal**, und der zweite Wert hat den ersten überschrieben. An elf Tagen
fehlte damit eine Stunde, in einem Fall über 40 GWh.

Behoben: geschlüsselt wird über den **Zeitstempel**, die Marke ist nur noch
Beschriftung und darf sich am Rückstellungstag wiederholen. Der Tag hat dort
25 Einträge, und genau so soll es sein — eine feste 24er-Achse wäre gelogen.

Der Fehler stand ausdrücklich in meinem eigenen Kommentar zur Zeitbehandlung
(„an den Umstellungstagen hat ein Tag 23 oder 25 Marken") und ist mir beim
Schreiben trotzdem unterlaufen. Gefunden hat ihn erst die Nachrechnung über
alle Tage.

## Diagrammfarben — gerechnet, nicht geschätzt

Zwölf Energieträger wären als Stapel nicht lesbar. Gruppiert wird auf sieben
farbige Bänder plus ein graues **Sonstige**:

| Band | enthält |
|---|---|
| Kernenergie | Kernenergie |
| Braunkohle | Braunkohle |
| Steinkohle | Steinkohle |
| Erdgas | Erdgas |
| *Sonstige* (grau) | Sonstige Konventionelle, Sonstige Erneuerbare, Pumpspeicher |
| Wasser & Biomasse | Wasserkraft, Biomasse |
| Wind | Wind Onshore, Wind Offshore |
| Photovoltaik | Photovoltaik |

Das graue *Sonstige* ist bewusst **kein achter Farbton**, sondern die
Sammelposition — und es trennt im Stapel das Orange des Erdgases vom Grün der
Biomasse, die bei Rotblindheit sonst kaum zu unterscheiden wären.

Die Farben sind mit dem Validierer der Visualisierungsregeln geprüft, für hell
und dunkel **getrennt gewählt** und nicht umgerechnet:

| Prüfung | hell | dunkel |
|---|---|---|
| Helligkeitsband | bestanden | bestanden |
| Chroma-Untergrenze | bestanden | bestanden |
| Abstand bei Farbsehschwäche | bestanden | bestanden |
| Abstand bei normalem Sehen | bestanden | bestanden |
| Kontrast gegen die Fläche | **Warnung** bei Photovoltaik (2,97 statt 3,0) | bestanden |

Die Warnung im hellen Schema verpflichtet zu sichtbarer Beschriftung oder einer
Tabellenansicht. Beides ist da: die Legende nennt jeden Träger mit seinem
Tagesanteil, und der Knopf *Als Tabelle anzeigen* gibt alle Stundenwerte als
Zahlen aus.

### Dieselben Farben auf der Karte — und was das kostet

Die Kraftwerkspunkte auf der Karte tragen **dieselben Tokens**. Braunkohle ist
dort dieselbe Farbe wie im Diagramm, egal welchem Betreiber der Block gehört.
Vorher waren die Punkte nach Regelzone gefärbt — damit hatten Boxberg und
Bergheim verschiedene Farben, obwohl beides Braunkohle ist. Das war ein Verstoß
gegen „semantische Farbe nie dekorativ".

Das hat einen Preis, den ich benenne. Im **Diagramm** stehen die Bänder in einer
festen Reihenfolge, und das graue *Sonstige* trennt das Orange des Erdgases vom
Grün der Biomasse. Auf der **Karte** liegen alle Punkte nebeneinander — dort
zählt jedes Paar. Vier gesättigte Töne in einem engen Helligkeitsband so zu
wählen, dass *jedes* Paar auch bei Farbsehschwäche sicher trennt, ist nicht
lösbar; Chroma-Untergrenze und CVD-Abstand stehen direkt gegeneinander.

Gewählt wurde deshalb:

| | hell | dunkel |
|---|---|---|
| Braunkohle | `#93412f` | `#a04038` |
| Steinkohle | `#c0508f` | `#dd5f9e` |
| Erdgas | `#e0703a` | `#d0722f` |
| Wasser & Biomasse | `#17806b` | `#46a06b` |

Der schwächste Abstand ist **Wasser & Biomasse gegen Steinkohle** bei
Deuteranopie: ΔE 6,6 (hell) und 6,1 (dunkel). Das liegt im zulässigen
Grenzband von 6 bis 8 — **zulässig aber nur mit zweiter Codierung**. Die ist
da: die Legende ist zugleich ein Filter (Überfahren hebt einen Träger hervor
und blendet den Rest zurück), und ein Klick auf einen Punkt nennt den
Energieträger im Text. Zusätzlich weicht `#17806b` mit Chroma 0,096 knapp unter
die Untergrenze von 0,100 ab; der Gegenwert ist der CVD-Abstand, und das
einzige Grau auf der Karte ist die ausdrücklich neutrale Sammelposition.

Das ist eine bewusste Abwägung, keine übersehene Warnung.

`scripts/validate.py` prüft, dass jeder der acht Farbtöne in **allen vier**
Themenblöcken der CSS-Datei definiert ist — hell und dunkel werden getrennt
gepflegt, ein vergessener Ton fällt sofort auf.

## Weitere Regeln, die eingehalten sind

- **Eine Achse.** Erzeugung und Netzlast stehen beide in GW. Zwei
  y-Achsen gibt es nicht.
- Die Netzlast ist eine 2-px-Linie in Textfarbe — sie ist kein Energieträger
  und bekommt deshalb keinen Trägerfarbton.
- 2-px-Fuge zwischen den gestapelten Bändern, in der Flächenfarbe des
  Untergrunds.
- Die Ablesung steht in einem **festen Kasten unter dem Bild**, nicht in einem
  schwebenden Tooltip: der ist auf dem Telefon nicht zu treffen und verschwindet,
  sobald man ihn lesen will.
- Das Diagramm ist mit der Tastatur bedienbar: anfahren, dann Pfeiltasten.

## Prüfbefehl

```
python scripts/fetch-verlauf.py
python scripts/validate.py
python scripts/validate.py --negativtests
```


## Nachtrag 31.08.2026 — Außenhandel je Stunde, und der Preis dazu

Anlass war eine Frage von Immo: „Für welchen Preis exportieren wir und für
welchen Preis kaufen wir Strom ein." Die erste Antwort stützte sich auf
Tageswerte — und war deshalb ungenau. Immo hat genau darauf hingewiesen.

### Warum Tageswerte dafür nicht taugen

An einem Tag führt Deutschland zu teuren Stunden ein und zu billigen aus. Wer
Tagesmittel des Preises gegen Tagessummen des Austauschs rechnet, mittelt das
weg. Gemessen über 2023 bis 2026:

| | Tagesnäherung | stündlich gewichtet |
|---|---:|---:|
| Einfuhr | 103,51 €/MWh | **102,53 €/MWh** |
| Ausfuhr | 67,53 €/MWh | **77,65 €/MWh** |
| Differenz | 35,98 | **24,88 €/MWh** |

Die Näherung übertrieb den Abstand um mehr als zehn Euro je MWh.

### Was jetzt in den Dateien steht

`data/verlauf/*.json` führt zusätzlich `import_mwh` und `export_mwh` — die
Summe über alle elf Nachbarländer, je Stunde, in MWh. Je Land und Stunde wären
es 22 Reihen und die Dateien rund zweieinhalbmal so groß; die Aufteilung je
Land steht weiterhin in den Tageswerten.

**102.255 Stunden** wurden geholt, 610 Wochenblöcke, rund drei Minuten.

### Gegenprobe: Stundensummen gegen Tageswerte

Beide Reihen wurden unabhängig abgerufen (Auflösung `hour` gegen `day`), der
Vergleich ist deshalb eine echte Gegenprobe der Abrufkette. Über **4.259 Tage**:

- Median der Abweichung: **0,01 MWh**
- über 1 MWh: **18 Tage (0,42 %)**
- über 1.000 MWh: 10 Tage

Die größte verbleibende Abweichung ist der 17.06.2023 mit 34.070 MWh beim
Import — eine echte Unstimmigkeit der Quelle zwischen ihren eigenen beiden
Auflösungen, nicht ein Fehler des Abrufs.

### Ein unplausibler Wert, gefunden und benannt

Die Gegenprobe deckte sofort den bekannten Fehlwert auf: **Schweiz-Import am
09.02.2015 um 17:00 Uhr mit 25.000.468 MWh**. In den Tageswerten war er längst
als fehlend geführt; in den Stundenwerten wäre er stehengeblieben.

Die Grenze wurde aus den Daten bestimmt, nicht geraten: der größte tatsächlich
beobachtete Stundenwert liegt bei **5.403 MWh/h** (Niederlande, Stichprobe über
30 Wochen quer durch alle Jahre). Die Schranke steht bei 15.000 MWh/h — knapp
das Dreifache, und immer noch das Sechzehnhundertstel des Fehlwerts. **Genau
ein** Wert unter 102.255 Stunden fällt darunter. Er wird als fehlend geführt,
nicht korrigiert; der Originalwert steht in der Monatsdatei unter
`aussenhandel_auffaellig`.

### Der abgeleitete Tagesbaustein

`data/aussenhandel-preis.json` führt je Tag vier Summen über die Stunden:
Preis × Einfuhr, Einfuhr, Preis × Ausfuhr, Ausfuhr. Der mengengewichtete Preis
eines beliebigen Zeitraums ist die Summe der Zähler durch die Summe der
Nenner — **exakt** dasselbe Ergebnis wie die Rechnung über alle Einzelstunden.
Das ist keine Näherung, sondern Assoziativität. Die Seite kann damit jeden
Zeitraum zeigen, ohne zwölf Monatsdateien zu laden. 2.892 Tage, 0,16 MB.

### Was die Zahl NICHT ist

Es ist der **deutsche Day-Ahead-Preis zur Stunde des Flusses**, nicht der
Preis, zu dem an der Grenze abgerechnet wurde. Den führt die Quelle nicht; er
wäre der Preis der jeweils gekoppelten Gebotszone. Die Differenz zwischen Ein-
und Ausfuhrpreis ist deshalb **keine Handelsspanne**. Sie zeigt etwas anderes,
und das ist die eigentliche Aussage: Strom fließt aus billigen in teure
Stunden. Der Satz steht so auch auf der Seite.
