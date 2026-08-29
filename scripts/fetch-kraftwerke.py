"""Holt die Kraftwerks-Stammdaten von SMARD und schreibt data/kraftwerke.json.

Aufruf:  python scripts/fetch-kraftwerke.py

ACHTUNG -- undokumentierter Endpunkt
------------------------------------
/app/power_plant_data/power_plant_metadata.json steht in keiner
veroeffentlichten SMARD- oder bundesAPI-Dokumentation. Er wurde aus dem
Frontend-Bundle des SMARD-Downloadcenters rekonstruiert. Er kann sich ohne
Ankuendigung aendern oder verschwinden. scripts/validate.py prueft deshalb die
Struktur und nicht nur die Existenz der Datei.
Beleg: docs/beleg-kraftwerksdaten.md

Die Rohdatei ist knapp 1 MB gross und enthaelt viel, was die Seite nicht
braucht. Geschrieben wird eine schlanke Fassung: nur Anlagen mit Koordinaten,
je Anlage Ort, Regelzone, Energietraeger, Leistung und die Block-productionIds,
ueber die sich die tatsaechliche Erzeugung des Blocks abrufen laesst.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib

import smard

WURZEL = pathlib.Path(__file__).resolve().parent.parent
DATA = WURZEL / "data"

# Die Stammdaten benutzen Uebersetzungsschluessel wie
# "KW-Energietraeger.Erdgas". Das Praefix wird abgeschnitten; der Rest ist
# bereits der deutsche Klartext.
PRAEFIXE = ("KW-Energieträger.", "KW-Land.", "KW-Stadt.", "KW-Name.", "KW-Status.")


def klartext(wert: str | None) -> str | None:
    if not isinstance(wert, str):
        return wert
    for p in PRAEFIXE:
        if wert.startswith(p):
            return wert[len(p):]
    return wert


def main() -> int:
    roh = smard.kraftwerke()
    anlagen = roh["plants"]
    print(f"Rohdaten: {len(anlagen)} Anlagen, meta_data.created ="
          f" {dt.datetime.fromtimestamp(roh['meta_data']['created']/1000, smard.TZ):%Y-%m-%d %H:%M}")

    ausgabe, ohne_koord, mit_reihe = [], 0, 0
    for a in anlagen:
        koord = a.get("coordinates")
        if not koord or len(koord) != 2:
            ohne_koord += 1
            continue
        bloecke = []
        for b in a.get("blocks", []):
            pid = b.get("productionId")
            if pid:
                mit_reihe += 1
            bloecke.append({
                "production_id": pid,
                "leistung_mw": b.get("power"),
                "energietraeger": klartext(b.get("resource")),
                "status": klartext(b.get("status")),
                "inbetriebnahme": b.get("commissioning"),
                "kwk": b.get("chp") == "KW-JaNein.Ja",
            })
        ausgabe.append({
            "code": a.get("code"),
            "betreiber": a.get("company"),
            "ort": klartext(a.get("city")),
            "plz": a.get("postalCode"),
            "land": klartext(a.get("state")),
            # Nicht jede Anlage einer deutschen Regelzone steht in Deutschland:
            # Vianden (LU), Vorarlberg und Tirol (AT) und Aargau (CH) gehoeren
            # zu Amprion, TransnetBW bzw. TenneT. Das Feld wird deshalb
            # ausdruecklich mitgefuehrt.
            "staat": klartext(a.get("country")),
            "regelzone": a.get("regionId"),
            "energietraeger": klartext(a.get("resource")),
            "leistung_mw": a.get("power"),
            # [Breite, Laenge] wie in der Quelle.
            "lat": koord[0],
            "lon": koord[1],
            "bloecke": bloecke,
        })

    ausgabe.sort(key=lambda x: -(x["leistung_mw"] or 0))
    doc = {
        "_hinweis": (
            "Quelle: SMARD, Bundesnetzagentur. Lizenz CC BY 4.0, Namensnennung "
            "'Bundesnetzagentur | SMARD.de'. Endpunkt undokumentiert, aus dem "
            "SMARD-Frontend rekonstruiert -- siehe docs/beleg-kraftwerksdaten.md. "
            "Dies sind STAMMDATEN (Standort, Leistung, Traeger), keine Messung. "
            "Die tatsaechliche Erzeugung eines Blocks liegt nur fuer Bloecke mit "
            "production_id vor und wird ueber chart_data mit der REGELZONE der "
            "Anlage als region abgerufen -- mit region=DE liefert SMARD 404."
        ),
        "abgerufen": dt.datetime.now(smard.TZ).isoformat(timespec="seconds"),
        "quelle_created": roh["meta_data"]["created"],
        "anzahl": len(ausgabe),
        "anlagen": ausgabe,
    }
    DATA.mkdir(exist_ok=True)
    (DATA / "kraftwerke.json").write_text(
        json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    groesse = (DATA / "kraftwerke.json").stat().st_size
    print(f"  geschrieben: data/kraftwerke.json  ({groesse:,} Bytes)")
    print(f"  Anlagen mit Koordinaten: {len(ausgabe)}   ohne: {ohne_koord}")
    print(f"  Bloecke mit abrufbarer Erzeugungsreihe: {mit_reihe}")
    zonen: dict[str, list] = {}
    for a in ausgabe:
        zonen.setdefault(a["regelzone"], []).append(a["leistung_mw"] or 0)
    for z, w in sorted(zonen.items(), key=lambda x: -sum(x[1])):
        print(f"    {z:<12} {len(w):4d} Anlagen  {sum(w):10,.1f} MW")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
