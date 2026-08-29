"""Holt die Tagesdaten eines Kalendertags von SMARD und schreibt sie nach data/.

Aufruf:  python scripts/fetch-tagesdaten.py 2026-08-19

Erzeugt:
  data/erzeugung-<tag>.csv     Erzeugung je Energietraeger, Region DE
  data/regelzonen-<tag>.csv    Last und Erzeugung je Regelzone
  data/aussenhandel-<tag>.csv  Physikalischer Stromfluss je Nachbarland
  data/tagesbilanz.json        Kennzahlen fuer die Seite
  data/meta.json               Abrufzeitpunkt, Quellen, Lizenz

Alle CSV-Dateien tragen einen Kommentarkopf mit "#": Quelle, Lizenz,
Namensnennung, Abrufzeitpunkt, Rechenweg und der Hinweis zum Zahlformat.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys

import smard

WURZEL = pathlib.Path(__file__).resolve().parent.parent
DATA = WURZEL / "data"

QUELLE = "SMARD, Bundesnetzagentur -- https://www.smard.de/"
LIZENZ = "CC BY 4.0"
NAMENSNENNUNG = "Bundesnetzagentur | SMARD.de"


def kopf(titel: str, tag: dt.date, abruf: str, rechenweg: list[str]) -> list[str]:
    zeilen = [
        f"# {titel}",
        f"# Tag (Ortszeit Europe/Berlin): {tag.isoformat()}",
        f"# Abgerufen: {abruf}",
        f"# Quelle: {QUELLE}",
        f"# Lizenz: {LIZENZ}",
        f"# Namensnennung: {NAMENSNENNUNG}",
        "#",
        "# Einheit: MWh je Intervall. Die SMARD-Reihen liefern eine Energiemenge",
        "# je Intervall, keine mittlere Leistung. Nachgewiesen aus den Daten:",
        "# der Stundenwert ist die Summe der vier Viertelstundenwerte.",
        "# Leistung in MW = Wert / Intervalllaenge in h.",
        "#",
        "# Zahlformat: Diese Datei ist maschinenlesbar und benutzt den PUNKT als",
        "# Dezimaltrennzeichen. Die Anzeige auf der Webseite ist deutsch",
        "# formatiert (Tausenderpunkt, Dezimalkomma). Das ist kein Fehler,",
        "# sondern derselbe Wert in zwei Schreibweisen.",
        "#",
    ]
    zeilen += [f"# Rechenweg: {z}" for z in rechenweg]
    zeilen.append("#")
    return zeilen


def schreibe(pfad: pathlib.Path, kopfzeilen: list[str], spalten: list[str], zeilen: list[list]) -> None:
    text = "\n".join(kopfzeilen)
    text += "\n" + ",".join(spalten) + "\n"
    for z in zeilen:
        text += ",".join("" if w is None else str(w) for w in z) + "\n"
    pfad.write_text(text, encoding="utf-8")
    print(f"  geschrieben: {pfad.relative_to(WURZEL)}  ({len(zeilen)} Zeilen)")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    tag = dt.date.fromisoformat(argv[1])
    abruf = dt.datetime.now(smard.TZ).isoformat(timespec="seconds")
    DATA.mkdir(exist_ok=True)
    erwartet = smard.erwartete_punkte(tag, smard.VIERTELSTUNDE)
    print(f"Tag {tag}, erwartete Viertelstundenpunkte: {erwartet}")

    # --- Erzeugung nach Energietraeger, Region DE -------------------------
    zeilen, erzeugung_gesamt = [], 0.0
    for fid, name in sorted(smard.ERZEUGUNG.items()):
        summe, n, soll = smard.tagessumme_mwh(fid, smard.REGION_DE, smard.VIERTELSTUNDE, tag)
        if n != soll:
            raise SystemExit(f"ABBRUCH: Filter {fid} ({name}) liefert {n} von {soll} Punkten.")
        erzeugung_gesamt += summe
        zeilen.append([fid, name, round(summe, 2), n])
    zeilen.sort(key=lambda z: -z[2])
    schreibe(
        DATA / f"erzeugung-{tag}.csv",
        kopf("Realisierte Erzeugung nach Energietraeger, Region DE", tag, abruf,
             ["Tagessumme = Summe aller Viertelstundenwerte des lokalen Kalendertags.",
              "Kernenergie (Filter 1224) ist nicht enthalten: die Reihe endet am",
              "15.04.2023 23:45; fuer spaetere Zeitraeume liefert SMARD HTTP 404."]),
        ["filter_id", "energietraeger", "mwh", "punkte"],
        zeilen,
    )

    netzlast, n, soll = smard.tagessumme_mwh(
        smard.LAST_NETZLAST, smard.REGION_DE, smard.VIERTELSTUNDE, tag)
    if n != soll:
        raise SystemExit(f"ABBRUCH: Netzlast liefert {n} von {soll} Punkten.")
    residual, _, _ = smard.tagessumme_mwh(
        smard.LAST_RESIDUAL, smard.REGION_DE, smard.VIERTELSTUNDE, tag)
    pumpen, _, _ = smard.tagessumme_mwh(
        smard.LAST_PUMPSPEICHER, smard.REGION_DE, smard.VIERTELSTUNDE, tag)

    # --- Regelzonen -------------------------------------------------------
    rz_zeilen, summe_last, summe_gen = [], 0.0, 0.0
    for zone in smard.REGELZONEN:
        last, n, soll = smard.tagessumme_mwh(
            smard.LAST_NETZLAST, zone, smard.VIERTELSTUNDE, tag)
        if n != soll:
            raise SystemExit(f"ABBRUCH: Netzlast {zone} liefert {n} von {soll} Punkten.")
        gen = 0.0
        fehlend = []
        for fid in smard.ERZEUGUNG:
            try:
                s, m, _ = smard.tagessumme_mwh(fid, zone, smard.VIERTELSTUNDE, tag)
            except smard.Nichtvorhanden:
                # Der Energietraeger kommt in dieser Regelzone nicht vor --
                # etwa Wind Offshore bei Amprion und TransnetBW. SMARD liefert
                # dafuer 404, kein Nullarray. Das wird protokolliert und nicht
                # stillschweigend als Null verbucht.
                fehlend.append(smard.ERZEUGUNG[fid])
                continue
            if m != soll:
                raise SystemExit(f"ABBRUCH: Filter {fid} in {zone}: {m} von {soll} Punkten.")
            gen += s
        if fehlend:
            print(f"  Hinweis: in {zone} nicht vorhanden (HTTP 404): {', '.join(fehlend)}")
        summe_last += last
        summe_gen += gen
        rz_zeilen.append([zone, round(last, 2), round(gen, 2), round(gen - last, 2),
                          " ".join(fehlend)])
    schreibe(
        DATA / f"regelzonen-{tag}.csv",
        kopf("Netzlast und Erzeugung je Regelzone", tag, abruf,
             ["saldo_mwh = erzeugung_mwh - netzlast_mwh.",
              "Der Saldo ist der Austausch der Zone mit ALLEM -- den anderen",
              "Regelzonen UND dem Ausland. Er ist ausdruecklich kein Fluss von",
              "einer Zone in eine andere. Fluesse zwischen den Regelzonen werden",
              "nicht veroeffentlicht, siehe docs/beleg-smard.md.",
              "Spalte nicht_vorhanden: Energietraeger, fuer die SMARD in dieser",
              "Regelzone HTTP 404 liefert -- die Reihe existiert dort nicht.",
              "Das ist etwas anderes als der Wert Null und wird deshalb genannt."]),
        ["regelzone", "netzlast_mwh", "erzeugung_mwh", "saldo_mwh", "nicht_vorhanden"],
        rz_zeilen,
    )

    # --- Aussenhandel -----------------------------------------------------
    ah_zeilen, imp_ges, exp_ges = [], 0.0, 0.0
    soll_h = smard.erwartete_punkte(tag, smard.STUNDE)
    for land, ids in sorted(smard.AUSSENHANDEL.items()):
        imp, ni, _ = smard.tagessumme_mwh(ids["import"], smard.REGION_DE, smard.STUNDE, tag)
        exp, ne, _ = smard.tagessumme_mwh(ids["export"], smard.REGION_DE, smard.STUNDE, tag)
        if ni != soll_h or ne != soll_h:
            raise SystemExit(f"ABBRUCH: {land} liefert {ni}/{ne} von {soll_h} Stundenwerten.")
        imp_ges += imp
        exp_ges += exp
        ah_zeilen.append([land, ids["import"], ids["export"],
                          round(imp, 2), round(exp, 2), round(imp - exp, 2)])
    ah_zeilen.sort(key=lambda z: -z[5])
    schreibe(
        DATA / f"aussenhandel-{tag}.csv",
        kopf("Physikalischer Stromfluss je Nachbarland", tag, abruf,
             ["saldo_mwh = import_mwh - export_mwh. Positiv = Netto-Zufluss nach",
              "Deutschland. Import- und Exportreihen sind vorzeichenlos positiv.",
              "Aufloesung: 1 h (SMARD liefert den Aussenhandel nur stuendlich).",
              "Die Filter-IDs sind in keiner Dokumentation veroeffentlicht; sie",
              "wurden empirisch bestimmt und an zwei unabhaengigen Wochen gegen",
              "Energy-Charts cbpf verifiziert. Beleg: docs/beleg-aussenhandel.md."]),
        ["land", "filter_import", "filter_export", "import_mwh", "export_mwh", "saldo_mwh"],
        ah_zeilen,
    )

    # --- Kennzahlen fuer die Seite ---------------------------------------
    saldo_aussen = imp_ges - exp_ges
    rest = erzeugung_gesamt + saldo_aussen - netzlast
    bilanz = {
        "tag": tag.isoformat(),
        "abgerufen": abruf,
        "netzlast_mwh": round(netzlast, 2),
        "erzeugung_mwh": round(erzeugung_gesamt, 2),
        "residuallast_mwh": round(residual, 2),
        "pumpspeicherverbrauch_mwh": round(pumpen, 2),
        "import_mwh": round(imp_ges, 2),
        "export_mwh": round(exp_ges, 2),
        "aussensaldo_mwh": round(saldo_aussen, 2),
        "bilanzrest_mwh": round(rest, 2),
        "bilanzrest_prozent": round(rest / netzlast * 100, 4),
        "mittlere_leistung_mw": round(netzlast / ((smard.tagesgrenzen(tag)[1] - smard.tagesgrenzen(tag)[0]) / 3_600_000), 2),
        "erzeugung": [{"filter_id": z[0], "traeger": z[1], "mwh": z[2]} for z in zeilen],
        "regelzonen": [{"zone": z[0], "netzlast_mwh": z[1], "erzeugung_mwh": z[2],
                        "saldo_mwh": z[3],
                        "nicht_vorhanden": z[4].split() if z[4] else []} for z in rz_zeilen],
        "aussenhandel": [{"land": z[0], "import_mwh": z[3], "export_mwh": z[4], "saldo_mwh": z[5]} for z in ah_zeilen],
        "kontrolle": {
            "regelzonen_last_summe_mwh": round(summe_last, 2),
            "regelzonen_erzeugung_summe_mwh": round(summe_gen, 2),
            "abweichung_last_mwh": round(summe_last - netzlast, 2),
            "abweichung_erzeugung_mwh": round(summe_gen - erzeugung_gesamt, 2),
            "residuallast_nachgerechnet_mwh": None,
        },
    }
    # Selbstkontrolle: Residuallast unabhaengig nachrechnen.
    wind_pv = 0.0
    for fid in (4067, 1225, 4068):
        s, _, _ = smard.tagessumme_mwh(fid, smard.REGION_DE, smard.VIERTELSTUNDE, tag)
        wind_pv += s
    bilanz["kontrolle"]["residuallast_nachgerechnet_mwh"] = round(netzlast - wind_pv, 2)
    bilanz["kontrolle"]["residuallast_abweichung_mwh"] = round(
        (netzlast - wind_pv) - residual, 2)

    (DATA / "tagesbilanz.json").write_text(
        json.dumps(bilanz, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  geschrieben: data/tagesbilanz.json")

    (DATA / "meta.json").write_text(json.dumps({
        "abgerufen": abruf,
        "tag": tag.isoformat(),
        "quellen": [
            {"name": "SMARD, Bundesnetzagentur", "url": "https://www.smard.de/",
             "lizenz": LIZENZ, "namensnennung": NAMENSNENNUNG},
        ],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  geschrieben: data/meta.json")

    print()
    print(f"Netzlast          {netzlast/1000:12,.2f} GWh")
    print(f"Erzeugung         {erzeugung_gesamt/1000:12,.2f} GWh")
    print(f"Import            {imp_ges/1000:12,.2f} GWh")
    print(f"Export            {exp_ges/1000:12,.2f} GWh")
    print(f"Bilanzrest        {rest/1000:12,.2f} GWh  ({rest/netzlast*100:+.3f} %)")
    print(f"Kontrolle Zonen   Last {summe_last-netzlast:+.2f} MWh, Erzeugung {summe_gen-erzeugung_gesamt:+.2f} MWh")
    print(f"Kontrolle Residual{bilanz['kontrolle']['residuallast_abweichung_mwh']:+.2f} MWh")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
