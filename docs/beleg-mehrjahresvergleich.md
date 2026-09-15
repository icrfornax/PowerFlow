# Mehrjahresvergleich als Block auf der Seite — ZURÜCKGENOMMEN

Gebaut am 15.09.2026, angesehen und noch am selben Tag verworfen. **Der Block
steht nicht mehr auf der Seite.** Dieses Dokument bleibt, damit ihn niemand ein
zweites Mal baut.

## Was gebaut war

Ein eigener Abschnitt unter dem Verlauf: derselbe Kalenderausschnitt in jedem
verfügbaren Jahr, vier Größen untereinander (Netzlast, Erzeugung,
Residuallast, Außensaldo), je ein Balken pro Jahr, Median gestrichelt, Achse
ab null, unvollständige Jahre schraffiert und aus der Streuung genommen, eine
Ablesung unter dem Block.

Technisch war daran nichts falsch. Alle 284 Browserprüfungen liefen durch, die
Zahlen stimmten mit dem CSV-Abzug überein, die Regeln des Projekts waren
eingehalten.

## Warum er nicht getragen hat

Das Urteil ist Immos, nach dem Blick auf die Live-Seite: **„sieht extrem
hässlich aus", „gibt keinerlei Mehrwert".**

Was sich daran nachvollziehen lässt:

- **48 Säulen sind viel Fläche für zwei Zahlen.** Die ganze Aussage des Blocks
  war: die Netzlast schwankt über zwölf Jahre um 11,7 %, die Residuallast um
  52,0 %. Das sind zwei Sätze. Vier Reihen aus je zwölf Balken machen daraus
  einen halben Bildschirm, ohne mehr zu sagen.
- **Balken ab null, die sich kaum unterscheiden, sind korrekt und trotzdem
  langweilig.** Dass die zwölf Netzlastbalken fast gleich hoch sind, war
  ausdrücklich die Aussage — aber eine Aussage, die man nicht *sehen* muss.
  Ein Bild, dessen Inhalt „hier passiert nichts" ist, verdient kein Bild.
- **Die einzige Reihe mit sichtbarer Bewegung, der Außensaldo, war die
  unleserlichste.** Vorzeichenwechsel, Nulllinie, Medianlinie, ein Balken nahe
  null beim gewählten Jahr — viel Erklärung für eine Zeile Text.
- **Es gab schon eine Antwort auf dieselbe Frage.** Der CSV-Abzug „Derselbe
  Zeitraum in allen Jahren" liefert seit dem 14.09.2026 dieselben Zahlen,
  vollständiger (Träger, Regelzonen, Länder) und ohne Bildschirmfläche zu
  verbrauchen. Der Block war eine zweite Darstellung derselben Sache — genau
  das, was am 03.09.2026 schon einmal zum Entfernen der Jahressummen-Grafik im
  Kostenblock geführt hat: *„Sie zeigte dasselbe noch einmal, nur gröber."*

## Was geblieben ist

- **`mehrjahresreihen()` und `mehrjahresstreuung()` in `assets/powerflow.js`.**
  Sie sind beim Bau des Blocks aus `gesamtlaufCsv()` herausgelöst worden und
  bedienen jetzt den CSV-Abzug. Das ist unabhängig vom Block ein Gewinn: die
  Rechnung steht an einer Stelle statt an zweien.
- **Die Wirkungsprobe der Negativtests** in `scripts/validate.py`. Beim
  Herauslösen ist aufgefallen, dass ein Negativtest still wirkungslos geworden
  war, weil er eine Zeichenkette ersetzte, die es nicht mehr gab. Seitdem
  bricht `negativtests()` ab, wenn eine Verfälschung nichts verändert.
- **Diese Notiz.** Ein verworfener Entwurf, den niemand festhält, wird ein
  zweites Mal gebaut.

`scripts/validate.py` prüft, dass der Block wirklich weg ist — kein
`mehrjahresBlock` im Modul, keine `pf-mj-`-Klasse in JS oder CSS — und dass
diese Begründung nachlesbar bleibt.

## Wenn es doch noch einmal aufkommt

Dann nicht als vier Balkenreihen. Was an der Frage wirklich interessiert, ist
eine einzelne Zahl im Fließtext oder in einer Kachel: *„Diese Woche liegt 6,3 %
unter dem Median der letzten zwölf Jahre."* Das ist eine Zeile, kein Abschnitt —
und es steht dort, wo die Kennzahl ohnehin steht.
