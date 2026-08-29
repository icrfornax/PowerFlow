PowerFlow

Statisches Daten-Dashboard zu Stromflüssen und -mengen im deutschen Stromnetz.

Status: Rumpf. Leitfrage und freie Variable stehen (freie Variable: der Kalendertag), siehe CLAUDE.md. GitHub Pages ist noch nicht eingerichtet; die Seite läuft lokal mit `python -m http.server`.

Leitfrage

Wo wird in Deutschland an einem Tag Strom erzeugt, wo verbraucht, und wie groß ist das Ungleichgewicht je Regelzone? Dazu, welcher Anteil von außen kommt — je Kuppelstelle. Nord-Süd erscheint als Folgerung aus gemessenen Größen, nicht als eigene Zahl: Flüsse zwischen den Regelzonen werden nicht veröffentlicht.

Idee

Eine Tagesbilanz des deutschen Stromsystems: Zufluss aus Erzeugung und Import, Verbrauch, Abfluss durch Export. Jede angezeigte Zahl bringt ihre Herkunft mit — über einen Info-Knopf auf der Seite, über einen CSV-Export mit vollständigem Kommentarkopf und über ein Methodik-PDF, das sich bei jedem Bau neu aus den Daten im Repository rechnet.

Aufbau

    index.html            Seitengerüst mit Anker
    assets/               CSS und ein Vanilla-JS-Modul als IIFE
    data/                 CSV und JSON, aus den Abrufskripten erzeugt
    scripts/smard.py      Filter-IDs als benannte Konstanten, Abrufbausteine
    scripts/fetch-*.py    Abrufskripte
    scripts/validate.py   Türsteher vor dem Deploy, mit Negativtests
    docs/beleg-*.md       Nachweise je Datenquelle

Belege

    docs/beleg-smard.md             Last, Erzeugung, Regelzonen, Einheitennachweis, Gegenprobe
    docs/beleg-aussenhandel.md      Herleitung der undokumentierten Außenhandels-Filter-IDs
    docs/beleg-kraftwerksdaten.md   Kraftwerksstandorte und Erzeugung je Block
    docs/beleg-tagesreihen.md       Tagesauflösung, Datenqualität, bekannte Mängel
    docs/beleg-grundkarte.md        Herkunft und Lizenz der Kartengeometrie
    docs/beleg-netzgeometrie.md     Leitungen und Umspannwerke aus OpenStreetMap
    LIZENZ-DATEN.md                 die drei Datenlizenzen und ihre Folgen

Prüfen

    python scripts/fetch-tagesreihen.py
    python scripts/fetch-kraftwerke.py
    python scripts/fetch-grundkarte.py
    python scripts/fetch-netz.py
    python scripts/validate.py
    python scripts/validate.py --negativtests
    python -m http.server 8765

Vorbild für Aufbau und Sorgfaltsniveau ist das „Flussbilanz-Labor" in icrfornax/de-gas-storage-tracker-bnetza.

Datenquellen

SMARD (Bundesnetzagentur) — Primärquelle für Last, Erzeugung nach Energieträger und Außenhandel. Die Daten stehen unter CC BY 4.0. Namensnennung: Bundesnetzagentur | SMARD.de. https://www.smard.de/

Energy-Charts (Fraunhofer ISE) — Zweitzugriff und Ausfallreserve, unter anderem für den grenzüberschreitenden Stromhandel. Zugriff ohne Registrierung und ohne Token, weitgehend CC BY 4.0; die Lizenz gilt je Endpunkt. https://api.energy-charts.info/

netztransparenz.de — Redispatch-Daten der vier deutschen Übertragungsnetzbetreiber. https://www.netztransparenz.de/

Zur Unabhängigkeit der Quellen

SMARD und Energy-Charts bestätigen einander nicht unabhängig: SMARD bezieht die Daten direkt von ENTSO-E, und Energy-Charts veröffentlicht die Daten mehrerer Gebotszonen unverändert von SMARD. Ein Abgleich zwischen beiden ist eine Konsistenzprüfung der Übertragungskette, keine Gegenprobe der Messung. Für eine echte Gegenprobe wird eine anders erhobene Jahressumme herangezogen.

Was dieses Projekt nicht zeigt

Flüsse auf einzelnen Hoch- und Höchstspannungsleitungen. Nach § 23c Abs. 2 EnWG werden grenzüberschreitende Lastflüsse nur zusammengefasst je Kuppelstelle veröffentlicht; Anlagen- und Standortdaten der Übertragungsnetzbetreiber sind vertraulich. Öffentlich verfügbare Darstellungen einzelner Leitungsauslastungen sind Modellrechnungen. Solche Werte werden hier nicht als Messung dargestellt.

Lizenz

Der Code steht unter der MIT-Lizenz (siehe LICENSE). Für die Daten unter data/ gilt das nicht: sie stammen aus drei Quellen mit drei verschiedenen Lizenzen — CC BY 4.0 (SMARD), gemeinfrei (Natural Earth) und ODbL 1.0 mit Share-alike (OpenStreetMap). Die Einzelheiten und ihre Folgen stehen in LIZENZ-DATEN.md.