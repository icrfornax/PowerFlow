"""Rechnet die SMARD-Jahressummen gegen eine ANDERS ERHOBENE Zahl.

Aufruf:  python scripts/fetch-gegenprobe.py --pruefen
         python scripts/fetch-gegenprobe.py

WARUM ES DIESE DATEI GIBT
-------------------------
Bis zum 06.09.2026 hatte dieses Projekt keine einzige echte Gegenprobe. Der
Abgleich SMARD gegen Energy-Charts ist keine: SMARD bekommt seine Zahlen von
ENTSO-E, und Energy-Charts veroeffentlicht die deutschen Reihen unveraendert
von SMARD weiter. Wer die beiden vergleicht, prueft Abruf, Einheit und
Zeitzone -- nicht die Messung.

Eurostat ist eine andere Erhebung. Die Zahlen kommen nach Verordnung (EG) Nr.
1099/2008 von den nationalen Verwaltungen, fuer Deutschland ueber das
Statistische Bundesamt, und nicht von den Uebertragungsnetzbetreibern. Die
Metadaten der Quelle nennen ausdruecklich "National Administrations competent
for energy statistics" und an keiner Stelle ENTSO-E.

WAS VERGLICHEN WIRD -- UND WAS NICHT VERGLEICHBAR IST
-----------------------------------------------------
Die beiden Reihen messen NICHT DASSELBE, und genau das ist der Punkt:

  SMARD    Netzeinspeisung ins oeffentliche Netz. Was ein Industriebetrieb
           selbst erzeugt und selbst verbraucht, steht nicht darin.
  Eurostat GESAMTE Erzeugung in Deutschland, einschliesslich Eigenerzeugung
           der Industrie und kleiner Anlagen. Brutto (GEP) einschliesslich
           Eigenverbrauch der Kraftwerke, netto (NEP) ohne ihn.

Der Abstand ist deshalb kein Fehler, sondern eine Groesse mit Bedeutung. Er
wird berechnet und benannt, nicht wegerklaert.

DIE JAHRESZAHLEN SIND DIE BELASTBAREN, NICHT DIE MONATSZAHLEN
--------------------------------------------------------------
Der Monatsdatensatz nrg_cb_pem sieht zunaechst passender aus, ist aber
unvollstaendig: fuer 2023 nennt er 456,0 TWh Nettoerzeugung, der Jahresdatensatz
derselben Quelle 498,7 TWh. 42,7 TWh Unterschied INNERHALB von Eurostat. Er
wird deshalb nicht verwendet. Geprueft am 06.09.2026.

ZWEI FALLEN IM MONATSDATENSATZ, die hier nur der Vollstaendigkeit halber
stehen, falls jemand ihn doch einmal anfasst: CF_R (brennbare erneuerbare
Stoffe) steckt in CF UND in RA000, und RA130 (Pumpspeicher) steckt in RA100,
aber NICHT in RA000. Die Identitaet lautet
TOTAL = CF + N9000 + X9900 + (RA000 - CF_R) + RA130 und geht exakt auf.

EINHEIT: GWH, aus der Dimension `unit` der Antwort GELESEN, nicht angenommen.
Das Skript bricht ab, wenn dort etwas anderes steht. SMARD liefert MWh; die
Umrechnung steht an einer Stelle und heisst so.

DEZIMALTRENNZEICHEN: keines, die Werte sind echte JSON-Zahlen. `eurostat.py`
prueft den Typ bei jedem Lauf.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys

import eurostat

WURZEL = pathlib.Path(__file__).resolve().parent.parent
TAGE = WURZEL / "data" / "tage"
ZIEL = WURZEL / "data" / "gegenprobe.json"

ERSTES_JAHR = 2015

# Die Zuordnung ist eine ENTSCHEIDUNG und wird als solche gefuehrt: sie steht
# in der Datei, damit jeder sie nachsehen kann. Zusammengefasst wird nur, wo
# beide Seiten dieselbe Sache meinen.
ZUORDNUNG = [
    ("Braunkohle", ["Braunkohle"], ["C0220", "C0330"]),
    ("Steinkohle", ["Steinkohle"], ["C0110", "C0121", "C0129", "C0311",
                                    "C0350-0370"]),
    ("Erdgas", ["Erdgas"], ["G3000"]),
    ("Kernenergie", ["Kernenergie"], ["N900H"]),
    ("Wind", ["Wind Onshore", "Wind Offshore"], ["RA300"]),
    ("Photovoltaik", ["Photovoltaik"], ["RA420"]),
    ("Wasserkraft", ["Wasserkraft"], ["RA100"]),
    ("Biomasse", ["Biomasse"], ["BIOE"]),
]

# Groessenordnungsprobe: die deutsche Jahreserzeugung liegt zwischen 300 und
# 800 TWh. Wer GWh fuer MWh haelt, landet um den Faktor 1000 daneben.
SPANNE_TWH = (300, 800)


def smard_jahr(jahr: int) -> dict | None:
    p = TAGE / f"{jahr}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def summe(reihe: list) -> float:
    return sum(x for x in reihe if x is not None)


def bauen() -> dict:
    gep = eurostat.hole("nrg_bal_c", geo="DE", unit="GWH", nrg_bal="GEP",
                        sinceTimePeriod=str(ERSTES_JAHR))
    bil = eurostat.hole("nrg_cb_e", geo="DE", unit="GWH",
                        sinceTimePeriod=str(ERSTES_JAHR))
    for name, t in (("nrg_bal_c", gep), ("nrg_cb_e", bil)):
        if t.einheit() != "GWH":
            raise SystemExit(f"ABBRUCH: {name} liefert '{t.einheit()}' statt GWH. "
                             "Einheit wird gelesen, nicht angenommen.")

    jahre, gesamt, handel = [], [], []
    traeger = {name: [] for name, _, _ in ZUORDNUNG}
    for jahr in range(ERSTES_JAHR, dt.date.today().year + 1):
        d = smard_jahr(jahr)
        brutto = gep.wert(siec="TOTAL", time=str(jahr))
        netto = bil.wert(nrg_bal="NEP", siec="E7000", time=str(jahr))
        if d is None or brutto is None or netto is None:
            continue
        # Ein angefangenes Jahr waere ein Vergleich von 12 gegen 8 Monate.
        if len(d["tage"]) < 365:
            continue
        s = sum(summe(r) for r in d["erzeugung"].values()) / 1e6
        b, n = brutto / 1000, netto / 1000
        if not SPANNE_TWH[0] <= b <= SPANNE_TWH[1]:
            raise SystemExit(f"ABBRUCH: {jahr} Bruttoerzeugung {b:,.0f} TWh liegt "
                             f"ausserhalb von {SPANNE_TWH}. Einheit pruefen.")
        jahre.append(jahr)
        gesamt.append({
            "jahr": jahr,
            "smard_twh": round(s, 1),
            "eurostat_netto_twh": round(n, 1),
            "eurostat_brutto_twh": round(b, 1),
            "abstand_netto_prozent": round((s - n) / n * 100, 1),
            "abstand_brutto_prozent": round((s - b) / b * 100, 1),
        })
        for name, sk, ek in ZUORDNUNG:
            sw = sum(summe(d["erzeugung"][k]) for k in sk if k in d["erzeugung"]) / 1e6
            ew = sum(gep.wert(siec=c, time=str(jahr)) or 0 for c in ek) / 1000
            traeger[name].append({
                "jahr": jahr,
                "smard_twh": round(sw, 1),
                "eurostat_brutto_twh": round(ew, 1),
                "abstand_prozent": round((sw - ew) / ew * 100, 1) if ew > 0.05 else None,
            })
        ah = d.get("aussenhandel") or {}
        ein = sum(summe(L.get("import") or []) for L in ah.values()) / 1e6
        aus = sum(summe(L.get("export") or []) for L in ah.values()) / 1e6
        ie = bil.wert(nrg_bal="IMP", siec="E7000", time=str(jahr))
        ae = bil.wert(nrg_bal="EXP", siec="E7000", time=str(jahr))
        if ie and ae:
            handel.append({
                "jahr": jahr,
                "smard_einfuhr_twh": round(ein, 1),
                "eurostat_einfuhr_twh": round(ie / 1000, 1),
                "smard_ausfuhr_twh": round(aus, 1),
                "eurostat_ausfuhr_twh": round(ae / 1000, 1),
                "abstand_einfuhr_prozent": round((ein - ie / 1000) / (ie / 1000) * 100, 1),
                "abstand_ausfuhr_prozent": round((aus - ae / 1000) / (ae / 1000) * 100, 1),
            })

    if not jahre:
        raise SystemExit("ABBRUCH: kein einziges Jahr vergleichbar. Erst nachsehen.")

    return {
        "_quelle": ("Eurostat, Statistisches Amt der Europaeischen Union -- "
                    "nrg_bal_c (Bruttoerzeugung je Energietraeger) und nrg_cb_e "
                    "(Strombilanz). Erhoben nach Verordnung (EG) Nr. 1099/2008 "
                    "ueber die nationalen Verwaltungen, NICHT ueber ENTSO-E."),
        "_lizenz": "CC BY 4.0 (Beschluss 2011/833/EU der Europaeischen Kommission)",
        "_namensnennung": (f"Source: {gep.doi()} und {bil.doi()}, "
                           f"abgerufen am {dt.date.today().isoformat()}"),
        "_veraendert": ("Ja. Aus den Jahreswerten von Eurostat sind Summen in "
                        "TWh gebildet und den SMARD-Summen gegenuebergestellt; "
                        "der Abstand ist gerechnet."),
        "_hinweis": (
            "DIE ERSTE ECHTE GEGENPROBE DIESES PROJEKTS. Alle uebrigen Reihen "
            "hier stammen mittelbar von ENTSO-E; ein Abgleich unter ihnen "
            "prueft Abruf, Einheit und Zeitzone, aber nicht die Messung. "
            "Eurostat erhebt ueber die nationalen Verwaltungen und ist damit "
            "unabhaengig. ACHTUNG, DIE BEIDEN MESSEN NICHT DASSELBE: SMARD "
            "zaehlt die Einspeisung ins OEFFENTLICHE NETZ, Eurostat die "
            "GESAMTE Erzeugung einschliesslich der Eigenerzeugung von "
            "Industrie und Kleinanlagen; brutto (GEP) zusaetzlich "
            "einschliesslich des Eigenverbrauchs der Kraftwerke. Der Abstand "
            "ist deshalb kein Fehler, sondern die Groesse dieses Unterschieds. "
            "Er wird je Jahr und je Energietraeger ausgewiesen und nirgends "
            "weggerechnet. Verwendet werden die JAHRESdatensaetze: der "
            "Monatsdatensatz nrg_cb_pem widerspricht ihnen um 42,7 TWh fuer "
            "2023 und ist unvollstaendig. Beleg: docs/beleg-gegenprobe.md."),
        "einheit": "TWh",
        "abgerufen": dt.date.today().isoformat(),
        "stand_eurostat": {"nrg_bal_c": gep.stand(), "nrg_cb_e": bil.stand()},
        "smard_bedeutung": "Einspeisung ins oeffentliche Netz (netto)",
        "eurostat_bedeutung": ("gesamte Erzeugung in Deutschland, brutto "
                               "einschliesslich Kraftwerkseigenverbrauch"),
        "jahre": jahre,
        "gesamt": gesamt,
        "traeger": [{"name": n, "smard_reihen": sk, "eurostat_codes": ek,
                     "jahre": traeger[n]} for n, sk, ek in ZUORDNUNG],
        "aussenhandel": handel,
    }


def main(argv: list[str]) -> int:
    doc = bauen()
    print(f"  {len(doc['jahre'])} volle Jahre vergleichbar: "
          f"{doc['jahre'][0]} bis {doc['jahre'][-1]}")
    print("  Jahr    SMARD   EU netto  EU brutto   Abstand netto")
    for g in doc["gesamt"]:
        print(f"  {g['jahr']}  {g['smard_twh']:7.1f}  {g['eurostat_netto_twh']:8.1f}  "
              f"{g['eurostat_brutto_twh']:9.1f}   {g['abstand_netto_prozent']:+6.1f} %")
    print("\n  Je Energietraeger, letztes volles Jahr:")
    for t in doc["traeger"]:
        letzt = t["jahre"][-1]
        a = letzt["abstand_prozent"]
        print(f"    {t['name']:14s} {letzt['smard_twh']:7.1f} gegen "
              f"{letzt['eurostat_brutto_twh']:7.1f} TWh   "
              + (f"{a:+6.1f} %" if a is not None else "     --"))
    if "--pruefen" in argv:
        print("\nNur gelesen. Es wurde nichts nach data/ geschrieben.")
        return 0
    ZIEL.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8", newline="\n")
    print(f"\n  geschrieben: data/gegenprobe.json ({ZIEL.stat().st_size:,} Bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
