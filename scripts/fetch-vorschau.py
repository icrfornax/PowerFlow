"""Holt alles, was fuer MORGEN schon feststeht: Erzeugung, Last, Boersenpreis.

Aufruf:  python scripts/fetch-vorschau.py --pruefen
         python scripts/fetch-vorschau.py

WAS ES GIBT UND WAS NICHT -- am 05.09.2026 durch Abruf geklaert
---------------------------------------------------------------
Die Vorschau reicht **einen Tag**. Das ist keine Wahl, sondern die Grenze der
Quellen: der Day-ahead-Markt wird mittags fuer den Folgetag geraeumt, danach
steht er fest. Fuer uebermorgen gibt es nichts.

Geprueft und VERWORFEN:

  * netztransparenz /data/prognose/{Wind,Solar} -- liefert Zeilen, aber alle
    Wertespalten sind leer.
  * netztransparenz /data/Spotmarktpreise -- erst rund einen Monat spaeter.
  * ENTSO-E 14.1.D (Erzeugungsprognose Wind/Solar) -- steht NICHT auf der
    Freigabeliste.

Was traegt, steht bei SMARD unter CC BY 4.0 und reicht bis morgen 23:45:

  4169  Grosshandelspreis Day-Ahead
   122  Prognostizierte Erzeugung gesamt
   123  Prognostizierte Erzeugung Wind Onshore
   125  Prognostizierte Erzeugung Photovoltaik
  5097  Prognostizierte Erzeugung Wind und Photovoltaik zusammen

DIE FILTER-IDS SIND NICHT DOKUMENTIERT -- SIE SIND GEMESSEN
-----------------------------------------------------------
SMARD veroeffentlicht keine Liste der Filter-IDs, und im Frontend-Bundle stehen
sie nicht. Zugeordnet wurden sie deshalb ueber eine EIGENSCHAFT: eine
Day-ahead-Prognose muss der spaeteren Messung derselben Groesse folgen. Gemessen
am 03.09.2026, viertelstuendlich ueber den ganzen Tag:

    123 gegen gemessene Wind Onshore     r = 0,995   Verhaeltnis 0,98
    125 gegen gemessene Photovoltaik     r = 0,999   Verhaeltnis 0,91
   5097 gegen Wind on+off + PV           r = 0,998   Verhaeltnis 0,98
    122 gegen die gesamte Erzeugung      r = 0,996   Verhaeltnis 1,02

Das ist ein Beleg und keine Vermutung. Wer die IDs aendert, misst neu.

ZWEI GROESSEN WERDEN GERECHNET und sind als Rechnung benannt:

    Wind gesamt     = 5097 - 125      (an Land und auf See)
    uebrige         = 122 - 5097      (konventionell, Biomasse, Wasser)

Beide koennen durch Rundung und unterschiedliche Prognosestaende leicht negativ
werden; sie werden dann auf null geklemmt und der Rest ausgewiesen.

WIND STEHT ALS EINE GROESSE, und das ist eine Entscheidung der Darstellung:
dieses Projekt kennt genau eine Windfarbe, weil der grosse Verlauf Onshore und
Offshore zur Gruppe "Wind" zusammenfasst. Ein Bild mit zwei gleichfarbigen
Windbaendern uebereinander ist unlesbar. Die Aufteilung geht trotzdem nicht
verloren -- wind_onshore_mwh und wind_offshore_mwh stehen weiter in der Datei
und in der Ablesung der Seite.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys

import smard

WURZEL = pathlib.Path(__file__).resolve().parent.parent
ZIEL = WURZEL / "data" / "vorschau.json"

PREIS = 4169
PROGNOSE = {"gesamt": 122, "wind_onshore": 123, "photovoltaik": 125,
            "wind_und_pv": 5097}


def reihe(fid: int) -> dict:
    """Viertelstundenwerte der letzten beiden Bloecke, als {Ortszeit: Wert}."""
    bloecke = smard.wochenbloecke(fid, smard.REGION_DE, smard.VIERTELSTUNDE)
    raus = {}
    for b in bloecke[-2:]:
        for t, v in smard.reihe(fid, smard.REGION_DE, smard.VIERTELSTUNDE, b):
            if v is not None:
                raus[dt.datetime.fromtimestamp(t / 1000, smard.TZ)] = v
    return raus


def bauen() -> dict:
    heute = dt.datetime.now(smard.TZ).date()
    daten = {name: reihe(fid) for name, fid in PROGNOSE.items()}
    daten["preis"] = reihe(PREIS)

    # Die Zeitachse ist die der Erzeugungsprognose: sie reicht am weitesten und
    # ist die Groesse, um die es geht.
    marken = sorted(t for t in daten["gesamt"] if t.date() >= heute)
    if not marken:
        raise SystemExit("ABBRUCH: keine Prognose fuer heute oder morgen. "
                         "Hat SMARD die Filter geaendert? Erst nachsehen.")

    def spalte(name):
        return [daten[name].get(t) for t in marken]

    gesamt = spalte("gesamt")
    wpv = spalte("wind_und_pv")
    won = spalte("wind_onshore")
    pv = spalte("photovoltaik")

    def rest(a, b):
        """a minus b, nie unter null -- und gezaehlt, wie oft geklemmt wurde."""
        raus, geklemmt = [], 0
        for x, y in zip(a, b):
            if x is None or y is None:
                raus.append(None)
                continue
            d = x - y
            if d < 0:
                geklemmt += 1
                d = 0.0
            raus.append(round(d, 1))
        return raus, geklemmt

    woff, k1 = rest(wpv, [(a or 0) + (b or 0) if a is not None and b is not None
                          else None for a, b in zip(won, pv)])
    uebrige, k2 = rest(gesamt, wpv)
    # Wind gesamt aus ZWEI veroeffentlichten Reihen, nicht aus drei -- eine
    # Ableitung weniger als die Summe aus onshore und offshore.
    wind, k3 = rest(wpv, pv)

    return {
        "_quelle": "SMARD, Bundesnetzagentur -- https://www.smard.de/",
        "_lizenz": "CC BY 4.0",
        "_namensnennung": "Bundesnetzagentur | SMARD.de",
        "_hinweis": (
            "Was fuer heute und MORGEN angekuendigt ist: prognostizierte "
            "Erzeugung je Traeger und der Grosshandelspreis Day-Ahead, "
            "viertelstuendlich. DIE ERZEUGUNG STEHT IN MWh JE VIERTELSTUNDE, "
            "nicht in MW -- so liefert SMARD sie, und so rechnet der Rest "
            "dieses Projekts. Leistung in MW ist der Wert mal vier. Wer das "
            "verwechselt, ist um den Faktor vier daneben; genau das ist mir "
            "beim Bauen einmal passiert, und die Groessenordnungsprobe gegen "
            "den Vortag hat es gefangen. Der Preis steht in EUR/MWh. Das sind "
            "ANKUENDIGUNGEN und Marktergebnisse, keine Messungen. Weiter als "
            "bis morgen 23:45 reicht nichts -- der Day-ahead-Markt wird mittags "
            "fuer den Folgetag geraeumt. Die Filter-IDs sind bei SMARD nicht "
            "dokumentiert; sie wurden ueber die Korrelation mit der spaeteren "
            "Messung zugeordnet (r zwischen 0,995 und 0,999, siehe "
            "docs/beleg-vorschau.md). wind_offshore und uebrige sind GERECHNET: "
            "wind_mwh = wind_und_pv - photovoltaik, wind_offshore = wind_und_pv "
            "- wind_onshore - photovoltaik, uebrige = gesamt - wind_und_pv. Beide sind auf null geklemmt, wo die "
            "Prognosestaende nicht zusammenpassen; wie oft, steht in "
            "geklemmt_offshore und geklemmt_uebrige."),
        "einheit_erzeugung": "MWh je Viertelstunde",
        "einheit_preis": "EUR/MWh",
        "erzeugt_am": heute.isoformat(),
        "stunden": [t.strftime("%Y-%m-%dT%H:%M") for t in marken],
        "gesamt_mwh": [None if v is None else round(v, 1) for v in gesamt],
        "wind_onshore_mwh": [None if v is None else round(v, 1) for v in won],
        "wind_offshore_mwh": woff,
        "wind_mwh": wind,
        "photovoltaik_mwh": [None if v is None else round(v, 1) for v in pv],
        "uebrige_mwh": uebrige,
        "preis_eur_mwh": [None if daten["preis"].get(t) is None
                          else round(daten["preis"][t], 2) for t in marken],
        "geklemmt_offshore": k1,
        "geklemmt_uebrige": k2,
        "geklemmt_wind": k3,
    }


def main(argv: list[str]) -> int:
    doc = bauen()
    morgen = [i for i, m in enumerate(doc["stunden"])
              if m[:10] > doc["erzeugt_am"]]
    print(f"  {len(doc['stunden'])} Viertelstunden, {doc['stunden'][0]} bis "
          f"{doc['stunden'][-1]}")
    print(f"  davon {len(morgen)} fuer morgen")
    if morgen:
        g = [doc["gesamt_mwh"][i] for i in morgen if doc["gesamt_mwh"][i] is not None]
        p = [doc["preis_eur_mwh"][i] for i in morgen
             if doc["preis_eur_mwh"][i] is not None]
        print(f"  Erzeugung morgen: Spitze {max(g) * 4:,.0f} MW, "
              f"Summe {sum(g) / 1000:,.1f} GWh")
        if p:
            print(f"  Preis morgen:     {min(p):,.2f} bis {max(p):,.2f} EUR/MWh")
    print(f"  geklemmt: offshore {doc['geklemmt_offshore']}, "
          f"uebrige {doc['geklemmt_uebrige']}")
    if "--pruefen" in argv:
        print("\nNur gelesen. Es wurde nichts nach data/ geschrieben.")
        return 0
    ZIEL.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8", newline="\n")
    print(f"  geschrieben: data/vorschau.json ({ZIEL.stat().st_size:,} Bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
