"""Baut data/vergleichsreihe.json -- die schlanke Netzlastreihe fuer den
Median-Vergleich in der Kennzahlen-Kachel.

Aufruf:  python scripts/vergleichsreihe.py

REINE RECHNUNG, KEIN NETZZUGRIFF. Gelesen werden die vorhandenen Jahresdateien
unter data/tage/; geschrieben wird eine einzige flache Reihe.

Warum eine eigene Datei
-----------------------
Die Kachel "Netzlast" soll sagen, wie der gewaehlte Zeitraum zum MEDIAN
derselben Kalendertage in allen Jahren steht. Dafuer braucht sie Tageswerte
aus ALLEN Jahren -- die Seite laedt sonst nur zwei (laufendes Jahr und
Vorjahr).

Alle zwoelf Jahresdateien waeren 2,99 MB bei jedem Seitenaufruf. Diese Datei
ist rund 40 kB, weil sie genau eine Groesse fuehrt: die taegliche Netzlast in
MWh, auf ganze MWh gerundet, als flaches Feld ab dem ersten Tag.

Der Rundungsfehler ist ausgerechnet und nicht geschaetzt: hoechstens 0,5 MWh je
Tag, bei rund 1.200.000 MWh am Tag also 4 Hundertmillionstel. Die Kachel zeigt
eine Nachkommastelle in GWh -- der Fehler liegt fuenf Groessenordnungen
darunter.

WARUM NUR NETZLAST UND ERNEUERBARE
----------------------------------
Das sind die beiden Kennzahlen der Seite, die ueber zwoelf Jahre etwas
Vergleichbares hergeben.

Die ERZEUGUNG ist es nicht: die Erdgasreihe hat 2018 einen Erfassungsbruch
(+68 % bei SMARD, -4,9 % bei Eurostat, siehe docs/beleg-bilanzrest.md), und
56 % des Anstiegs der Gesamterzeugung von 2017 auf 2018 entfallen auf diese
eine Reihe. Ein Median ueber den Bruch hinweg waere eine Zahl, die nichts
misst. Ein- und Ausfuhr schwanken so stark, dass eine Prozentangabe zum Median
mehr verspricht, als sie haelt (ueber dieselbe Kalenderwoche 220 % Streuung,
mit Vorzeichenwechsel beim Saldo).

Die ERNEUERBAREN sind vom Erdgasbruch nicht betroffen -- der Nenner ist die
NETZLAST, nicht die Erzeugung. Sie tragen aber einen starken TREND: im Fenster
08.-14.09. steigt der Anteil von 30,7 % (2015) auf 53,4 % (2026). Ein Median
ueber zwoelf Jahre misst dort ueberwiegend den Zubau und nicht das Wetter --
2017 liegt mit 55,9 % ueber 2026. Die Kachel zeigt dort deshalb einen RANG und
die SPANNE; ein Rang kommt ohne jede Annahme ueber den Trend aus. Beleg:
docs/beleg-medianzeile.md.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib

WURZEL = pathlib.Path(__file__).resolve().parent.parent
QUELLE = WURZEL / "data" / "tage"
ZIEL = WURZEL / "data" / "vergleichsreihe.json"


def main() -> None:
    dateien = sorted(QUELLE.glob("*.json"))
    if not dateien:
        raise SystemExit("ABBRUCH: keine Jahresdateien unter data/tage/.")

    # Dieselben sechs Reihen wie EE_REIHEN in assets/powerflow.js. Laufen die
    # Listen auseinander, zeigt die Kachel einen anderen Anteil als die
    # Kennzahl darueber -- validate.py vergleicht sie deshalb Reihe fuer Reihe.
    EE = ["Wind Onshore", "Wind Offshore", "Photovoltaik",
          "Wasserkraft", "Biomasse", "Sonstige Erneuerbare"]

    werte: dict[str, float | None] = {}
    ee_werte: dict[str, float | None] = {}
    for pfad in dateien:
        d = json.loads(pfad.read_text(encoding="utf-8"))
        for tag, w in zip(d["tage"], d["netzlast"]):
            werte[tag] = w
        for i, tag in enumerate(d["tage"]):
            summe, gefunden = 0.0, False
            for name in EE:
                reihe_ee = d["erzeugung"].get(name)
                if reihe_ee and reihe_ee[i] is not None:
                    summe += reihe_ee[i]
                    gefunden = True
            # Kein Wert ist eine LUECKE, keine Null -- sonst saehe ein
            # fehlender Tag aus wie eine Woche ohne Wind.
            ee_werte[tag] = summe if gefunden else None

    erster = min(werte)
    letzter = max(werte)
    a = dt.date.fromisoformat(erster)
    b = dt.date.fromisoformat(letzter)

    # UEBER DEN KALENDER, nicht ueber die vorhandenen Schluessel. Ein fehlender
    # Tag muss als null in der Reihe stehen und darf sie nicht verkuerzen --
    # sonst verschiebt sich alles dahinter um einen Tag, und der Vergleich
    # traefe stillschweigend den falschen Kalendertag.
    reihe: list[int | None] = []
    ee_reihe: list[int | None] = []
    fehlend = 0
    tag = a
    while tag <= b:
        w = werte.get(tag.isoformat())
        e = ee_werte.get(tag.isoformat())
        if w is None:
            reihe.append(None)
            fehlend += 1
        else:
            reihe.append(round(w))
        ee_reihe.append(None if e is None else round(e))
        tag += dt.timedelta(days=1)

    if len(reihe) != (b - a).days + 1:
        raise SystemExit("ABBRUCH: die Reihe passt nicht zum Kalender.")

    doc = {
        "_quelle": "Bundesnetzagentur | SMARD.de -- gerechnet aus data/tage/",
        "_lizenz": "CC BY 4.0",
        "_namensnennung": "Bundesnetzagentur | SMARD.de",
        "_hinweis": (
            "Taegliche Netzlast in MWh, auf ganze MWh gerundet, als flaches "
            "Feld ab 'von'; ein Eintrag je KALENDERTAG, null wo die Quelle "
            "nichts gemeldet hat. Dazu ee_mwh: die Summe der sechs "
            "erneuerbaren Reihen je Tag, gleiche Form. NUR diese zwei "
            "Groessen -- die Erzeugung hat 2018 einen Erfassungsbruch "
            "(docs/beleg-bilanzrest.md), Ein- und Ausfuhr schwanken zu stark. "
            "Gebraucht fuer die Einordnungszeile der Kacheln 'Netzlast' "
            "(Median) und 'Erneuerbare' (Rang und Spanne -- ein Median waere "
            "dort ueberwiegend Zubau und nicht Wetter, siehe "
            "docs/beleg-medianzeile.md); die Alternative waere, alle zwoelf "
            "Jahresdateien (2,99 MB) bei jedem Seitenaufruf zu laden."),
        "von": erster,
        "bis": letzter,
        "tage": len(reihe),
        "ohne_meldung": fehlend,
        "netzlast_mwh": reihe,
        "ee_mwh": ee_reihe,
        "ee_reihen": EE,
    }
    ZIEL.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8", newline="\n")
    print(f"geschrieben: {ZIEL.relative_to(WURZEL)} "
          f"({ZIEL.stat().st_size:,} Bytes, {len(reihe)} Tage, "
          f"{fehlend} ohne Meldung, {erster} bis {letzter})")


if __name__ == "__main__":
    main()
