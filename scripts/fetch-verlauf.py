"""Holt den Tagesverlauf (Stundenwerte) als Monatsdateien nach data/verlauf/.

Aufruf:  python scripts/fetch-verlauf.py             (alle Jahre ab 2015)
         python scripts/fetch-verlauf.py 2025 2026    (nur diese Jahre)

Das ist ein SELTEN-SKRIPT. Ein voller Lauf sind rund 8.000 Abrufe.

Warum Stunden und nicht Viertelstunden
--------------------------------------
Viertelstundenwerte waeren viermal so gross. Zwoelf Jahre in Monatsdateien
kaemen auf rund 40 MB. Fuer eine Tageskurve reichen 24 Punkte; die Form des
Tages -- Morgenspitze, PV-Mittag, Abendspitze -- ist damit vollstaendig zu
sehen. Wer die Viertelstunde braucht, holt sie ueber scripts/smard.py direkt.

Warum Monatsdateien
-------------------
Die freie Variable ist der Kalendertag. Wer im selben Monat blaettert, soll
nichts nachladen. Ein Monat ist rund 70 kB; ein ganzes Jahr waere 800 kB und
beim ersten Seitenaufruf spuerbar.

Zeit
----
Die Stundenmarken sind LOKAL (Europe/Berlin) und heissen "JJJJ-MM-TTTHH".
An den Umstellungstagen hat ein Tag deshalb 23 oder 25 Marken. Genau so soll es
sein -- eine feste 24er-Achse waere gelogen.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

import smard

WURZEL = pathlib.Path(__file__).resolve().parent.parent
ZIEL = WURZEL / "data" / "verlauf"

ERSTES_JAHR = 2015


def marke(ms: int) -> str:
    """Lokale Stundenmarke JJJJ-MM-TTTHH.

    ACHTUNG: Diese Marke ist am Tag der Rueckstellung NICHT eindeutig -- 02:00
    gibt es dort zweimal. Sie taugt deshalb als BESCHRIFTUNG, aber niemals als
    Schluessel. Genau dieser Fehler war in der ersten Fassung: die zweite
    02-Stunde hat die erste ueberschrieben, und an elf Oktobertagen fehlte eine
    Stunde. Geschluesselt wird ueber den Zeitstempel, nicht ueber die Marke.
    """
    d = dt.datetime.fromtimestamp(ms / 1000, smard.TZ)
    return f"{d:%Y-%m-%dT%H}"


def hole_jahr(filter_id: int, bloecke: list[int]) -> dict[int, float]:
    """Alle Stundenwerte einer Reihe, geschluesselt ueber den Zeitstempel."""
    werte: dict[int, float] = {}
    for block in bloecke:
        try:
            paare = smard.reihe(filter_id, smard.REGION_DE, smard.STUNDE, block)
        except smard.Nichtvorhanden:
            continue
        for t, v in paare:
            if v is not None:
                werte[t] = v
    return werte


def main(argv: list[str]) -> int:
    alle_bloecke = smard.wochenbloecke(smard.LAST_NETZLAST, smard.REGION_DE, smard.STUNDE)
    jahre = ([int(a) for a in argv] if argv
             else sorted({dt.datetime.fromtimestamp(b / 1000, smard.TZ).year
                          for b in alle_bloecke} - {y for y in range(2000, ERSTES_JAHR)}))
    ZIEL.mkdir(parents=True, exist_ok=True)
    verzeichnis: list[dict] = []
    heute = dt.datetime.now(smard.TZ).date()

    for jahr in jahre:
        if jahr < ERSTES_JAHR:
            continue
        # Fortsetzbar: ein Jahr, dessen Monatsdateien alle schon da sind, wird
        # uebersprungen. Ein Lauf ueber alle Jahre sind rund 8.000 Abrufe; wenn
        # er auf halber Strecke abbricht, soll der naechste dort weitermachen.
        vorhanden = sorted(ZIEL.glob(f"{jahr}-*.json"))
        erwartet = 12 if jahr < heute.year else heute.month
        if len(vorhanden) >= erwartet and jahr != heute.year:
            for pfad in vorhanden:
                mm = json.loads(pfad.read_text(encoding="utf-8"))
                verzeichnis.append({"monat": mm["monat"], "datei": f"data/verlauf/{mm['monat']}.json",
                                    "stunden": len(mm["stunden"])})
            print(f"  {jahr}: {len(vorhanden)} Monatsdateien schon vorhanden, uebersprungen")
            continue
        # Alle Wochenbloecke, die dieses Jahr beruehren -- der erste beginnt
        # meist noch im Vorjahr.
        von = int(dt.datetime(jahr, 1, 1, tzinfo=smard.TZ).timestamp() * 1000)
        bis = int(dt.datetime(jahr + 1, 1, 1, tzinfo=smard.TZ).timestamp() * 1000)
        bloecke = [b for b in alle_bloecke if b < bis]
        bloecke = [b for b in bloecke if b >= von - 8 * 86_400_000]
        if not bloecke:
            continue

        reihen = [("netzlast", smard.LAST_NETZLAST)]
        reihen += [(name, fid) for fid, name in smard.ERZEUGUNG.items()]

        with ThreadPoolExecutor(max_workers=8) as pool:
            ergebnisse = list(pool.map(lambda r: hole_jahr(r[1], bloecke), reihen))
        daten = dict(zip((r[0] for r in reihen), ergebnisse))

        # Alle Zeitstempel dieses Jahres, aus der Netzlast. Sortiert wird ueber
        # den Zeitstempel; die Marke ist nur die Beschriftung.
        stempel = sorted(ts for ts in daten["netzlast"]
                         if dt.datetime.fromtimestamp(ts / 1000, smard.TZ).year == jahr)
        if not stempel:
            print(f"  {jahr}: keine Stundenwerte")
            continue

        monate: dict[str, list[int]] = {}
        for ts in stempel:
            monate.setdefault(marke(ts)[:7], []).append(ts)

        for monat, mm in sorted(monate.items()):
            doc = {
                "_quelle": "SMARD, Bundesnetzagentur -- https://www.smard.de/",
                "_lizenz": "CC BY 4.0",
                "_namensnennung": "Bundesnetzagentur | SMARD.de",
                "_hinweis": (
                    "Stundenwerte in MWh je Stunde, Ortszeit Europe/Berlin. Die "
                    "Marken heissen JJJJ-MM-TTTHH. An den Umstellungstagen hat "
                    "ein Tag 23 oder 25 Marken, und am Tag der Rueckstellung kommt die "
                    "Marke 02 zweimal vor -- eine feste 24er-Achse waere "
                    "gelogen. Fehlende Werte stehen als null und werden nicht "
                    "durch Null ersetzt. Leistung in MW = Wert / 1 h."
                ),
                "monat": monat,
                "abgerufen": dt.datetime.now(smard.TZ).isoformat(timespec="seconds"),
                # Die Marken duerfen sich am Tag der Rueckstellung wiederholen.
                # Das ist richtig so: der Tag hat dort 25 Stunden.
                "stunden": [marke(ts) for ts in mm],
                "netzlast": [daten["netzlast"].get(ts) for ts in mm],
                "erzeugung": {
                    name: [daten[name].get(ts) for ts in mm]
                    for _, name in sorted(smard.ERZEUGUNG.items())
                    if any(ts in daten[name] for ts in mm)
                },
            }
            pfad = ZIEL / f"{monat}.json"
            pfad.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                            encoding="utf-8")
            verzeichnis.append({"monat": monat, "datei": f"data/verlauf/{monat}.json",
                                "stunden": len(mm)})
        groesse = sum((ZIEL / f"{m}.json").stat().st_size for m in monate)
        print(f"  {jahr}: {len(stempel):5d} Stunden in {len(monate)} Monatsdateien, "
              f"{groesse:,} Bytes, {len(doc['erzeugung'])} Energietraeger")

    if not argv:
        (WURZEL / "data" / "verlauf-verzeichnis.json").write_text(json.dumps({
            "abgerufen": dt.datetime.now(smard.TZ).isoformat(timespec="seconds"),
            "hinweis": ("Verzeichnis der Monatsdateien mit Stundenwerten. Die Seite "
                        "laedt den Monat des gewaehlten Tages."),
            "monate": sorted(verzeichnis, key=lambda x: x["monat"]),
        }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("  geschrieben: data/verlauf-verzeichnis.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
