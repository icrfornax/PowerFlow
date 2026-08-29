"""Tuersteher vor dem Deploy. Prueft Dateien, Einbindungen und Zahlen.

Aufruf:  python scripts/validate.py
         python scripts/validate.py --negativtests

Ohne Argument: prueft das Repository und gibt bei jedem Fehler den Exit-Code 1
zurueck. Mit --negativtests: verfaelscht jede Pruefgroesse im Speicher und
weist nach, dass die zugehoerige Pruefung anschlaegt. Eine Pruefung, die nie
hat fehlschlagen sehen, ist keine Pruefung.

Die Zahlenpruefungen laufen ueber JEDEN belegten Tag aller Jahresdateien, nicht
ueber einen Stichtag. Ein Fehler an einem einzelnen Tag faellt sonst nicht auf.

Das Skript waechst mit. Jede neue Datei und jede belegte Sachaussage auf der
Seite kommt hier hinein.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

WURZEL = pathlib.Path(__file__).resolve().parent.parent

PFLICHTDATEIEN = [
    "index.html",
    "assets/powerflow.css",
    "assets/powerflow.js",
    "data/tage-verzeichnis.json",
    "data/kraftwerke.json",
    "data/grundkarte.json",
]

PFLICHT_IN_INDEX = [
    "assets/powerflow.css",
    "assets/powerflow.js",
    'id="powerflow-anker"',
]

# Sachaussagen, die auf der Seite stehen muessen. Sie sind belegt und duerfen
# nicht stillschweigend verschwinden.
PFLICHT_IN_JS = [
    "Bundesnetzagentur | SMARD.de",   # geforderte Namensnennung SMARD
    "CC BY 4.0",                      # Lizenz SMARD
    "Natural Earth",                  # Herkunft der Grundkarte
    "kein Regler",                    # Kennzeichnung gemessener Werte
    "543/2013",                       # Grund, warum Zonenfluesse fehlen
    "23c",                            # Grund, warum Leitungsfluesse fehlen
    "Konsistenzprüfung",              # SMARD gegen Energy-Charts
    "Zurücksetzen",                   # Pflichtknopf
]

# Toleranzen der Selbstkontrollen, in Prozent bzw. MWh je Tag.
#
# Der Bilanzrest (Erzeugung + Import - Export - Netzlast) ist KEINE enge
# Selbstkontrolle. Ueber alle 4.258 belegten Tage gemessen liegt er zwischen
# -18,8 % und +12,0 %, im Median bei -2,6 %. Eine fruehere Schwelle von 0,5 %
# war auf einen einzelnen guenstigen Tag geeicht und damit falsch. In den Rest
# laufen Netzverluste, die unterschiedliche zeitliche Aufloesung von Erzeugung
# und Aussenhandel und -- vor 2018 deutlich -- Erfassungsluecken der Quelle.
# Die Grenze hier faengt grobe Fehler ab, nicht die bekannte Streuung.
GRENZE_BILANZREST_PROZENT = 25.0
#
# Diese beiden muessen dagegen eng sein: die vier Regelzonen MUESSEN sich auf
# Deutschland summieren, und die Residuallast MUSS sich aus Netzlast minus Wind
# und PV nachrechnen lassen. Beides ist bei Tagesaufloesung reine Rundung.
# Regelzonen-Last gegen Deutschland: ab 2019 stimmt das auf rund 10 MWh. Der
# einzige groessere Ausreisser ist der 27.04.2023 mit +1.647 MWh (0,13 %).
GRENZE_ZONEN_LAST_MWH = 2_000.0
GRENZE_ZONEN_ERZEUGUNG_MWH = 60.0
GRENZE_RESIDUAL_ABWEICHUNG_MWH = 60.0

# Ab hier ist die Zonenaufteilung der Quelle vollstaendig genug, um streng
# geprueft zu werden. Davor fehlen 2015 bis zu 3,4 Prozent der Last je Tag.
STRENG_AB = "2019-01-01"

# Budget fuer die bekannte Ungenauigkeit der Quelle beim Vergleich Regelzonen
# gegen Deutschland je Energietraeger. Aktuell gemessen: 0,49 Prozent der
# Vergleiche, groesste Einzelabweichung 24.029 MWh.
ANTEIL_ZONENABWEICHUNG_PROZENT = 1.0
GROESSTE_ZONENABWEICHUNG_MWH = 50_000.0

# Bekannter Fehler der Quelle, der nicht stillschweigend verschwinden darf.
BEKANNT_AUFFAELLIG = ("2015-02-09", "aussenhandel/Schweiz/import")

# Plausibilitaetsrahmen fuer Kraftwerkskoordinaten: lat_min, lat_max, lon_min,
# lon_max. Die Untergrenze liegt bei 46,5 und nicht bei 47,0, weil die Werke
# der Vorarlberger Illwerke in Oesterreich liegen und dennoch zur deutschen
# Regelzone TransnetBW gehoeren. Das ist kein Datenfehler, sondern die
# tatsaechliche Ausdehnung der Regelzone.
RAHMEN = (46.5, 55.5, 5.5, 15.5)

BUNDESLAENDER = 16
REGELZONEN = {"50Hertz", "TenneT", "Amprion", "TransnetBW"}


class Befund:
    def __init__(self) -> None:
        self.fehler: list[str] = []
        self.ok: list[str] = []

    def pruefe(self, bedingung: bool, text: str) -> None:
        (self.ok if bedingung else self.fehler).append(text)


def lade(pfad: str) -> str:
    return (WURZEL / pfad).read_text(encoding="utf-8")


def ohne_kommentare(js: str) -> str:
    """Entfernt /* */- und //-Kommentare aus JavaScript.

    Bewusst einfach gehalten: Strings mit // darin werden nicht beruecksichtigt.
    Das reicht, weil hier nur nach verbotenen Bezeichnern gesucht wird und ein
    zu VIEL entfernter Text die Pruefung nur strenger, nie laxer macht.
    """
    js = re.sub(r"/\*.*?\*/", " ", js, flags=re.S)
    js = re.sub(r"(?m)//.*$", " ", js)
    return js


def jahresdateien() -> dict[int, dict]:
    verz = json.loads(lade("data/tage-verzeichnis.json"))
    return {j["jahr"]: json.loads(lade(j["datei"])) for j in verz["jahre"]}


def tagesbefunde(jahr: int, d: dict) -> list[str]:
    """Rechnet die Selbstkontrollen fuer jeden belegten Tag eines Jahres.

    Der Vergleich Regelzonen gegen Deutschland laeuft erst ab STRENG_AB. Vor
    2019 ist die Zonenaufteilung der Quelle nachweislich unvollstaendig: 2015
    fehlen bis zu 3,4 Prozent der Last und ueber 450 GWh Erzeugung an einem Tag.
    Das ist eine Eigenschaft der Quelle und wird im Seitentext benannt, statt
    hier durch eine weite Toleranz unsichtbar gemacht zu werden.

    Der Erzeugungsvergleich laeuft JE ENERGIETRAEGER und nur dann, wenn der Wert
    in Deutschland und in allen vier Zonen vorliegt -- eine Zone, der an einem
    Tag ein Wert fehlt, wuerde sonst gegen eine vollstaendige Deutschlandsumme
    verglichen und eine Abweichung vortaeuschen, die keine ist.
    """
    fehler: list[str] = []
    weich: list[tuple[str, float]] = []
    vergleiche = 0
    traeger = list(d["erzeugung"].values())
    # Reihen, die es in dieser Zone strukturell nicht gibt (HTTP 404).
    fehlende_reihen = {n["reihe"] for n in d.get("nicht_vorhanden", [])}
    streng = f"{jahr}-12-31" >= STRENG_AB

    for i, tag in enumerate(d["tage"]):
        netzlast = d["netzlast"][i]
        if netzlast is None:
            continue

        erzeugung = sum(r[i] for r in traeger if r[i] is not None)
        imp = sum(a["import"][i] for a in d["aussenhandel"].values() if a["import"][i] is not None)
        exp = sum(a["export"][i] for a in d["aussenhandel"].values() if a["export"][i] is not None)
        rest = erzeugung + imp - exp - netzlast
        if abs(rest / netzlast * 100) > GRENZE_BILANZREST_PROZENT:
            fehler.append(f"{tag}: Bilanzrest {rest / netzlast * 100:+.2f} %")

        # Groessenordnung: die mittlere Leistung Deutschlands liegt zwischen
        # 30 und 90 GW. Faengt einen Faktor 1000 sofort ab.
        if not (30_000 <= netzlast / 24 <= 90_000):
            fehler.append(
                f"{tag}: mittlere Leistung {netzlast / 24 / 1000:.1f} GW ausserhalb 30..90 GW")

        # Residuallast = Netzlast minus Wind on/off minus PV. Muss aufgehen.
        residual = d["residuallast"][i]
        wind_pv, vollstaendig = 0.0, True
        for name in ("Wind Onshore", "Wind Offshore", "Photovoltaik"):
            v = d["erzeugung"][name][i]
            if v is None:
                vollstaendig = False
            else:
                wind_pv += v
        if residual is not None and vollstaendig:
            abw = (netzlast - wind_pv) - residual
            if abs(abw) > GRENZE_RESIDUAL_ABWEICHUNG_MWH:
                fehler.append(f"{tag}: Residuallast nachgerechnet weicht um {abw:+.1f} MWh ab")

        if not (streng and tag >= STRENG_AB):
            continue

        zonen_last = [z["netzlast"][i] for z in d["regelzonen"].values()]
        if all(v is not None for v in zonen_last):
            abw = sum(zonen_last) - netzlast
            if abs(abw) > GRENZE_ZONEN_LAST_MWH:
                fehler.append(f"{tag}: Regelzonen-Last weicht um {abw:+.1f} MWh ab")

        for name, reihe_de in d["erzeugung"].items():
            if reihe_de[i] is None:
                continue
            summe, vollstaendig = 0.0, True
            for zone, z in d["regelzonen"].items():
                if f"regelzonen/{zone}/erzeugung/{name}" in fehlende_reihen:
                    continue  # gibt es in dieser Zone nicht -- kein Loch
                v = z["erzeugung"][name][i]
                if v is None:
                    vollstaendig = False
                    break
                summe += v
            if not vollstaendig:
                continue
            vergleiche += 1
            abw = summe - reihe_de[i]
            if abs(abw) > GRENZE_ZONEN_ERZEUGUNG_MWH:
                weich.append((f"{tag}: {name} Zonen gegen DE weicht um {abw:+.1f} MWh ab",
                              abs(abw)))
    return fehler, weich, vergleiche


def pruefe_alles(jahre: dict[int, dict], index_html: str, js: str,
                 kraftwerke: dict, grundkarte: dict) -> Befund:
    b = Befund()

    for name in PFLICHTDATEIEN:
        b.pruefe((WURZEL / name).is_file(), f"Datei vorhanden: {name}")

    for baustein in PFLICHT_IN_INDEX:
        b.pruefe(baustein in index_html, f"index.html bindet ein: {baustein}")

    for aussage in PFLICHT_IN_JS:
        b.pruefe(aussage in js, f"Seitentext enthaelt: {aussage!r}")

    treffer = re.findall(r'(?:powerflow\.(?:css|js))\?v=(\d{8}-[a-z0-9-]+)', index_html)
    b.pruefe(len(treffer) == 2, "Cache-Buster an CSS und JS vorhanden")
    b.pruefe(len(set(treffer)) <= 1, "Cache-Buster an CSS und JS identisch")

    code = ohne_kommentare(js)
    # toISOString() verschiebt in Europa den Tag. Darf im Modul nicht vorkommen.
    b.pruefe("toISOString" not in code, "kein toISOString() im Modulcode")
    # Kein localStorage: aller Zustand kommt aus den Dateien.
    b.pruefe("localStorage" not in code, "kein localStorage im Modulcode")
    b.pruefe(js.lstrip().startswith("/*") and "(function ()" in js,
             "Modul ist als IIFE gekapselt")

    # Genau EIN Regler. Ein zweites Bedienelement fuer eine gemessene Groesse
    # waere ein Bruch der Datendisziplin.
    b.pruefe(code.count('type: "date"') == 1, "genau ein Datumsregler im Modul")
    b.pruefe('type: "range"' not in code, "kein weiterer Schieberegler im Modul")

    # --- Jahresdateien ---
    b.pruefe(bool(jahre), "Jahresdateien vorhanden")
    alle_fehler: list[str] = []
    alle_weich: list[tuple[str, float]] = []
    vergleiche_gesamt = 0
    tage_gesamt = 0
    for jahr, d in sorted(jahre.items()):
        belegt = sum(1 for v in d["netzlast"] if v is not None)
        tage_gesamt += belegt
        b.pruefe(len(d["tage"]) == len(d["netzlast"]),
                 f"{jahr}: Tagesachse und Netzlast gleich lang")
        b.pruefe(set(d["regelzonen"]) == REGELZONEN, f"{jahr}: vier Regelzonen vorhanden")
        b.pruefe(len(d["aussenhandel"]) >= 10,
                 f"{jahr}: Aussenhandel fuer {len(d['aussenhandel'])} Laender")
        b.pruefe("auffaellig" in d, f"{jahr}: Liste der auffaelligen Werte ist vorhanden")
        harte, weiche, n = tagesbefunde(jahr, d)
        alle_fehler += harte
        alle_weich += weiche
        vergleiche_gesamt += n
    b.pruefe(not alle_fehler,
             f"Harte Selbstkontrollen ueber alle {tage_gesamt} belegten Tage bestanden"
             + ("" if not alle_fehler else f" -- {len(alle_fehler)} Ausreisser, "
                                           f"erster: {alle_fehler[0]}"))

    # Regelzonen gegen Deutschland je Energietraeger: die Quelle ist hier nicht
    # ueberall exakt. Gemessen weichen rund 0,5 Prozent der Vergleiche ab, die
    # groesste Einzelabweichung liegt bei 24.029 MWh (08.12.2025, Pumpspeicher).
    # Das wird nicht durch eine weite Toleranz unsichtbar gemacht, sondern als
    # Budget gefuehrt: waechst der Anteil oder die groesste Abweichung deutlich,
    # ist etwas passiert und der Deploy haelt an.
    anteil = len(alle_weich) / vergleiche_gesamt * 100 if vergleiche_gesamt else 0.0
    groesste = max((w[1] for w in alle_weich), default=0.0)
    b.pruefe(anteil <= ANTEIL_ZONENABWEICHUNG_PROZENT,
             f"Zonen gegen DE je Traeger: {len(alle_weich)} von {vergleiche_gesamt} "
             f"Vergleichen weichen ab ({anteil:.2f} %, Budget "
             f"{ANTEIL_ZONENABWEICHUNG_PROZENT} %)")
    b.pruefe(groesste <= GROESSTE_ZONENABWEICHUNG_MWH,
             f"groesste Einzelabweichung Zonen gegen DE: {groesste:,.0f} MWh "
             f"(Budget {GROESSTE_ZONENABWEICHUNG_MWH:,.0f} MWh)")

    # Der bekannte Quellenfehler muss weiter als solcher verzeichnet sein --
    # samt Originalwert. Verschwindet der Eintrag, ist entweder die Pruefung
    # ausgehebelt oder der Wert stillschweigend korrigiert worden.
    verzeichnet = [a for d in jahre.values() for a in d.get("auffaellig", [])
                   if a["tag"] == BEKANNT_AUFFAELLIG[0] and a["reihe"] == BEKANNT_AUFFAELLIG[1]]
    b.pruefe(len(verzeichnet) == 1 and verzeichnet[0]["originalwert"] > 400_000,
             f"bekannter Quellenfehler {BEKANNT_AUFFAELLIG[0]} "
             f"{BEKANNT_AUFFAELLIG[1]} ist mit Originalwert verzeichnet")

    # --- Kraftwerksstammdaten ---
    # Der Endpunkt ist undokumentiert. Deshalb wird die Struktur geprueft,
    # nicht nur die Existenz der Datei.
    anlagen = kraftwerke.get("anlagen", [])
    b.pruefe(len(anlagen) > 400, f"Kraftwerksstammdaten: {len(anlagen)} Anlagen")
    ohne = [a for a in anlagen if a.get("lat") is None or a.get("lon") is None]
    b.pruefe(not ohne, f"alle Anlagen haben Koordinaten ({len(ohne)} ohne)")
    mit_koord = [a for a in anlagen if a.get("lat") is not None and a.get("lon") is not None]
    ausserhalb = [a for a in mit_koord
                  if not (RAHMEN[0] <= a["lat"] <= RAHMEN[1]
                          and RAHMEN[2] <= a["lon"] <= RAHMEN[3])]
    b.pruefe(not ausserhalb,
             f"alle Koordinaten liegen im Plausibilitaetsrahmen ({len(ausserhalb)} ausserhalb)")

    # Belegte Sachaussage: die deutschen Regelzonen reichen ueber die
    # Staatsgrenze. Vianden in Luxemburg gehoert zu Amprion, die Werke in
    # Vorarlberg und im Aargau zu TransnetBW, Silz und Kuehtai in Tirol zu
    # TenneT. Wer diese Anlagen kuenftig herausfiltert, weil sie "nicht in
    # Deutschland liegen", verfaelscht die Regelzonenbilanz.
    b.pruefe(all("staat" in a for a in anlagen),
             "Feld staat ist in den Kraftwerksstammdaten vorhanden")
    ausland = [a for a in anlagen if a.get("staat") and a["staat"] != "Deutschland"]
    b.pruefe(bool(ausland),
             f"Anlagen ausserhalb Deutschlands sind erfasst ({len(ausland)} Stueck, "
             f"{sum(a['leistung_mw'] or 0 for a in ausland):,.0f} MW)")
    b.pruefe(all(a["regelzone"] in REGELZONEN for a in ausland),
             "jede Anlage im Ausland ist einer deutschen Regelzone zugeordnet")
    b.pruefe({a.get("regelzone") for a in anlagen} == REGELZONEN,
             "Anlagen decken genau die vier Regelzonen ab")

    # --- Grundkarte ---
    laender = grundkarte.get("bundeslaender", [])
    b.pruefe(len(laender) == BUNDESLAENDER,
             f"Grundkarte hat {len(laender)} Bundeslaender (erwartet {BUNDESLAENDER})")
    b.pruefe(bool(grundkarte.get("nachbarn")),
             f"Grundkarte hat {len(grundkarte.get('nachbarn', []))} Nachbarstaaten")
    b.pruefe("public domain" in (grundkarte.get("_lizenz") or "").lower()
             or "gemeinfrei" in (grundkarte.get("_lizenz") or "").lower(),
             "Lizenz der Grundkarte ist im Dateikopf genannt")
    punkte = [p for l in laender for r in l["ringe"] for p in r]
    b.pruefe(bool(punkte) and all(
        RAHMEN[2] - 3 <= p[0] <= RAHMEN[3] + 3 and RAHMEN[0] - 2 <= p[1] <= RAHMEN[1] + 3
        for p in punkte), "Grundkarten-Koordinaten liegen in [Laenge, Breite]-Reihenfolge")

    return b


def eingaben() -> tuple:
    return (jahresdateien(), lade("index.html"), lade("assets/powerflow.js"),
            json.loads(lade("data/kraftwerke.json")),
            json.loads(lade("data/grundkarte.json")))


def negativtests() -> int:
    """Verfaelscht jede Pruefgroesse und weist nach, dass die Pruefung anschlaegt."""
    import copy

    jahre, index_html, js, kraftwerke, grundkarte = eingaben()
    grund = pruefe_alles(jahre, index_html, js, kraftwerke, grundkarte)
    if grund.fehler:
        print("Die Negativtests brauchen einen sauberen Ausgangszustand, aber es gibt Fehler:")
        for f in grund.fehler:
            print("  FEHLT:", f)
        return 1

    jahr = max(jahre)

    def mit_jahr(aenderung) -> dict:
        k = copy.deepcopy(jahre)
        aenderung(k[jahr])
        return k

    def ersten_belegten(d) -> int:
        return next(i for i, v in enumerate(d["netzlast"]) if v is not None)

    def netzlast_verdreifachen(d):
        d["netzlast"][ersten_belegten(d)] *= 3

    def faktor_tausend(d):
        d["netzlast"][ersten_belegten(d)] /= 1000

    def zone_kappen(d):
        d["regelzonen"]["50Hertz"]["netzlast"][ersten_belegten(d)] = 0.0

    def residual_verfaelschen(d):
        d["residuallast"][ersten_belegten(d)] += 5000.0

    def zone_entfernen(d):
        del d["regelzonen"]["TenneT"]

    faelle = [
        ("Cache-Buster entfernt",
         lambda: (jahre, index_html.replace("?v=20260830-tageswahl", ""), js, kraftwerke, grundkarte)),
        ("Anker aus index.html entfernt",
         lambda: (jahre, index_html.replace('id="powerflow-anker"', 'id="weg"'), js, kraftwerke, grundkarte)),
        ("Namensnennung aus dem Modul entfernt",
         lambda: (jahre, index_html, js.replace("Bundesnetzagentur | SMARD.de", "irgendwer"), kraftwerke, grundkarte)),
        ("Herkunft der Grundkarte entfernt",
         lambda: (jahre, index_html, js.replace("Natural Earth", "irgendwoher"), kraftwerke, grundkarte)),
        ("Zuruecksetzen-Knopf entfernt",
         lambda: (jahre, index_html, js.replace("Zurücksetzen", "Weg"), kraftwerke, grundkarte)),
        ("toISOString() ins Modul geschmuggelt",
         lambda: (jahre, index_html, js + "\nvar x = new Date().toISOString();", kraftwerke, grundkarte)),
        ("localStorage ins Modul geschmuggelt",
         lambda: (jahre, index_html, js + "\nlocalStorage.setItem('a','b');", kraftwerke, grundkarte)),
        ("zweiter Regler ins Modul geschmuggelt",
         lambda: (jahre, index_html, js + '\nvar y = el("input", { type: "range" });', kraftwerke, grundkarte)),
        ("Bilanz eines einzelnen Tages verfaelscht",
         lambda: (mit_jahr(netzlast_verdreifachen), index_html, js, kraftwerke, grundkarte)),
        ("Faktor 1000 an einem einzelnen Tag",
         lambda: (mit_jahr(faktor_tausend), index_html, js, kraftwerke, grundkarte)),
        ("Regelzonensumme an einem Tag verfaelscht",
         lambda: (mit_jahr(zone_kappen), index_html, js, kraftwerke, grundkarte)),
        ("Residuallast an einem Tag verfaelscht",
         lambda: (mit_jahr(residual_verfaelschen), index_html, js, kraftwerke, grundkarte)),
        ("Eine Regelzone fehlt",
         lambda: (mit_jahr(zone_entfernen), index_html, js, kraftwerke, grundkarte)),
        ("Kraftwerk ohne Koordinate",
         lambda: (jahre, index_html, js, _aendere(kraftwerke, lambda k: k["anlagen"][0].update(lat=None)), grundkarte)),
        ("Kraftwerk ausserhalb Deutschlands",
         lambda: (jahre, index_html, js, _aendere(kraftwerke, lambda k: k["anlagen"][0].update(lat=41.9, lon=12.5)), grundkarte)),
        ("Feld staat aus den Stammdaten entfernt",
         lambda: (jahre, index_html, js, _aendere(kraftwerke, lambda k: [a.pop("staat", None) for a in k["anlagen"]]), grundkarte)),
        ("Ein Bundesland fehlt in der Grundkarte",
         lambda: (jahre, index_html, js, kraftwerke, _aendere(grundkarte, lambda g: g["bundeslaender"].pop()))),
        ("Lizenzangabe der Grundkarte entfernt",
         lambda: (jahre, index_html, js, kraftwerke, _aendere(grundkarte, lambda g: g.update(_lizenz="")))),
        ("Bekannter Quellenfehler aus der Liste entfernt",
         lambda: (_ohne_auffaellig(jahre), index_html, js, kraftwerke, grundkarte)),
        ("Quellenfehler stillschweigend korrigiert statt verzeichnet",
         lambda: (_korrigiert(jahre), index_html, js, kraftwerke, grundkarte)),
        ("Grundkarte auf [Breite, Laenge] gedreht",
         lambda: (jahre, index_html, js, kraftwerke, _gedreht(grundkarte))),
    ]

    print("Negativtests -- jede Pruefung muss bei verfaelschter Eingabe anschlagen.")
    print()
    misslungen = 0
    for name, mach in faelle:
        befund = pruefe_alles(*mach())
        schlug_an = bool(befund.fehler)
        print(f"  [{'ok   ' if schlug_an else 'PROBL'}] {name}"
              + ("" if schlug_an else "  <-- Pruefung hat NICHT angeschlagen"))
        if not schlug_an:
            misslungen += 1
    print()
    if misslungen:
        print(f"{misslungen} Negativtest(s) ohne Wirkung. Die Pruefung ist lueckenhaft.")
        return 1
    print(f"Alle {len(faelle)} Negativtests haben angeschlagen.")
    return 0


def _aendere(doc: dict, aenderung) -> dict:
    import copy
    k = copy.deepcopy(doc)
    aenderung(k)
    return k


def _ohne_auffaellig(jahre: dict) -> dict:
    import copy
    k = copy.deepcopy(jahre)
    for d in k.values():
        d["auffaellig"] = []
    return k


def _korrigiert(jahre: dict) -> dict:
    """Simuliert, dass jemand den Ausreisser 'repariert' statt ihn zu melden."""
    import copy
    k = copy.deepcopy(jahre)
    for d in k.values():
        for a in d.get("auffaellig", []):
            a["originalwert"] = 25_000.0   # auf einen plausiblen Wert gezogen
    return k


def _gedreht(grundkarte: dict) -> dict:
    import copy
    k = copy.deepcopy(grundkarte)
    for l in k["bundeslaender"]:
        l["ringe"] = [[[p[1], p[0]] for p in r] for r in l["ringe"]]
    return k


def main(argv: list[str]) -> int:
    if "--negativtests" in argv:
        return negativtests()

    fehlend = [n for n in PFLICHTDATEIEN if not (WURZEL / n).is_file()]
    if fehlend:
        for n in fehlend:
            print("FEHLER: Datei fehlt:", n)
        return 1

    befund = pruefe_alles(*eingaben())
    for t in befund.ok:
        print("  ok    ", t)
    for t in befund.fehler:
        print("  FEHLER", t)
    print()
    if befund.fehler:
        print(f"{len(befund.fehler)} Fehler. Kein Deploy.")
        return 1
    print(f"Alle {len(befund.ok)} Pruefungen bestanden.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
