"""Holt Redispatch-Massnahmen von netztransparenz.de und fasst sie je Tag zusammen.

Aufruf:  python scripts/fetch-redispatch.py --pruefen 2026-08-01 2026-08-31
         python scripts/fetch-redispatch.py --lizenz-geklaert 2021 2026

LIZENZ -- WORAUF WIR UNS STUETZEN
--------------------------------
Entschieden von Immo am 31.08.2026. Geprueft und festgehalten, was traegt und
was nicht:

  * Die Seite netztransparenz.de/en/Ancillary-Services/System-operations/
    Redispatch nennt WEDER eine Rechtsgrundlage NOCH eine Aussage zur freien
    Verfuegbarkeit. Wer sie als Beleg anfuehrt, irrt -- ich habe nachgesehen.
  * Sie sagt aber: "both feed-in management and redispatch measures for all
    dates are published on the ENTSO-E Transparency Platform (ETP) under
    Redispatch." Dieselben Tatsachen liegen also auch dort.
  * Die ENTSO-E Transparency Platform fuehrt nach Klausel 2.5 ihrer Terms of
    Use eine Liste von Daten, die "open for free re-use with no need to seek
    the prior agreement of the respective Primary Owner of Data" sind. Seit
    Februar 2022 gilt darauf CC BY 4.0, mit Namensnennung von ENTSO-E.
  * NICHT VERIFIZIERT: ob Redispatch auf dieser Liste steht. Die Seite mit der
    Liste beantwortet meine Abrufe mit HTTP 403. Das ist die einzige offene
    Stelle in der Kette und mit einem Klick im Portal zu pruefen.

Daraus folgt fuer dieses Projekt: veroeffentlicht werden **Tagesaggregate**,
keine Kopie der Messwertliste, mit Namensnennung beider Wege. Wer das aendern
will, liest zuerst docs/beleg-redispatch.md.

WAS AUS DEN DATEN SELBST BELEGT IST
-----------------------------------
* Einheit: MITTLERE_LEISTUNG_MW ist Leistung in MW, GESAMTE_ARBEIT_MWH ist
  Energie in MWh. Nachgewiesen ueber Arbeit = Leistung x Dauer: bei 934 von
  1.187 pruefbaren Saetzen des August 2026 stimmt das auf 5 Prozent, der
  Median der Abweichung liegt bei 0,09 Prozent.
* ABER: bei 253 Saetzen stimmt es nicht, im Median um Faktor 1,5. Die
  Abweichler sind laenger (Median 6 h statt 2,75 h) und haeufig
  boersenbezogen. MITTLERE_LEISTUNG_MW ist dort offenbar der Mittelwert ueber
  die TATSAECHLICH aktive Zeit, nicht ueber das genannte Fenster.
  Daraus folgt die Regel: **immer GESAMTE_ARBEIT_MWH summieren, niemals
  Leistung mal Dauer.**
* Zeitzone: die Datei sagt es selbst, Feld ZEITZONE_VON = "UTC". Im Sommer sind
  das zwei Stunden Unterschied zur Ortszeit. Wer das uebersieht, ordnet
  Massnahmen dem falschen Tag zu.
* Die Reihe beginnt 2021. Fuer 2020 und frueher antwortet die API mit HTTP 400.
* Eine Bereichsabfrage liefert auch Massnahmen, die VOR dem Startdatum
  beginnen, sofern sie in den Bereich hineinreichen. Es wird deshalb nach dem
  Abruf noch einmal selbst gefiltert.
"""

from __future__ import annotations

import collections
import datetime as dt
import json
import pathlib
import sys
import zoneinfo

import netztransparenz as nt

WURZEL = pathlib.Path(__file__).resolve().parent.parent
ZIEL = WURZEL / "data" / "redispatch"
TZ = zoneinfo.ZoneInfo("Europe/Berlin")

ERSTES_JAHR = 2021
PFAD = "data/Redispatch/{von}/{bis}"

# Die vier Uebertragungsnetzbetreiber, wie sie in der Datei heissen.
UENB = ("50Hertz", "Amprion", "TenneT DE", "TransnetBW")
HOCH = "Wirkleistungseinspeisung erhöhen"
RUNTER = "Wirkleistungseinspeisung reduzieren"


def stempel(datum: str, uhr: str, zone: str) -> dt.datetime:
    """Ein Zeitpunkt aus der Datei, als bewusst zonenbehaftete Zeit.

    Das Feld ZEITZONE sagt selbst, was gilt. Es wird gelesen und nicht
    angenommen -- taeuscht sich die Quelle einmal, faellt es hier auf.
    """
    d = dt.datetime.strptime(f"{datum} {uhr}", "%d.%m.%Y %H:%M")
    if zone.strip().upper() == "UTC":
        return d.replace(tzinfo=dt.timezone.utc)
    return d.replace(tzinfo=TZ)


def hole_spanne(von: str, bis: str) -> list[dict]:
    roh = nt.hole(PFAD.format(von=von, bis=bis), roh=True)
    zeilen = roh.splitlines()
    if not zeilen:
        return []
    kopf = zeilen[0].split(";")
    return [dict(zip(kopf, z.split(";"))) for z in zeilen[1:] if z.strip()]


def auswerten(saetze: list[dict], von: str, bis: str) -> dict:
    """Fasst die Massnahmen je LOKALEM Kalendertag zusammen.

    Eine Massnahme wird dem Tag ihres BEGINNS zugeordnet -- das ist eine
    Annahme und wird als solche ausgewiesen. Die Alternative waere, die Arbeit
    ueber Mitternacht zu verteilen; das setzte gleichmaessige Leistung voraus,
    und genau die ist bei einem Teil der Saetze nachweislich nicht gegeben.
    Wie gross die Annahme ist, steht im Ergebnis unter
    "arbeit_ueber_mitternacht_mwh".
    """
    tage: dict[str, dict] = {}
    ueber_mitternacht = 0.0
    unvollstaendig = 0
    for s in saetze:
        try:
            a = stempel(s["BEGINN_DATUM"], s["BEGINN_UHRZEIT"], s["ZEITZONE_VON"])
            b = stempel(s["ENDE_DATUM"], s["ENDE_UHRZEIT"], s["ZEITZONE_BIS"])
            arbeit = float(s["GESAMTE_ARBEIT_MWH"])
        except (KeyError, ValueError):
            unvollstaendig += 1
            continue
        tag = a.astimezone(TZ).date().isoformat()
        # Die Bereichsabfrage liefert auch Ueberhaenge. Selbst nachfiltern.
        if tag < von or tag > bis:
            continue
        if a.astimezone(TZ).date() != b.astimezone(TZ).date():
            ueber_mitternacht += arbeit
        e = tage.setdefault(tag, {
            "erhoehen_mwh": 0.0, "reduzieren_mwh": 0.0, "massnahmen": 0,
            "je_uenb": {u: 0.0 for u in UENB},
            "je_energieart": collections.defaultdict(float),
        })
        e["massnahmen"] += 1
        if s.get("RICHTUNG") == HOCH:
            e["erhoehen_mwh"] += arbeit
        elif s.get("RICHTUNG") == RUNTER:
            e["reduzieren_mwh"] += arbeit
        u = (s.get("ANWEISENDER_UENB") or "").strip()
        if u in e["je_uenb"]:
            e["je_uenb"][u] += arbeit
        e["je_energieart"][(s.get("PRIMAERENERGIEART") or "unbekannt").strip()] += arbeit

    for e in tage.values():
        e["je_energieart"] = dict(e["je_energieart"])
        for k in ("erhoehen_mwh", "reduzieren_mwh"):
            e[k] = round(e[k], 2)
        e["gesamt_mwh"] = round(e["erhoehen_mwh"] + e["reduzieren_mwh"], 2)
        e["je_uenb"] = {k: round(v, 2) for k, v in e["je_uenb"].items()}
        e["je_energieart"] = {k: round(v, 2) for k, v in e["je_energieart"].items()}

    return {
        "tage": tage,
        "arbeit_ueber_mitternacht_mwh": round(ueber_mitternacht, 2),
        "unvollstaendige_saetze": unvollstaendig,
    }


def kopf(jahr: int) -> dict:
    return {
        "_quelle": "netztransparenz.de -- die vier deutschen Uebertragungsnetzbetreiber",
        "_lizenz": ("Tagesaggregat. Grundlage: dieselben Massnahmen sind auf der "
                    "ENTSO-E Transparency Platform veroeffentlicht, deren Terms of "
                    "Use in Klausel 2.5 eine Liste frei weiterverwendbarer Daten "
                    "fuehren (seit 02/2022 CC BY 4.0). Siehe "
                    "docs/beleg-redispatch.md -- dort steht auch, was daran "
                    "nicht verifiziert ist."),
        "_namensnennung": ("netztransparenz.de -- 50Hertz, Amprion, TenneT, "
                           "TransnetBW; veroeffentlicht auch ueber die ENTSO-E "
                           "Transparency Platform"),
        "_hinweis": (
            "Redispatch-Massnahmen, je lokalem Kalendertag zusammengefasst. "
            "Einheit MWh. Summiert wird GESAMTE_ARBEIT_MWH; Leistung mal Dauer "
            "waere falsch, weil MITTLERE_LEISTUNG_MW bei einem Teil der Saetze "
            "der Mittelwert ueber die tatsaechlich aktive Zeit ist und nicht "
            "ueber das genannte Fenster. Die Quelle liefert UTC; hier ist auf "
            "Europe/Berlin umgerechnet. Eine Massnahme zaehlt zum Tag ihres "
            "Beginns -- eine Annahme, deren Groesse in "
            "arbeit_ueber_mitternacht_mwh steht."
        ),
        "jahr": jahr,
        "abgerufen": dt.datetime.now(TZ).isoformat(timespec="seconds"),
    }


def main(argv: list[str]) -> int:
    if "--pruefen" in argv:
        i = argv.index("--pruefen")
        von, bis = argv[i + 1], argv[i + 2]
        saetze = hole_spanne(von, bis)
        e = auswerten(saetze, von, bis)
        print(f"{von} bis {bis}: {len(saetze)} Saetze aus der API, "
              f"{sum(t['massnahmen'] for t in e['tage'].values())} nach eigenem Filter, "
              f"{len(e['tage'])} Tage")
        print(f"  Arbeit in Massnahmen ueber Mitternacht: "
              f"{e['arbeit_ueber_mitternacht_mwh']:,.0f} MWh")
        for tag in sorted(e["tage"])[:5]:
            t = e["tage"][tag]
            print(f"  {tag}  hoch {t['erhoehen_mwh']:>9,.0f}  runter "
                  f"{t['reduzieren_mwh']:>9,.0f}  gesamt {t['gesamt_mwh']:>9,.0f} MWh"
                  f"  ({t['massnahmen']} Massnahmen)")
        print()
        print("Nur gelesen. Es wurde nichts nach data/ geschrieben.")
        return 0

    if "--lizenz-geklaert" not in argv:
        print(__doc__)
        print("ABBRUCH: Ohne --lizenz-geklaert wird nichts nach data/ geschrieben.")
        print("Die Grundlage steht im Kopf dieser Datei und in")
        print("docs/beleg-redispatch.md. Wer den Riegel loest, kennt sie.")
        print("Zum Ansehen ohne Schreiben: --pruefen VON BIS")
        return 2

    jahre = [int(a) for a in argv if a.isdigit()]
    if not jahre:
        jahre = list(range(ERSTES_JAHR, dt.date.today().year + 1))
    ZIEL.mkdir(parents=True, exist_ok=True)
    for jahr in jahre:
        if jahr < ERSTES_JAHR:
            print(f"  {jahr}: vor {ERSTES_JAHR} liefert die API HTTP 400, uebersprungen")
            continue
        von, bis = f"{jahr}-01-01", f"{jahr}-12-31"
        e = auswerten(hole_spanne(von, bis), von, bis)
        doc = kopf(jahr)
        doc.update(e)
        pfad = ZIEL / f"{jahr}.json"
        pfad.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                        encoding="utf-8")
        print(f"  {jahr}: {len(e['tage'])} Tage, {pfad.stat().st_size:,} Bytes")

    # Verzeichnis immer aus den Dateien auf der Platte bauen, damit ein
    # Teillauf die uebrigen Jahre nicht verliert.
    verzeichnis = []
    for pf in sorted(ZIEL.glob("*.json")):
        doc = json.loads(pf.read_text(encoding="utf-8"))
        tage = sorted(doc["tage"])
        verzeichnis.append({"jahr": doc["jahr"], "datei": f"data/redispatch/{doc['jahr']}.json",
                            "erster_tag": tage[0] if tage else None,
                            "letzter_tag": tage[-1] if tage else None,
                            "tage_mit_massnahmen": len(tage)})
    (WURZEL / "data" / "redispatch-verzeichnis.json").write_text(json.dumps({
        "abgerufen": dt.datetime.now(TZ).isoformat(timespec="seconds"),
        "hinweis": ("Verzeichnis der Jahresdateien mit Redispatch-Tagesaggregaten. "
                    "Die Reihe beginnt 2021; davor liefert die API HTTP 400. Tage "
                    "ohne Massnahme fehlen -- das ist kein Loch, sondern eine Null."),
        "jahre": verzeichnis,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"  geschrieben: data/redispatch-verzeichnis.json ({len(verzeichnis)} Jahre)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
