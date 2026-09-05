"""Holt die Erzeugung je KRAFTWERKSBLOCK von SMARD, als Tageswerte.

Aufruf:  python scripts/fetch-blockerzeugung.py --pruefen 2026
         python scripts/fetch-blockerzeugung.py               (alle Jahre)
         python scripts/fetch-blockerzeugung.py 2025 2026     (nur diese)

WAS DIE QUELLE LIEFERT -- am 05.09.2026 durch Abruf belegt
----------------------------------------------------------
211 der 1.956 Bloecke in den SMARD-Stammdaten tragen eine `production_id`.
Diese ID wirkt als Filter im gewoehnlichen chart_data-Endpunkt -- aber NUR mit
der Regelzone der Anlage als Region:

    /chart_data/4046/Amprion/index_day.json   -> HTTP 200
    /chart_data/4046/DE/index_day.json        -> HTTP 404

Es gibt sie in allen Aufloesungen, auch als TAGESREIHE. Das ist der Grund, warum
dieses Skript ueberhaupt tragbar ist: ueber `index_day` sind es zehn
Jahresbloecke je Block statt 365 Viertelstundenbloecken -- 2.110 Abrufe statt
ueber hunderttausend.

GEGENPROBE, die den Zuschnitt traegt
------------------------------------
Block 4046 (Amprion), 19.08.2026:

    aus der Tagesreihe        25.086,0 MWh
    aus 96 Viertelstunden     25.086,0 MWh   (Abweichung 0,028 MWh, Rundung)

Die Tagesreihe ist also die Summe der Viertelstunden und keine eigene Groesse.
Der Wert stimmt ausserdem mit dem ueberein, der am 19.08.2026 von Hand geprueft
und in docs/beleg-kraftwerksdaten.md notiert wurde.

WAS DAS SKRIPT WISSEN MUSS
--------------------------
* **404 ist eine Antwort, kein Fehler.** Eine production_id mit der falschen
  Regelzone antwortet mit 404; dasselbe gilt fuer Bloecke, zu denen es keine
  Reihe gibt. smard.py wirft dafuer `Nichtvorhanden`. Wer 404 als Abbruch
  behandelt, bricht grundlos ab; wer daraus eine Null macht, erfindet Erzeugung.
  Hier wird gezaehlt und die Reihe weggelassen.
* **Die Reihe beginnt 2017**, nicht 2015 wie die uebrigen. Zehn Jahresbloecke.
* **`power` kann null sein.** Ein fehlender Tag bleibt null und wird NICHT zu
  einer Null gerechnet -- der Unterschied zwischen "stand still" und "nicht
  gemeldet" ist auf dieser Seite die halbe Miete.
* Ein Block, der im ganzen Jahr keinen einzigen Wert hat, kommt gar nicht erst
  in die Datei. Das spart ein Drittel und sagt dasselbe.
"""

from __future__ import annotations

import collections
import datetime as dt
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

import smard

WURZEL = pathlib.Path(__file__).resolve().parent.parent
STAMM = WURZEL / "data" / "kraftwerke.json"
ZIEL = WURZEL / "data" / "blockerzeugung"
VERZEICHNIS = WURZEL / "data" / "blockerzeugung-verzeichnis.json"

# Ueber diesem Anteil fehlender Reihen bricht der Abruf ab: dann hat sich der
# undokumentierte Endpunkt geaendert und nicht die Wirklichkeit.
GRENZE_OHNE_REIHE = 0.25


def bloecke() -> list[dict]:
    """Alle Bloecke mit production_id, mit ihrer Anlage und Regelzone."""
    d = json.loads(STAMM.read_text(encoding="utf-8"))
    raus = []
    for anlage in d["anlagen"]:
        for b in anlage.get("bloecke") or []:
            if not b.get("production_id"):
                continue
            raus.append({
                "id": int(b["production_id"]),
                "anlage": anlage["code"],
                "ort": anlage["ort"],
                "regelzone": anlage["regelzone"],
                "energietraeger": b.get("energietraeger") or anlage["energietraeger"],
                "leistung_mw": b.get("leistung_mw"),
                "status": b.get("status"),
            })
    return raus


def hole_block(auftrag: tuple) -> tuple:
    """Tageswerte eines Blocks fuer ein Jahr. Gibt (id, {tag: wert}, fehlt) zurueck."""
    block, jahr, jahresbloecke = auftrag
    werte: dict[str, float] = {}
    passend = [b for b in jahresbloecke
               if dt.datetime.fromtimestamp(b / 1000, smard.TZ).year == jahr]
    if not passend:
        return block["id"], {}, False
    try:
        for b in passend:
            for t, v in smard.reihe(block["id"], block["regelzone"], "day", b):
                if v is None:
                    continue
                tag = dt.datetime.fromtimestamp(t / 1000, smard.TZ).date()
                if tag.year == jahr:
                    werte[tag.isoformat()] = v
    except smard.Nichtvorhanden:
        # Eine Antwort, kein Fehler. Siehe Kopf.
        return block["id"], {}, True
    return block["id"], werte, False


def jahr_bauen(jahr: int, liste: list[dict]) -> dict:
    erster = dt.date(jahr, 1, 1)
    letzter = dt.date(jahr, 12, 31)
    tage = []
    t = erster
    while t <= letzter:
        tage.append(t.isoformat())
        t += dt.timedelta(days=1)
    stelle = {tag: i for i, tag in enumerate(tage)}

    # Die Blockliste je Regelzone einmal holen, nicht je Block.
    index: dict[tuple, list] = {}
    for b in liste:
        schluessel = (b["id"], b["regelzone"])
        if schluessel in index:
            continue
        try:
            index[schluessel] = smard.wochenbloecke(b["id"], b["regelzone"], "day")
        except smard.Nichtvorhanden:
            index[schluessel] = []

    auftraege = [(b, jahr, index[(b["id"], b["regelzone"])]) for b in liste]
    reihen: dict[str, list] = {}
    ohne_reihe = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for bid, werte, fehlt in pool.map(hole_block, auftraege):
            if fehlt:
                ohne_reihe.append(bid)
                continue
            if not werte:
                continue
            spalte = [None] * len(tage)
            for tag, v in werte.items():
                if tag in stelle:
                    spalte[stelle[tag]] = round(v, 1)
            reihen[str(bid)] = spalte

    anteil = len(ohne_reihe) / max(1, len(liste))
    if anteil > GRENZE_OHNE_REIHE:
        raise SystemExit(
            f"ABBRUCH: {len(ohne_reihe)} von {len(liste)} Bloecken ohne Reihe "
            f"({anteil * 100:.0f} %). Der Endpunkt ist undokumentiert -- wenn so "
            "viele fehlen, hat er sich geaendert. Erst nachsehen.")

    belegt_je_block = [sum(1 for v in r if v is not None) for r in reihen.values()]
    moeglich = len(reihen) * len(tage)
    abdeckung = (sum(belegt_je_block) / moeglich * 100) if moeglich else 0.0
    median = (sorted(belegt_je_block)[len(belegt_je_block) // 2]
              if belegt_je_block else 0)

    return {
        "_quelle": "SMARD, Bundesnetzagentur -- https://www.smard.de/",
        "_lizenz": "CC BY 4.0",
        "_namensnennung": "Bundesnetzagentur | SMARD.de",
        "_hinweis": (
            "Erzeugung je KRAFTWERKSBLOCK, Tageswerte in MWh. Der Schluessel ist "
            "die production_id aus data/kraftwerke.json. Nur 211 der 1.956 "
            "Bloecke tragen eine solche ID -- sie decken 53.443 von 100.348 MW "
            "ab, also 53 % der gefuehrten Leistung. Fuer alle uebrigen Bloecke "
            "gibt es KEINE Reihe; das ist eine Grenze der Quelle und wird auf "
            "der Seite benannt. Die Tagesreihe ist die Summe der Viertelstunden "
            "(geprueft: 25.086,0 gegen 25.086,0 MWh am 19.08.2026, Block 4046). "
            "Ein fehlender Tag steht als null und ist KEINE Null -- der "
            "Unterschied zwischen 'stand still' und 'nicht gemeldet' bleibt "
            "erhalten. Die Reihe beginnt 2017. ACHTUNG, die Abdeckung schwankt "
            "stark: 2018 sind nur 21 % der moeglichen Blocktage gemeldet, 2019 "
            "61 %, ab 2020 dann 93 bis 98 %. Das Feld abdeckung_prozent nennt "
            "sie je Jahr. Wer Jahressummen ohne diese Zahl vergleicht, haelt "
            "eine Meldeluecke fuer einen Rueckgang der Erzeugung."),
        "jahr": jahr,
        "tage": tage,
        # DIE ABDECKUNG GEHOERT IN DIE DATEI, nicht in den Kopf des Skripts.
        # Sie ist der wichtigste Vorbehalt dieser Reihe: 2018 sind nur 21 % der
        # moeglichen Blocktage gemeldet, 2019 nur 61 %, ab 2020 dann 93 bis
        # 98 %. Wer die Jahressummen ohne diese Zahl vergleicht, haelt eine
        # Meldeluecke fuer einen Rueckgang der Erzeugung.
        "abdeckung_prozent": round(abdeckung, 1),
        "median_tage": median,
        "bloecke": reihen,
        "bloecke_ohne_reihe": sorted(ohne_reihe),
        "bloecke_gesamt": len(liste),
    }


def main(argv: list[str]) -> int:
    nur_lesen = "--pruefen" in argv
    liste = bloecke()
    print(f"{len(liste)} Bloecke mit production_id aus {STAMM.name}")
    jahre = [int(a) for a in argv if a.isdigit()]
    if not jahre:
        jahre = list(range(2017, dt.date.today().year + 1))
    ZIEL.mkdir(parents=True, exist_ok=True)
    verzeichnis = []
    for jahr in jahre:
        doc = jahr_bauen(jahr, liste)
        belegt = sum(1 for r in doc["bloecke"].values()
                     if any(v is not None for v in r))
        summe = sum(v for r in doc["bloecke"].values() for v in r if v is not None)
        print(f"  {jahr}: {len(doc['bloecke'])} Bloecke mit Reihe, davon {belegt} "
              f"mit Werten, {len(doc['bloecke_ohne_reihe'])} ohne Reihe, "
              f"{summe / 1e6:,.1f} TWh, Abdeckung {doc['abdeckung_prozent']:.1f} % "
              f"(Median {doc['median_tage']} Tage)")
        if nur_lesen:
            continue
        pfad = ZIEL / f"{jahr}.json"
        pfad.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                        encoding="utf-8", newline="\n")
        verzeichnis.append({"jahr": jahr, "datei": f"data/blockerzeugung/{jahr}.json",
                            "bloecke": len(doc["bloecke"]),
                            "abdeckung_prozent": doc["abdeckung_prozent"],
                            "bytes": pfad.stat().st_size})
        print(f"      geschrieben: {pfad.name} ({pfad.stat().st_size:,} Bytes)")
    if nur_lesen:
        print("\nNur gelesen. Es wurde nichts nach data/ geschrieben.")
        return 0
    VERZEICHNIS.write_text(json.dumps({
        "_quelle": "SMARD, Bundesnetzagentur -- https://www.smard.de/",
        "_hinweis": "Welche Jahresdatei welche Bloecke enthaelt.",
        "bloecke_mit_id": len(liste),
        "jahre": verzeichnis,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"  geschrieben: {VERZEICHNIS.name} ({len(verzeichnis)} Jahre)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
