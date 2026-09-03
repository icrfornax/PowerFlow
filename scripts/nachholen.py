"""Findet Luecken in den Reihen, holt sie nach und fuehrt Buch darueber.

Aufruf:  python scripts/nachholen.py --pruefen     (nur lesen, nichts holen)
         python scripts/nachholen.py               (holen und Bericht schreiben)

WOZU ES DAS GIBT
----------------
SMARD meldet nach. Am 30.08.2026 lagen fuer den Vortag 16 von 24 Stunden vor,
am 03.09. waren es 22 -- der Tag war immer noch unvollstaendig, und der
Tageswert entsteht erst, wenn alle 24 Stunden da sind. Bis dahin klaffte in
der Reihe ein Loch, das NIEMAND gezaehlt hat.

Der taegliche Abruf holt das laufende und das vorige Jahr neu; Luecken darin
schliessen sich also von selbst, sobald die Quelle liefert. Zwei Faelle deckt
er aber nicht ab:

  * Eine Luecke, die aelter ist als das vorige Jahr. Sie wird nie wieder
    angefasst.
  * Stundenwerte ausserhalb der letzten vier Wochen. Dasselbe.

Und in beiden Faellen faellt es nicht auf, weil nichts danach sieht.

Dieses Skript sieht danach. Es scannt ALLE Tages- und Stundendateien, holt
gezielt die betroffenen Jahre und Wochenbloecke neu, scannt noch einmal und
schreibt das Ergebnis nach data/luecken.json. Was dort steht, prueft
scripts/validate.py gegen die Dateien nach -- ein Bericht, den niemand prueft,
ist kein Bericht.

WAS IN DER DATEI STEHT UND WAS NICHT
------------------------------------
Es steht KEIN Zeitstempel darin. Ein "zuletzt geprueft: heute" wuerde die
Datei jeden Tag aendern und jeden Tag einen Commit erzeugen, auch wenn sich
nichts getan hat. Stattdessen steht je offener Luecke, WANN sie zuerst
aufgefallen ist -- das aendert sich nur, wenn sich wirklich etwas aendert. Ob
der Nachtrag laeuft, sagt der Workflow-Lauf, nicht die Datei.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys

import smard

WURZEL = pathlib.Path(__file__).resolve().parent.parent
TAGE = WURZEL / "data" / "tage"
VERLAUF = WURZEL / "data" / "verlauf"
BERICHT = WURZEL / "data" / "luecken.json"

# Der laufende und der Vortag bleiben aussen vor: dass sie noch nicht
# vollstaendig sind, ist kein Mangel, sondern der normale Meldeverzug. Gemessen
# ueber die Reihe liegt der Tageswert an Tag+1 vor; erst was an Tag+2 fehlt, ist
# eine Luecke.
KARENZ_TAGE = 2


def heute() -> dt.date:
    return dt.datetime.now(smard.TZ).date()


def stichtag() -> str:
    return (heute() - dt.timedelta(days=KARENZ_TAGE)).isoformat()


def tagesluecken() -> list[str]:
    """Kalendertage bis zum Stichtag ohne Netzlast."""
    grenze = stichtag()
    raus = []
    for pfad in sorted(TAGE.glob("*.json")):
        d = json.loads(pfad.read_text(encoding="utf-8"))
        for tag, wert in zip(d["tage"], d["netzlast"]):
            if tag <= grenze and wert is None:
                raus.append(tag)
    return sorted(raus)


def stundenluecken() -> list[str]:
    """Stundenmarken bis zum Stichtag, die in der Monatsdatei FEHLEN.

    Achtung, zwei verschiedene Arten von Loch: ein None in der Reihe, und eine
    Marke, die gar nicht erst in "stunden" steht. Der August 2026 hatte 734
    statt 744 Eintraege -- die letzten zehn Stunden fehlten schlicht. Wer nur
    auf None prueft, sieht das nicht.
    """
    grenze = stichtag()
    raus = []
    # ÜBER DEN KALENDER laufen, nicht ueber die vorhandenen Dateien. Fehlte eine
    # Monatsdatei ganz, waere sie sonst unsichtbar -- eine Luecke, die niemand
    # findet, weil niemand nach ihr sucht. Der erste Monat kommt aus dem
    # aeltesten Dateinamen, das Ende aus dem Stichtag.
    vorhandene = sorted(VERLAUF.glob("*.json"))
    if not vorhandene:
        return raus
    ersterMonat = vorhandene[0].stem
    monate = []
    j, m = int(ersterMonat[:4]), int(ersterMonat[5:7])
    while f"{j:04d}-{m:02d}" <= grenze[:7]:
        monate.append(f"{j:04d}-{m:02d}")
        j, m = (j + 1, 1) if m == 12 else (j, m + 1)
    for monat in monate:
        pfad = VERLAUF / f"{monat}.json"
        d = (json.loads(pfad.read_text(encoding="utf-8")) if pfad.is_file()
             else {"monat": monat, "stunden": [], "netzlast": []})
        jahr, mon = int(monat[:4]), int(monat[5:7])
        erster = dt.date(jahr, mon, 1)
        letzter = (dt.date(jahr + (mon == 12), mon % 12 + 1, 1) - dt.timedelta(days=1))
        vorhanden = {}
        for i, marke in enumerate(d["stunden"]):
            vorhanden.setdefault(marke, []).append(i)
        tag = erster
        while tag <= letzter:
            if tag.isoformat() > grenze:
                break
            for stunde in range(24):
                marke = f"{tag.isoformat()}T{stunde:02d}"
                stellen = vorhanden.get(marke)
                if not stellen:
                    # An den Umstellungstagen gibt es 02:00 zweimal oder gar
                    # nicht. Eine fehlende Marke am Umstellungstag ist deshalb
                    # kein Loch -- sie ist die Wahrheit.
                    if stunde == 2 and tag.month in (3, 10):
                        continue
                    raus.append(marke)
                elif all(d["netzlast"][i] is None for i in stellen):
                    raus.append(marke)
            tag += dt.timedelta(days=1)
    return sorted(raus)


def wochenbloecke_fuer(marken: list[str]) -> list[int]:
    """Die SMARD-Wochenbloecke, die diese Stunden enthalten.

    Die Blockliste kommt von der Quelle, nicht aus einer eigenen Rechnung: ein
    Block beginnt Montag 00:00 Ortszeit, und den Umgang mit der Zeitumstellung
    ueberlaesst man besser der Quelle als sich selbst.
    """
    if not marken:
        return []
    alle = smard.wochenbloecke(smard.LAST_NETZLAST, smard.REGION_DE, smard.STUNDE)
    gebraucht = set()
    for marke in marken:
        ziel = dt.datetime.fromisoformat(marke + ":00").replace(
            tzinfo=smard.TZ).timestamp() * 1000
        passend = [b for b in alle if b <= ziel]
        if passend:
            gebraucht.add(max(passend))
    return sorted(gebraucht)


def bericht_schreiben(tage: list[str], stunden: list[str], geschlossen: dict) -> None:
    alt = {}
    if BERICHT.is_file():
        vorher = json.loads(BERICHT.read_text(encoding="utf-8"))
        alt = {e["tag"]: e for e in vorher.get("offene_tage", [])}
        for e in vorher.get("offene_stunden", []):
            alt[e["stunde"]] = e
    heute_s = heute().isoformat()

    def seit(schluessel: str) -> str:
        e = alt.get(schluessel)
        return e["seit"] if e else heute_s

    doc = {
        "_quelle": "SMARD, Bundesnetzagentur -- https://www.smard.de/",
        "_lizenz": "CC BY 4.0",
        "_namensnennung": "Bundesnetzagentur | SMARD.de",
        "_hinweis": (
            "SELBST ERHOBEN aus den eigenen Dateien unter data/tage/ und "
            "data/verlauf/: welche Kalendertage und Stunden die Quelle bis "
            f"heute nicht geliefert hat. Der laufende Tag und der Vortag "
            f"bleiben aussen vor ({KARENZ_TAGE} Tage Karenz) -- dass sie noch "
            "nicht vollstaendig sind, ist der normale Meldeverzug und kein "
            "Mangel. 'seit' ist der Tag, an dem die Luecke zuerst aufgefallen "
            "ist, nicht der Tag der Luecke selbst. 'zuletzt_geschlossen' zaehlt "
            "NUR, was dieser Lauf selbst geschlossen hat -- der taegliche Abruf "
            "laeuft vorher und fuellt das laufende Jahr ohnehin neu; was er "
            "schon gefuellt hat, sieht dieses Skript gar nicht mehr als Luecke. "
            "Eine leere Liste heisst also nicht, dass nichts nachkommt. Ein "
            "Zeitstempel des letzten "
            "Laufs steht bewusst NICHT hier: er wuerde die Datei jeden Tag "
            "aendern, auch wenn sich nichts getan hat. scripts/validate.py "
            "prueft diese Liste bei jedem Lauf gegen die Dateien nach."
        ),
        "erzeugt_von": "scripts/nachholen.py",
        "karenz_tage": KARENZ_TAGE,
        "offene_tage": [{"tag": t, "seit": seit(t)} for t in tage],
        "offene_stunden": [{"stunde": s, "seit": seit(s)} for s in stunden],
        "zuletzt_geschlossen": geschlossen,
    }
    BERICHT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n",
                       encoding="utf-8", newline="\n")


def zeigen(tage: list[str], stunden: list[str]) -> None:
    print(f"  Stichtag (mit {KARENZ_TAGE} Tagen Karenz): {stichtag()}")
    print(f"  offene Kalendertage: {len(tage)}"
          + (f" -- {', '.join(tage[:8])}" + (" ..." if len(tage) > 8 else "")
             if tage else ""))
    print(f"  offene Stunden:      {len(stunden)}"
          + (f" -- {', '.join(stunden[:6])}" + (" ..." if len(stunden) > 6 else "")
             if stunden else ""))


def main(argv: list[str]) -> int:
    nur_lesen = "--pruefen" in argv
    print("Luecken suchen ...")
    tage_vorher, stunden_vorher = tagesluecken(), stundenluecken()
    zeigen(tage_vorher, stunden_vorher)

    if nur_lesen:
        print("\nNur gelesen. Es wurde nichts geholt und nichts geschrieben.")
        return 0

    geschlossen = {"tage": [], "stunden": []}
    if tage_vorher or stunden_vorher:
        import subprocess

        jahre = sorted({t[:4] for t in tage_vorher})
        if jahre:
            print(f"\nTagesreihen neu holen: {', '.join(jahre)}")
            r = subprocess.run([sys.executable, str(WURZEL / "scripts" / "fetch-tagesreihen.py")]
                               + jahre, cwd=WURZEL)
            if r.returncode:
                raise SystemExit(f"ABBRUCH: fetch-tagesreihen.py endete mit {r.returncode}")

        bloecke = wochenbloecke_fuer(stunden_vorher)
        if bloecke:
            print(f"\nStundenreihen neu holen: {len(bloecke)} Wochenbloecke")
            # Der Nachtrag arbeitet ueber eine ausdrueckliche Blockliste. Die
            # Alternative waere "die letzten N Wochen" -- bei einer Luecke von
            # 2019 waeren das ueber dreihundert Bloecke fuer eine Stunde.
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                "fv", WURZEL / "scripts" / "fetch-verlauf.py")
            fv = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(fv)
            fv.nachtragen(bloecke=bloecke)

    tage_nachher, stunden_nachher = tagesluecken(), stundenluecken()
    geschlossen["tage"] = [t for t in tage_vorher if t not in set(tage_nachher)]
    geschlossen["stunden"] = [s for s in stunden_vorher if s not in set(stunden_nachher)]

    print("\nNach dem Nachtrag:")
    zeigen(tage_nachher, stunden_nachher)
    print(f"  geschlossen in diesem Lauf: {len(geschlossen['tage'])} Tage, "
          f"{len(geschlossen['stunden'])} Stunden")

    bericht_schreiben(tage_nachher, stunden_nachher, geschlossen)
    print(f"  geschrieben: data/luecken.json ({BERICHT.stat().st_size:,} Bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
