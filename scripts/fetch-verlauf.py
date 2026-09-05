"""Holt den Tagesverlauf (Stundenwerte) als Monatsdateien nach data/verlauf/.

Aufruf:  python scripts/fetch-verlauf.py             (alle Jahre ab 2015)
         python scripts/fetch-verlauf.py 2025 2026    (nur diese Jahre)
         python scripts/fetch-verlauf.py --wochen 4   (nur die letzten 4 Wochen)
         python scripts/fetch-verlauf.py --preise     (nur die Grosshandelspreise
                                                       nachtragen, rund 400 Abrufe)
         python scripts/fetch-verlauf.py --aussenhandel  (Ein- und Ausfuhr je
                                                       Stunde, rund 3 Minuten)

Ein voller Lauf sind rund 8.000 Abrufe -- das ist ein Selten-Skript. Fuer den
taeglichen Job gibt es --wochen N: dann werden nur die letzten N Wochenbloecke
geholt und in die vorhandenen Monatsdateien eingearbeitet. Bei N=4 sind das
rund 50 Abrufe statt 8.000.

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

# Grosshandelspreis Deutschland/Luxemburg, Day-Ahead, in Euro je MWh.
# Die Reihe beginnt am 01.10.2018 -- dem Tag, an dem die gemeinsame Gebotszone
# Deutschland-Oesterreich-Luxemburg geteilt wurde. Fuer frueher gibt es diesen
# Preis nicht, und ein aelterer Preis waere ein anderer Markt.
PREIS_FILTER = 4169
PREIS_AB = "2018-10-01"

# Plausibilitaetsgrenze fuer einen einzelnen Stundenwert des Aussenhandels,
# je Land und Richtung, in MWh. Der groesste tatsaechlich beobachtete Wert
# liegt bei 5.403 MWh/h (Niederlande, Stichprobe ueber 30 Wochen quer durch
# alle Jahre). 15.000 ist knapp das Dreifache -- weit genug fuer echte Spitzen
# und eng genug fuer den bekannten Fehlwert der Quelle: Schweiz-Import am
# 09.02.2015 mit 25.009.206 MWh, also dem Sechzehnhundertfachen. Derselbe Wert
# ist in den Tageswerten laengst als fehlend gefuehrt; in den Stundenwerten
# waere er sonst stehengeblieben.
GRENZE_STUNDE_MWH = 15_000.0


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


def aussenhandel(bloecke: list[int]) -> tuple[dict, dict, dict]:
    """Ein- und Ausfuhr je Stunde, ueber alle Nachbarlaender summiert.

    Warum summiert und nicht je Land: je Land waeren es 22 Reihen statt zwei
    und die Monatsdateien rund zweieinhalbmal so gross. Fuer die Frage, zu
    welchem Preis Deutschland ein- und ausfuehrt, reicht die Summe -- die
    Aufteilung je Land steht weiterhin in den Tageswerten.

    Eine Stunde bekommt nur dann einen Wert, wenn mindestens ein Land einen
    liefert. Dass frueher weniger Laender angeschlossen waren, ist kein Loch:
    NordLink und ALEGrO gingen erst 2020 und 2021 ans Netz.
    """
    auftraege = [(land, richtung, ids[richtung])
                 for land, ids in smard.AUSSENHANDEL.items()
                 for richtung in ("import", "export")]
    with ThreadPoolExecutor(max_workers=8) as pool:
        ergebnisse = list(pool.map(lambda a: hole_jahr(a[2], bloecke), auftraege))

    summe: dict[str, dict[int, float]] = {"import_mwh": {}, "export_mwh": {}}
    auffaellig: list[dict] = []
    for (land, richtung, _), werte in zip(auftraege, ergebnisse):
        ziel = summe["import_mwh" if richtung == "import" else "export_mwh"]
        for ts, v in werte.items():
            # Unplausible Werte werden als FEHLEND gefuehrt, nicht korrigiert
            # und nicht geschaetzt. Der Originalwert bleibt in der Liste.
            if not (0 <= v <= GRENZE_STUNDE_MWH):
                auffaellig.append({"stunde": marke(ts), "land": land,
                                   "richtung": richtung, "originalwert": v,
                                   "grenze": [0, GRENZE_STUNDE_MWH]})
                continue
            ziel[ts] = ziel.get(ts, 0.0) + v
    return summe["import_mwh"], summe["export_mwh"], auffaellig


def pruefe_laengen(monat: str, doc: dict) -> None:
    """Jede Reihe je Stunde so lang wie die Stundenachse -- oder Abbruch.

    Anlass: der taegliche Nachtrag verlaengerte "stunden", liess aber
    "preis_eur_mwh" stehen. Die Datei war danach in sich widerspruechlich, und
    gemerkt hat es erst der Tuersteher auf dem Runner. Eine Datei, die das
    Skript selbst nicht prueft, muss jemand anders pruefen -- und der merkt es
    zu spaet.
    """
    n = len(doc["stunden"])
    schief = []
    for name in ("netzlast", "preis_eur_mwh", "import_mwh", "export_mwh"):
        if name in doc and len(doc[name]) != n:
            schief.append(f"{name}: {len(doc[name])}")
    for name, reihe in (doc.get("erzeugung") or {}).items():
        if len(reihe) != n:
            schief.append(f"erzeugung/{name}: {len(reihe)}")
    if schief:
        raise SystemExit(
            f"ABBRUCH: In {monat} passen Reihen nicht zur Stundenachse ({n} "
            f"Stunden): {', '.join(schief)}. Nicht auffuellen, sondern "
            "nachsehen, welche Reihe beim Nachtragen vergessen wurde.")


def nachtragen(wochen: int | None = None, bloecke: list[int] | None = None) -> int:
    """Holt Wochenbloecke und arbeitet sie ein.

    Entweder die letzten N (`wochen`) oder eine ausdrueckliche Liste
    (`bloecke`). Die Liste braucht scripts/nachholen.py: eine Luecke von 2019
    ueber "die letzten N Wochen" zu erreichen hiesse, dreihundert Bloecke fuer
    eine einzige Stunde zu holen.

    Bestehende Monatsdateien werden gelesen, die geholten Stunden darin
    aktualisiert oder ergaenzt und die Datei neu geschrieben. Was ausserhalb
    der geholten Bloecke liegt, bleibt unangetastet -- ein Nachtrag darf keine
    Geschichte loeschen.
    """
    if bloecke is None:
        if wochen is None:
            raise ValueError("nachtragen braucht wochen oder bloecke")
        alle = smard.wochenbloecke(smard.LAST_NETZLAST, smard.REGION_DE, smard.STUNDE)
        bloecke = alle[-wochen:]
    # Der Grosshandelspreis MUSS mitgeholt werden. Er stand hier lange nicht
    # drin, und das war ein Fehler: der Nachtrag verlaengerte "stunden", der
    # Preis blieb kurz, und der Tuersteher lief in einen IndexError -- nur auf
    # dem Runner, weil lokal der Preis von Hand nachgezogen worden war.
    reihen = [("netzlast", smard.LAST_NETZLAST), ("preis_eur_mwh", PREIS_FILTER)]
    reihen += [(name, fid) for fid, name in smard.ERZEUGUNG.items()]
    with ThreadPoolExecutor(max_workers=8) as pool:
        ergebnisse = list(pool.map(lambda r: hole_jahr(r[1], bloecke), reihen))
    daten = dict(zip((r[0] for r in reihen), ergebnisse))
    daten["import_mwh"], daten["export_mwh"], _ = aussenhandel(bloecke)

    monate: dict[str, list[int]] = {}
    for ts in sorted(daten["netzlast"]):
        monate.setdefault(marke(ts)[:7], []).append(ts)

    ZIEL.mkdir(parents=True, exist_ok=True)
    for monat, neue in sorted(monate.items()):
        pfad = ZIEL / f"{monat}.json"
        if pfad.is_file():
            doc = json.loads(pfad.read_text(encoding="utf-8"))
        else:
            doc = {"monat": monat, "stunden": [], "netzlast": [], "erzeugung": {}}
        # Vorhandene Stunden ueber ihre Stelle ansprechen. Die Marke ist am Tag
        # der Rueckstellung nicht eindeutig -- deshalb wird ueber die Reihenfolge
        # gearbeitet, nicht ueber ein Woerterbuch.
        neue_marken = [marke(ts) for ts in neue]
        # DER SCHNITT LAG FALSCH und hat am 05.09.2026 echten Schaden angerichtet:
        # er war "die Stelle der ersten geholten Marke, sonst ans Ende anhaengen".
        # Stand die erste geholte Marke nicht in der Datei -- weil die Datei
        # spaeter beginnt als der geholte Block --, wurde alles angehaengt. Der
        # September 2026 hatte danach 164 Eintraege mit 48 Doubletten, und die
        # Gegenprobe gegen die Tageswerte meldete das Anderthalbfache.
        #
        # Richtig ist ein CHRONOLOGISCHER Schnitt: behalte, was VOR der ersten
        # geholten Marke liegt, und ersetze den Rest. Die Marken sind ISO-Text
        # und damit sortierbar; die doppelte Stunde der Rueckstellung faellt
        # dabei auf die richtige Seite, weil beide Vorkommen dieselbe Marke
        # tragen und der Vergleich echt kleiner ist.
        schnitt = len(doc["stunden"])
        if neue_marken:
            schnitt = 0
            for m in doc["stunden"]:
                if m >= neue_marken[0]:
                    break
                schnitt += 1
        doc["stunden"] = doc["stunden"][:schnitt] + neue_marken
        doc["netzlast"] = doc["netzlast"][:schnitt] + [daten["netzlast"].get(ts) for ts in neue]
        preis_neu = [daten["preis_eur_mwh"].get(ts) for ts in neue]
        if any(v is not None for v in preis_neu) or "preis_eur_mwh" in doc:
            alt_p = doc.get("preis_eur_mwh", [])
            # Falls die Reihe frueher kuerzer war, erst bis zur Schnittstelle
            # auffuellen -- sonst rutscht alles um die Differenz.
            alt_p = alt_p + [None] * max(0, schnitt - len(alt_p))
            doc["preis_eur_mwh"] = alt_p[:schnitt] + preis_neu
        for feld in ("import_mwh", "export_mwh"):
            neu_sp = [daten[feld].get(ts) for ts in neue]
            if any(v is not None for v in neu_sp) or feld in doc:
                alt_sp = doc.get(feld, [])
                alt_sp = alt_sp + [None] * max(0, schnitt - len(alt_sp))
                doc[feld] = alt_sp[:schnitt] + neu_sp
        for _, name in sorted(smard.ERZEUGUNG.items()):
            spalte_neu = [daten[name].get(ts) for ts in neue]
            if not any(v is not None for v in spalte_neu) and name not in doc["erzeugung"]:
                continue
            alt = doc["erzeugung"].get(name, [])
            doc["erzeugung"][name] = alt[:schnitt] + spalte_neu
        doc.setdefault("_quelle", "SMARD, Bundesnetzagentur -- https://www.smard.de/")
        doc.setdefault("_lizenz", "CC BY 4.0")
        doc.setdefault("_namensnennung", "Bundesnetzagentur | SMARD.de")
        doc["abgerufen"] = dt.datetime.now(smard.TZ).isoformat(timespec="seconds")
        # Jede Reihe je Stunde MUSS so lang sein wie die Stundenachse. Genau
        # das war nicht der Fall, und geprueft hat es niemand.
        pruefe_laengen(monat, doc)
        pfad.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                        encoding="utf-8", newline="\n")
        print(f"  {monat}: {len(neue)} Stunden nachgetragen ab Stelle {schnitt}, "
              f"jetzt {len(doc['stunden'])} Stunden, "
              f"{sum(1 for v in doc.get('preis_eur_mwh') or [] if v is not None)} Preise")

    verzeichnis = []
    for pfad in sorted(ZIEL.glob("*.json")):
        mm = json.loads(pfad.read_text(encoding="utf-8"))
        verzeichnis.append({"monat": mm["monat"], "datei": f"data/verlauf/{mm['monat']}.json",
                            "stunden": len(mm["stunden"])})
    (WURZEL / "data" / "verlauf-verzeichnis.json").write_text(json.dumps({
        "abgerufen": dt.datetime.now(smard.TZ).isoformat(timespec="seconds"),
        "hinweis": ("Verzeichnis der Monatsdateien mit Stundenwerten. Die Seite "
                    "laedt den Monat des gewaehlten Tages."),
        "monate": verzeichnis,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"  Verzeichnis mit {len(verzeichnis)} Monaten geschrieben")
    return 0


def preise_nachtragen() -> int:
    """Traegt die Grosshandelspreise in die vorhandenen Monatsdateien nach.

    Eigener Lauf, weil die Preise spaeter dazugekommen sind und ein voller
    Neulauf ueber alle Reihen rund 8.000 Abrufe waere. So sind es rund 400.
    """
    bloecke = smard.wochenbloecke(PREIS_FILTER, smard.REGION_DE, smard.STUNDE)
    print(f"  {len(bloecke)} Wochenbloecke ab {marke(bloecke[0])[:10]}")
    werte: dict[int, float] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for teil in pool.map(lambda b: hole_jahr(PREIS_FILTER, [b]), bloecke):
            werte.update(teil)
    print(f"  {len(werte):,} Stundenpreise geholt")

    geaendert = 0
    for pfad in sorted(ZIEL.glob("*.json")):
        doc = json.loads(pfad.read_text(encoding="utf-8"))
        # Ueber den Zeitstempel zuordnen waere sauberer, aber die Monatsdatei
        # kennt nur die Marken. Die sind am Rueckstellungstag mehrdeutig --
        # deshalb wird dort in der Reihenfolge zugeordnet, nicht ueber den
        # Namen: die Preisreihe hat dieselbe Stundenfolge wie die Netzlast.
        nach_marke: dict[str, list[float]] = {}
        for ts in sorted(werte):
            nach_marke.setdefault(marke(ts), []).append(werte[ts])
        zaehler: dict[str, int] = {}
        spalte_preis = []
        for m in doc["stunden"]:
            i = zaehler.get(m, 0)
            zaehler[m] = i + 1
            liste = nach_marke.get(m)
            spalte_preis.append(liste[i] if liste and i < len(liste) else None)
        if any(v is not None for v in spalte_preis):
            doc["preis_eur_mwh"] = spalte_preis
            doc["_preis_hinweis"] = (
                "Grosshandelspreis Deutschland/Luxemburg, Day-Ahead, in Euro je "
                "MWh. SMARD-Filter 4169. Die Reihe beginnt am 01.10.2018, dem Tag "
                "der Teilung der Gebotszone DE-AT-LU; fuer frueher gibt es diesen "
                "Preis nicht. Negative Werte sind echt und kein Fehler."
            )
            pfad.write_text(json.dumps(doc, ensure_ascii=False,
                                       separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
            geaendert += 1
    print(f"  {geaendert} Monatsdateien um den Preis ergaenzt")
    return 0


def aussenhandel_nachtragen() -> int:
    """Traegt Ein- und Ausfuhr je Stunde in die vorhandenen Monatsdateien nach.

    Eigener Lauf aus demselben Grund wie bei den Preisen: ein voller Neulauf
    ueber alle Reihen waere rund 8.000 Abrufe. Hier sind es 22 Reihen mal rund
    620 Wochenbloecke, aber in acht Straengen -- gemessen rund drei Minuten.

    WOZU. Die Frage "zu welchem Preis fuehrt Deutschland aus und ein" laesst
    sich mit Tageswerten nur naehern: an einem Tag wird zu teuren Stunden
    eingefuehrt und zu billigen ausgefuehrt, und das mittelt sich weg. Mit
    Stundenwerten wird daraus eine mengengewichtete Rechnung ueber genau die
    Stunden, in denen der Strom tatsaechlich floss.
    """
    bloecke = smard.wochenbloecke(smard.LAST_NETZLAST, smard.REGION_DE, smard.STUNDE)
    print(f"  {len(bloecke)} Wochenbloecke, 22 Reihen je Block")
    ein, aus, auffaellig = aussenhandel(bloecke)
    print(f"  {len(ein):,} Stunden mit Einfuhr, {len(aus):,} mit Ausfuhr")
    if auffaellig:
        print(f"  {len(auffaellig)} unplausible Einzelwerte als fehlend gefuehrt:")
        for a in auffaellig[:5]:
            print(f"     {a['stunde']}  {a['land']}/{a['richtung']}  "
                  f"{a['originalwert']:,.0f} MWh")

    geaendert = 0
    for pfad in sorted(ZIEL.glob("*.json")):
        doc = json.loads(pfad.read_text(encoding="utf-8"))
        # Wie bei den Preisen ueber die Reihenfolge zuordnen: die Marke ist am
        # Tag der Rueckstellung mehrdeutig.
        spalten = {}
        for feld, werte in (("import_mwh", ein), ("export_mwh", aus)):
            nach_marke: dict[str, list[float]] = {}
            for ts in sorted(werte):
                nach_marke.setdefault(marke(ts), []).append(werte[ts])
            zaehler: dict[str, int] = {}
            spalte = []
            for m in doc["stunden"]:
                i = zaehler.get(m, 0)
                zaehler[m] = i + 1
                liste = nach_marke.get(m)
                spalte.append(liste[i] if liste and i < len(liste) else None)
            spalten[feld] = spalte
        if not any(v is not None for v in spalten["import_mwh"]):
            continue
        doc.update(spalten)
        eigene = [a for a in auffaellig if a["stunde"][:7] == doc["monat"]]
        if eigene:
            doc["aussenhandel_auffaellig"] = eigene
        doc["_aussenhandel_hinweis"] = (
            "import_mwh und export_mwh sind die Summe ueber alle elf "
            "Nachbarlaender, in MWh je Stunde, physikalischer Stromfluss. Die "
            "Aufteilung je Land steht in den Tageswerten unter data/tage/ -- je "
            "Land und Stunde waeren es 22 Reihen und die Datei zweieinhalbmal "
            "so gross. Beide Richtungen koennen in derselben Stunde ungleich "
            "null sein: Deutschland fuehrt zur selben Zeit aus einem Land ein "
            "und in ein anderes aus."
        )
        pruefe_laengen(doc["monat"], doc)
        pfad.write_text(json.dumps(doc, ensure_ascii=False,
                                   separators=(",", ":")) + "\n",
                        encoding="utf-8", newline="\n")
        geaendert += 1
    print(f"  {geaendert} Monatsdateien um den Aussenhandel ergaenzt")
    return 0


def preisgewicht() -> int:
    """Rechnet je Tag die Bausteine fuer den mengengewichteten Preis aus.

    WOZU. Die Frage "zu welchem Preis fuehrt Deutschland ein und aus" muss
    STUENDLICH gewichtet werden. Mit Tagesmitteln kommt etwas anderes heraus:
    ueber 2023 bis 2026 ergab die Tagesnaeherung 67,53 Euro je MWh fuer die
    Ausfuhr, stuendlich gerechnet sind es 77,65. Die Naeherung lag um mehr als
    zehn Euro daneben, weil an einem Tag zu teuren Stunden eingefuehrt und zu
    billigen ausgefuehrt wird und sich das im Tagesmittel wegmittelt.

    Damit die Seite trotzdem JEDEN Zeitraum exakt zeigen kann, ohne zwoelf
    Monatsdateien zu laden, werden hier je Tag vier Summen abgelegt:

        p_ein = Summe ueber die Stunden von Preis * Einfuhr
        ein   = Summe der Einfuhr
        p_aus = Summe ueber die Stunden von Preis * Ausfuhr
        aus   = Summe der Ausfuhr

    Der gewichtete Preis eines beliebigen Zeitraums ist dann die Summe der
    Zaehler geteilt durch die Summe der Nenner -- exakt dasselbe Ergebnis wie
    die Rechnung ueber alle Einzelstunden. Das ist keine Naeherung, sondern
    Assoziativitaet.

    Eine Stunde zaehlt nur mit, wenn Preis UND Aussenhandel vorliegen.
    """
    tage: dict[str, list[float]] = {}
    stunden_gesamt = stunden_benutzt = 0
    for pfad in sorted(ZIEL.glob("*.json")):
        d = json.loads(pfad.read_text(encoding="utf-8"))
        preis = d.get("preis_eur_mwh") or []
        ein = d.get("import_mwh") or []
        aus = d.get("export_mwh") or []
        for i, m in enumerate(d["stunden"]):
            stunden_gesamt += 1
            if i >= len(preis) or preis[i] is None:
                continue
            if i >= len(ein) or ein[i] is None:
                continue
            p, e, a = preis[i], ein[i], (aus[i] if i < len(aus) and aus[i] is not None else 0.0)
            z = tage.setdefault(m[:10], [0.0, 0.0, 0.0, 0.0, 0])
            z[0] += p * e
            z[1] += e
            z[2] += p * a
            z[3] += a
            z[4] += 1
            stunden_benutzt += 1

    schluessel = sorted(tage)
    doc = {
        "_quelle": "SMARD, Bundesnetzagentur -- https://www.smard.de/",
        "_lizenz": "CC BY 4.0",
        "_namensnennung": "Bundesnetzagentur | SMARD.de",
        "_hinweis": (
            "SELBST GERECHNET aus den Stundenwerten unter data/verlauf/. Je Tag "
            "vier Summen ueber die Stunden: Preis mal Einfuhr, Einfuhr, Preis "
            "mal Ausfuhr, Ausfuhr. Der mengengewichtete Preis eines Zeitraums "
            "ist die Summe der Zaehler durch die Summe der Nenner -- exakt "
            "dasselbe Ergebnis wie die Rechnung ueber alle Einzelstunden. "
            "WICHTIG: das ist der deutsche Day-Ahead-Preis zur Stunde des "
            "Flusses, NICHT der Preis, zu dem an der Grenze abgerechnet wurde. "
            "Den fuehrt die Quelle nicht; er waere der Preis der jeweils "
            "gekoppelten Gebotszone."
        ),
        "formel": "gewichteter Preis = Summe(p_ein) / Summe(ein)",
        "erzeugt_aus": "data/verlauf/*.json",
        "stunden_benutzt": stunden_benutzt,
        "stunden_gesamt": stunden_gesamt,
        "tage": schluessel,
        "p_ein": [round(tage[k][0], 1) for k in schluessel],
        "ein": [round(tage[k][1], 1) for k in schluessel],
        "p_aus": [round(tage[k][2], 1) for k in schluessel],
        "aus": [round(tage[k][3], 1) for k in schluessel],
        "stunden": [tage[k][4] for k in schluessel],
    }
    ziel = WURZEL / "data" / "aussenhandel-preis.json"
    ziel.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8", newline="\n")
    gi = sum(doc["p_ein"]) / sum(doc["ein"]) if sum(doc["ein"]) else 0
    ga = sum(doc["p_aus"]) / sum(doc["aus"]) if sum(doc["aus"]) else 0
    print(f"  {len(schluessel)} Tage aus {stunden_benutzt:,} von "
          f"{stunden_gesamt:,} Stunden")
    print(f"  ueber alles: Einfuhr {gi:.2f}, Ausfuhr {ga:.2f} EUR/MWh")
    print(f"  geschrieben: data/aussenhandel-preis.json "
          f"({ziel.stat().st_size / 1e6:.2f} MB)")
    return 0


def main(argv: list[str]) -> int:
    if "--preise" in argv:
        return preise_nachtragen()
    if "--aussenhandel" in argv:
        rc = aussenhandel_nachtragen()
        return rc or preisgewicht()
    if "--preisgewicht" in argv:
        return preisgewicht()
    if "--wochen" in argv:
        i = argv.index("--wochen")
        return nachtragen(int(argv[i + 1]))
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

        # ACHTUNG: hier muss JEDE Reihe stehen, die in einer Monatsdatei
        # vorkommt. Der volle Lauf baut die Datei von Grund auf neu -- was hier
        # fehlt, waere danach geloescht. Preis und Aussenhandel fehlten
        # zeitweise und waeren bei einem vollen Lauf verschwunden.
        reihen = [("netzlast", smard.LAST_NETZLAST), ("preis_eur_mwh", PREIS_FILTER)]
        reihen += [(name, fid) for fid, name in smard.ERZEUGUNG.items()]

        with ThreadPoolExecutor(max_workers=8) as pool:
            ergebnisse = list(pool.map(lambda r: hole_jahr(r[1], bloecke), reihen))
        daten = dict(zip((r[0] for r in reihen), ergebnisse))
        daten["import_mwh"], daten["export_mwh"], _ = aussenhandel(bloecke)

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
            for feld in ("preis_eur_mwh", "import_mwh", "export_mwh"):
                spalte = [daten[feld].get(ts) for ts in mm]
                if any(v is not None for v in spalte):
                    doc[feld] = spalte
            pruefe_laengen(monat, doc)
            pfad = ZIEL / f"{monat}.json"
            pfad.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                            encoding="utf-8", newline="\n")
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
        }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
        print("  geschrieben: data/verlauf-verzeichnis.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
