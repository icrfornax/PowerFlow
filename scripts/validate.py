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
    "data/verlauf-verzeichnis.json",
    "data/redispatch-verzeichnis.json",
    "data/quellen.json",
    "data/kraftwerke.json",
    "data/grundkarte.json",
    "data/netz-hoechstspannung.json",
    "data/netz-hochspannung.json",
    "data/netz-umspannwerke.json",
    "LIZENZ-DATEN.md",
    ".github/workflows/daten-smard.yml",
    ".github/workflows/daten-stammdaten.yml",
    ".github/workflows/pruefen.yml",
    "scripts/browsertest.mjs",
    "scripts/quellen.py",
    # Ohne .nojekyll laeuft die Auslieferung auf GitHub Pages durch Jekyll.
    # Die Seite ist reines statisches HTML; Jekyll bringt nichts und kann
    # Dateien unterschlagen. Die Datei ist leer und muss leer bleiben duerfen.
    ".nojekyll",
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
    "OpenStreetMap contributors",     # geforderte Namensnennung ODbL
    "ODbL",                           # Lizenz der Netzgeometrie
    "keinen Lastfluss",               # die Karte darf nicht als Fluss gelesen werden
    "schematisch",                    # Lage der Kuppelstellen-Pfeile
    "Als Tabelle anzeigen",           # Tabellenansicht des Diagramms
    "die einzige freie Variable",     # Kennzeichnung des Reglers
    "netztransparenz.de",             # Namensnennung Redispatch
    "Eingriffe und Probebetrieb",     # Redispatch ist kein Lastfluss -- und
                                      # nicht jede Massnahme ist ein Notfall
    "Probebetrieb ist kein Notfall",  # die Trennung muss auf der Seite stehen
    "Unterdeckung",                   # Luecke zwischen Erzeugung und Last
    "Day-Ahead",                      # Herkunft des Preises
]

# Farbtokens des Tagesverlaufs. Sie sind mit dem Validierer der dataviz-Regeln
# geprueft (Helligkeitsband, Chroma, Farbsehschwaeche, Kontrast) und muessen in
# ALLEN vier Themenbloecken der CSS-Datei stehen -- hell und dunkel werden
# getrennt gepflegt, nicht umgerechnet.
TRAEGERTOKENS = ["--tr-kern", "--tr-braun", "--tr-stein", "--tr-gas",
                 "--tr-sonst", "--tr-bio", "--tr-wind", "--tr-pv"]
THEMENBLOECKE = 4

# Die Stundenwerte muessen die Tageswerte reproduzieren. Beide Reihen wurden
# unabhaengig voneinander abgerufen (Aufloesung "hour" gegen "day"), der
# Vergleich ist deshalb eine echte Gegenprobe der Abrufkette.
GRENZE_STUNDEN_GEGEN_TAG_MWH = 5.0

# Netzdateien aus OpenStreetMap. Die Spannungsebenen, die jede enthalten muss.
NETZDATEIEN = {
    "data/netz-hoechstspannung.json": {"art": "linie", "min_volt": 220_000, "min_anzahl": 5_000},
    "data/netz-hochspannung.json": {"art": "linie", "min_volt": 110_000, "min_anzahl": 20_000},
    "data/netz-umspannwerke.json": {"art": "punkt", "min_volt": 110_000, "min_anzahl": 2_000},
}

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

# Redispatch: Hoch- und Herunterfahren gleichen sich nicht vollstaendig aus.
# Nach der Berichtigung des Dezimalkommas am 31.08.2026 gemessen 2021 bis 2026:
# 3,2 bis 18,1 Prozent, hoch stets groesser. (Mit den lueckenhaften Zahlen davor
# waren es 3,6 bis 25,4 -- die Luecke hat die Asymmetrie uebertrieben.) Grund
# laut Quelle: bei grenzueberschreitenden Massnahmen wird nur der deutsche
# Teil veroeffentlicht. Die Grenze faengt grobe Fehler ab, nicht die bekannte
# Asymmetrie.
GRENZE_REDISPATCH_SCHIEF_PROZENT = 40.0

# Plausibilitaetsrahmen fuer Kraftwerkskoordinaten: lat_min, lat_max, lon_min,
# lon_max. Die Untergrenze liegt bei 46,5 und nicht bei 47,0, weil die Werke
# der Vorarlberger Illwerke in Oesterreich liegen und dennoch zur deutschen
# Regelzone TransnetBW gehoeren. Das ist kein Datenfehler, sondern die
# tatsaechliche Ausdehnung der Regelzone.
RAHMEN = (46.5, 55.5, 5.5, 15.5)

# Jeder Pfad, der auf der Seite landet oder die Pruefung beeinflusst, muss im
# paths-Filter des Pruef-Workflows stehen. Fehlt einer, laeuft seine Aenderung
# ungeprueft durch.
PFLICHT_IN_PATHS = ["index.html", ".nojekyll", "assets/**", "data/**",
                    "scripts/**", "LIZENZ-DATEN.md"]

BUNDESLAENDER = 16
REGELZONEN = {"50Hertz", "TenneT", "Amprion", "TransnetBW"}


class Befund:
    def __init__(self) -> None:
        self.fehler: list[str] = []
        self.ok: list[str] = []

    def pruefe(self, bedingung: bool, text: str) -> None:
        (self.ok if bedingung else self.fehler).append(text)


def _im_git(pfad: str) -> bool:
    import subprocess
    try:
        r = subprocess.run(["git", "ls-files", "--error-unmatch", pfad],
                           cwd=WURZEL, capture_output=True)
        return r.returncode == 0
    except OSError:
        return False


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


def ohne_yaml_kommentare(y: str) -> str:
    """Entfernt reine Kommentarzeilen aus YAML.

    Noetig, weil die Workflows in ihren Kommentaren ausdruecklich erklaeren,
    was sie NICHT tun -- etwa "niemals --force". Eine Textsuche ueber die ganze
    Datei bliebe daran haengen. Dieselbe Falle wie bei toISOString im
    JavaScript, und sie ist mir dort schon einmal begegnet.
    """
    return "\n".join(z for z in y.split("\n") if not z.lstrip().startswith("#"))


def workflowdateien() -> dict[str, str]:
    return {n: lade(f".github/workflows/{n}")
            for n in ("daten-smard.yml", "daten-stammdaten.yml", "pruefen.yml")}


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
                 kraftwerke: dict, grundkarte: dict, netz: dict,
                 css: str, verlauf: dict, workflows: dict) -> Befund:
    b = Befund()

    for name in PFLICHTDATEIEN:
        b.pruefe((WURZEL / name).is_file(), f"Datei vorhanden: {name}")

    for baustein in PFLICHT_IN_INDEX:
        b.pruefe(baustein in index_html, f"index.html bindet ein: {baustein}")

    for aussage in PFLICHT_IN_JS:
        b.pruefe(aussage in js, f"Seitentext enthaelt: {aussage!r}")

    # Der Cache-Buster der DATENdateien wird im Skript aus dem eigenen Pfad
    # gelesen, nicht als zweite Konstante gepflegt. Eine zweite Stelle lief
    # auseinander -- genau deshalb steht hier eine Pruefung.
    b.pruefe("document.currentScript" in js and 'v=([^&]+)' in js,
             "Cache-Buster der Datendateien wird aus dem Skriptpfad gelesen")
    b.pruefe(not re.search(r'var VERSION = "', js),
             "keine zweite, von Hand gepflegte VERSION-Konstante")
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

    # Genau EIN Regler -- der Zeitraum. Er besteht aus zwei Datumsfeldern (von
    # und bis) und bleibt trotzdem eine einzige freie Variable; ein einzelner
    # Tag ist der Sonderfall von = bis. Ein drittes Feld waere ein Bruch der
    # Datendisziplin.
    b.pruefe(code.count('type: "date"') == 2,
             "genau zwei Datumsfelder (von und bis) -- ein Zeitraumregler")
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

    # --- Netzgeometrie aus OpenStreetMap ---
    # Die Lizenz ist eine ANDERE als bei den uebrigen Daten (ODbL statt CC BY
    # bzw. gemeinfrei) und verpflichtet zum Share-alike. Verschwindet die
    # Angabe, verletzt die Seite die Lizenz. Deshalb wird sie hier geprueft.
    for name, regel in NETZDATEIEN.items():
        d = netz.get(name) or {}
        objekte = d.get("objekte", [])
        b.pruefe(len(objekte) >= regel["min_anzahl"],
                 f"{name}: {len(objekte):,} Objekte (mindestens {regel['min_anzahl']:,})")
        b.pruefe("ODbL" in (d.get("_lizenz") or ""),
                 f"{name}: Lizenz ODbL im Dateikopf genannt")
        b.pruefe("OpenStreetMap contributors" in (d.get("_namensnennung") or ""),
                 f"{name}: Namensnennung im Dateikopf genannt")
        b.pruefe("KEINE MESSUNG" in (d.get("_hinweis") or "").upper(),
                 f"{name}: Hinweis, dass es keine Messung ist")
        b.pruefe("ODbL" in (d.get("_share_alike") or ""),
                 f"{name}: Share-alike-Hinweis vorhanden")

        zu_klein = [o for o in objekte if (o.get("v") or 0) < regel["min_volt"]]
        b.pruefe(not zu_klein,
                 f"{name}: alle Objekte mindestens {regel['min_volt'] // 1000} kV "
                 f"({len(zu_klein)} darunter)")

        if regel["art"] == "linie":
            koord = [pkt for o in objekte for pkt in o.get("p", [])]
            kurz = [o for o in objekte if len(o.get("p", [])) < 2]
            b.pruefe(not kurz, f"{name}: keine Linie mit weniger als zwei Punkten")
        else:
            koord = [[o.get("lon"), o.get("lat")] for o in objekte]
        # [Laenge, Breite]-Reihenfolge und Lage in Deutschland. Ein Dreher
        # faellt hier sofort auf.
        falsch = [k for k in koord
                  if not (RAHMEN[2] - 1 <= k[0] <= RAHMEN[3] + 1
                          and RAHMEN[0] - 1 <= k[1] <= RAHMEN[1] + 1)]
        b.pruefe(not falsch,
                 f"{name}: alle Koordinaten in [Laenge, Breite] und im Rahmen "
                 f"({len(falsch)} daneben)")

    # --- Tagesverlauf ---
    for token in TRAEGERTOKENS:
        b.pruefe(css.count(token + ":") == THEMENBLOECKE,
                 f"Farbton {token} in allen {THEMENBLOECKE} Themenbloecken definiert "
                 f"({css.count(token + ':')} gefunden)")

    b.pruefe(len(verlauf) >= 100, f"Verlauf: {len(verlauf)} Monatsdateien")

    # Grosshandelspreis. Die Reihe beginnt am 01.10.2018 -- dem Tag der Teilung
    # der Gebotszone DE-AT-LU. Fuer frueher gibt es diesen Preis nicht, und ein
    # aelterer Preis waere ein anderer Markt.
    mitPreis = [m for m, d in verlauf.items() if d.get("preis_eur_mwh")]
    b.pruefe(len(mitPreis) >= 90, f"Preis in {len(mitPreis)} Monatsdateien")
    b.pruefe(all(m >= "2018-10" for m in mitPreis),
             "kein Preis vor Oktober 2018 (Teilung der Gebotszone DE-AT-LU)")
    alle_preise = [p for d in verlauf.values() for p in (d.get("preis_eur_mwh") or [])
                   if p is not None]
    b.pruefe(bool(alle_preise) and min(alle_preise) < 0,
             f"negative Preise sind erhalten ({sum(1 for p in alle_preise if p < 0)} Stunden)")
    b.pruefe(max(alle_preise) < 1000 and min(alle_preise) > -1000,
             f"Preise im plausiblen Rahmen ({min(alle_preise):.0f} bis "
             f"{max(alle_preise):.0f} EUR/MWh)")

    # Gegenprobe: der Tagespreis ist das MITTEL der Stundenpreise, nicht ihre
    # Summe. Geprueft am 24.08.2026: 143,18 gegen 143,18.
    abw = []
    for monat, d in sorted(verlauf.items()):
        if not d.get("preis_eur_mwh"):
            continue
        jahr = int(monat[:4])
        jd = jahre.get(jahr)
        if not jd or not jd.get("preis_eur_mwh"):
            continue
        proTag: dict[str, list[float]] = {}
        for i, marke in enumerate(d["stunden"]):
            p = d["preis_eur_mwh"][i]
            if p is not None:
                proTag.setdefault(marke[:10], []).append(p)
        for tag, werte in proTag.items():
            if tag not in jd["tage"]:
                continue
            # Nur vollstaendige Tage vergleichen. Der laufende Tag hat in der
            # Stundendatei erst ein paar Stunden, waehrend die Tagesdatei
            # schon einen anderen Stand traegt -- der Vergleich waere dort
            # kein Befund, sondern ein Zeitversatz. 23 und 25 Stunden gibt es
            # an den Umstellungstagen.
            if not (23 <= len(werte) <= 25):
                continue
            tagwert = jd["preis_eur_mwh"][jd["tage"].index(tag)]
            if tagwert is None:
                continue
            mittel = sum(werte) / len(werte)
            if abs(mittel - tagwert) > 0.05:
                abw.append(f"{tag}: Mittel {mittel:.2f} gegen Tageswert {tagwert:.2f}")
    b.pruefe(not abw,
             "Tagespreis ist das Mittel der Stundenpreise"
             + ("" if not abw else f" -- {len(abw)} Abweichungen, erste: {abw[0]}"))

    # Gegenprobe: Summe der Stundenwerte gegen den Tageswert. Zwei getrennt
    # abgerufene Reihen der Quelle muessen dasselbe ergeben.
    abweichungen: list[str] = []
    verglichen = 0
    for monat, d in sorted(verlauf.items()):
        jahr = int(monat[:4])
        tagesdatei = jahre.get(jahr)
        if not tagesdatei:
            continue
        proTag: dict[str, float] = {}
        for i, marke in enumerate(d["stunden"]):
            v = d["netzlast"][i]
            if v is not None:
                proTag[marke[:10]] = proTag.get(marke[:10], 0.0) + v
        for tag, summe in proTag.items():
            if tag not in tagesdatei["tage"]:
                continue
            tagwert = tagesdatei["netzlast"][tagesdatei["tage"].index(tag)]
            if tagwert is None:
                continue
            verglichen += 1
            if abs(summe - tagwert) > GRENZE_STUNDEN_GEGEN_TAG_MWH:
                abweichungen.append(f"{tag}: Stunden {summe:,.2f} gegen Tag {tagwert:,.2f}")
    b.pruefe(not abweichungen,
             f"Stundenwerte reproduzieren den Tageswert an allen {verglichen} Tagen"
             + ("" if not abweichungen
                else f" -- {len(abweichungen)} Abweichungen, erste: {abweichungen[0]}"))

    # --- Workflows ---
    pruefwf = workflows["pruefen.yml"]
    for pfad in PFLICHT_IN_PATHS:
        b.pruefe(f'"{pfad}"' in pruefwf,
                 f"paths-Filter des Pruef-Workflows nennt: {pfad}")
    for name in ("daten-smard.yml", "daten-stammdaten.yml"):
        wf = ohne_yaml_kommentare(workflows[name])
        # Push-Wiederholung mit Rebase, niemals --force.
        b.pruefe("--force" not in wf, f"{name}: kein --force im Push")
        b.pruefe("git rebase origin/main" in wf, f"{name}: Push-Wiederholung mit Rebase")
        # Ein Push mit dem Standard-GITHUB_TOKEN loest keine weiteren Workflows
        # aus -- der Pages-Bau muss selbst angestossen werden.
        b.pruefe("pages/builds" in wf, f"{name}: stoesst den Pages-Bau selbst an")
        # Der Tuersteher laeuft VOR dem Commit.
        b.pruefe(wf.index("scripts/validate.py") < wf.index("git commit"),
                 f"{name}: Tuersteher laeuft vor dem Commit")
        b.pruefe("--negativtests" in wf, f"{name}: Negativtests laufen mit")
        b.pruefe(wf.index("scripts/quellen.py") < wf.index("scripts/validate.py"),
                 f"{name}: Quellenverzeichnis wird vor dem Tuersteher neu gebaut")
    # Der Browsertest gehoert in den Tuersteher, nicht in die Erinnerung des
    # Entwicklers. Eine Pruefung, die nur laeuft, wenn jemand daran denkt,
    # laeuft irgendwann nicht mehr.
    b.pruefe("browsertest.mjs" in pruefwf, "Pruef-Workflow fuehrt den Browsertest aus")
    b.pruefe("quellen.py --negativtest" in pruefwf,
             "Pruef-Workflow weist den Quellen-Waechter nach")

    # --- Geheimnisse ---
    # Ein einmal gepushtes Geheimnis steht auch nach dem Loeschen noch in der
    # History. Deshalb wird hier geprueft, dass .env ignoriert bleibt und die
    # Vorlage leer ist.
    ignoriert = lade(".gitignore")
    b.pruefe(any(z.strip() == ".env" for z in ignoriert.splitlines()),
             ".env steht in .gitignore")
    b.pruefe(not (WURZEL / ".env").is_file() or not _im_git(".env"),
             ".env ist nicht eingecheckt")
    if (WURZEL / ".env.beispiel").is_file():
        vorlage = lade(".env.beispiel")
        gefuellt = [z for z in vorlage.splitlines()
                    if "=" in z and not z.strip().startswith("#")
                    and z.split("=", 1)[1].strip()]
        b.pruefe(not gefuellt,
                 "die Vorlage .env.beispiel enthaelt keine Werte"
                 + (f" -- gefuellt: {[z.split('=')[0] for z in gefuellt]}" if gefuellt else ""))

    # --- Redispatch ---
    rdv = json.loads(lade("data/redispatch-verzeichnis.json"))
    b.pruefe(len(rdv["jahre"]) >= 5, f"Redispatch: {len(rdv['jahre'])} Jahresdateien")
    b.pruefe(rdv["jahre"][0]["jahr"] == 2021,
             "Redispatch beginnt 2021 -- frueher liefert die Quelle HTTP 400")
    for eintrag in rdv["jahre"]:
        d = json.loads(lade(eintrag["datei"]))
        b.pruefe("netztransparenz" in (d.get("_quelle") or "").lower(),
                 f"{eintrag['datei']}: Quelle genannt")
        b.pruefe("ENTSO-E" in (d.get("_lizenz") or ""),
                 f"{eintrag['datei']}: Lizenzgrundlage genannt")
        b.pruefe("arbeit_ueber_mitternacht_mwh" in d,
                 f"{eintrag['datei']}: Groesse der Mitternachtsannahme ausgewiesen")
        # Selbstkontrolle: Hoch- und Herunterfahren gleichen sich bei
        # Redispatch weitgehend aus -- aber NICHT vollstaendig, und das hat
        # einen belegten Grund: bei grenzueberschreitenden Massnahmen wird
        # laut Quelle nur der deutsche Teil veroeffentlicht. Gemessen ueber
        # 2021 bis 2026 liegt die Schieflage zwischen 3,6 und 25,4 Prozent,
        # mit hoch stets groesser als runter. Die Grenze faengt grobe Fehler
        # ab, nicht diese bekannte Asymmetrie.
        hoch = sum(t["erhoehen_mwh"] for t in d["tage"].values())
        runter = sum(t["reduzieren_mwh"] for t in d["tage"].values())
        schief = abs(hoch - runter) / max(hoch + runter, 1) * 100
        b.pruefe(schief < GRENZE_REDISPATCH_SCHIEF_PROZENT,
                 f"{eintrag['jahr']}: hoch gegen runter {schief:.1f} % schief "
                 f"(Budget {GRENZE_REDISPATCH_SCHIEF_PROZENT:.0f} %)")

    # --- Quellenverzeichnis ---
    # Der eigentliche Waechter steckt in scripts/quellen.py: es bricht ab,
    # sobald eine Datei unter data/ keiner Quelle zugeordnet ist. Hier wird
    # geprueft, dass das Ergebnis vollstaendig und aktuell ist -- eine Zahl
    # ohne Herkunft gibt es auf dieser Seite nicht.
    qv = json.loads(lade("data/quellen.json"))
    b.pruefe(len(qv["datensaetze"]) >= 10,
             f"Quellenverzeichnis: {len(qv['datensaetze'])} Datensaetze")
    tatsaechlich = sum(1 for p in (WURZEL / "data").rglob("*") if p.is_file())
    b.pruefe(qv["dateien_gesamt"] == tatsaechlich,
             f"Quellenverzeichnis zaehlt alle Dateien ({qv['dateien_gesamt']} "
             f"verzeichnet, {tatsaechlich} vorhanden)")
    ohneQuelle = [d["titel"] for d in qv["datensaetze"]
                  if d["quelle"] not in qv["quellen"]]
    b.pruefe(not ohneQuelle, f"jeder Datensatz hat eine bekannte Quelle ({ohneQuelle})")
    for schluessel, q in qv["quellen"].items():
        for feld in ("name", "url", "lizenz", "lizenz_url", "namensnennung", "erhebung"):
            b.pruefe(bool(q.get(feld)), f"Quelle {schluessel}: Feld {feld} gefuellt")
    # Das Verzeichnis muss REPRODUZIERBAR sein. Der Tuersteher erzeugt es neu
    # und vergleicht; steht eine Uhrzeit darin oder haengen die Groessen an den
    # Zeilenenden des Arbeitsverzeichnisses, kann der Vergleich nie aufgehen.
    # Genau daran ist er sechs Laeufe lang gescheitert -- deshalb wird beides
    # jetzt schon hier geprueft, nicht erst auf dem Runner.
    # Kein Redispatch-Satz darf still verloren gehen. Das Feld stand die ganze
    # Zeit in den Dateien und wurde nie geprueft -- 22,7 % der Saetze fielen
    # durch das Dezimalkomma heraus, ohne dass es jemand merkte.
    verloren = []
    for pf in sorted((WURZEL / "data" / "redispatch").glob("*.json")):
        doc = json.loads(pf.read_text(encoding="utf-8"))
        n = doc.get("unvollstaendige_saetze")
        if n:
            verloren.append(f"{pf.name}: {n}")
    b.pruefe(not verloren,
             "kein Redispatch-Satz wurde als unlesbar verworfen"
             + (" -- " + ", ".join(verloren) if verloren else ""))

    # Dasselbe fuer die uebrigen Quellen, die Text in Zahlen verwandeln. Jede
    # Lesestelle zaehlt mit, was sie nicht lesen konnte; hier wird der Zaehler
    # in der fertigen Datei noch einmal geprueft. Ein Zaehler, den niemand
    # prueft, ist kein Zaehler.
    zaehler = [
        ("data/mastr-wind.json", "beim_lesen_aufgefallen", ("unlesbar", "komma")),
        ("data/netz-hoechstspannung.json", "verworfen", ("ohne_spannung",)),
        ("data/netz-hochspannung.json", "verworfen", ("ohne_spannung",)),
        ("data/netz-umspannwerke.json", "verworfen", ("ohne_spannung",)),
    ]
    stumm = []
    for name, feld, schluessel in zaehler:
        pf = WURZEL / name
        if not pf.exists():
            continue
        doc = json.loads(pf.read_text(encoding="utf-8"))
        werte = doc.get(feld)
        if werte is None:
            stumm.append(f"{name}: Feld {feld} fehlt")
            continue
        for k in schluessel:
            if werte.get(k):
                stumm.append(f"{name}/{k}: {werte[k]}")
    b.pruefe(not stumm,
             "keine Quelle hat Zahlen still verworfen"
             + (" -- " + ", ".join(stumm) if stumm else ""))

    # Die Vorlage muss jeden Schluessel nennen, den ein Skript erwartet --
    # sonst sucht jemand vergeblich, wo er seinen Zugang eintragen soll.
    vorlage = (WURZEL / ".env.beispiel").read_text(encoding="utf-8")
    for schluessel in ("NT_CLIENT_ID", "NT_CLIENT_SECRET", "ENTSOE_TOKEN"):
        b.pruefe(schluessel + "=" in vorlage,
                 f".env.beispiel nennt {schluessel}")

    b.pruefe("erzeugt" not in qv,
             "Quellenverzeichnis traegt keinen Zeitstempel (sonst nie reproduzierbar)")

    # Jede Schreibstelle in scripts/ muss das Zeilenende ausdruecklich auf LF
    # setzen. Python uebersetzt sonst unter Windows zu CRLF, die Datei wird
    # groesser als auf dem Linux-Runner, und der Vergleich des Verzeichnisses
    # geht nicht auf. Beim ersten Umbau sind drei mehrzeilige Aufrufe
    # uebersehen worden -- deshalb zaehlt das hier und verlaesst sich nicht
    # auf Sorgfalt.
    ohne_lf = []
    for skript in sorted((WURZEL / "scripts").glob("*.py")):
        quelle = skript.read_text(encoding="utf-8")
        offen = quelle.count("write_text(") - quelle.count("newline=")
        if offen > 0:
            ohne_lf.append(f"{skript.name}: {offen}")
    b.pruefe(not ohne_lf,
             "jede Schreibstelle setzt newline (sonst CRLF unter Windows)"
             + (" -- " + ", ".join(ohne_lf) if ohne_lf else ""))
    falsch = []
    for d in qv["datensaetze"]:
        muster = d["muster"].split("/", 1)[1]
        ist = sum(p.stat().st_size for p in sorted((WURZEL / "data").glob(muster)))
        if ist != d["bytes"]:
            falsch.append(f"{d['titel']}: {d['bytes']} verzeichnet, {ist} gemessen")
    b.pruefe(not falsch,
             "die verzeichneten Dateigroessen stimmen mit den Dateien ueberein"
             + (" -- " + " | ".join(falsch[:3]) if falsch else ""))

    hinweis = qv.get("_hinweis") or ""
    b.pruefe("nichts modelliert" in hinweis,
             "Quellenverzeichnis sagt ausdruecklich, dass keine ZAHL modelliert wird")
    # Seit dem 31.08.2026 gibt es genau eine abgeleitete Geometrie. Der Hinweis
    # muss sie benennen -- ein pauschales "nichts modelliert" waere ab da falsch.
    b.pruefe("abgeleitet" in hinweis and "Regelzonen" in hinweis,
             "Quellenverzeichnis benennt die eine abgeleitete Geometrie")
    b.pruefe(qv.get("quellen", {}).get("abgeleitet", {}).get("name", "").endswith("KEINE Messung"),
             "die abgeleitete Flaeche steht unter einer eigenen, so benannten Quelle")

    lizenztext = lade("LIZENZ-DATEN.md")
    for pflicht in ("ODbL", "Share-alike", "Bundesnetzagentur | SMARD.de",
                    "© OpenStreetMap contributors", "23c",
                    "netztransparenz.de", "HTTP 403", "Klausel 2.5"):
        b.pruefe(pflicht in lizenztext, f"LIZENZ-DATEN.md nennt: {pflicht!r}")

    return b


# Reihenfolge der Eingaben von eingaben(). Die Negativtests arbeiten ueber
# diese Namen statt ueber Stellungsargumente.
FELDER = ("jahre", "index_html", "js", "kraftwerke", "grundkarte", "netz",
          "css", "verlauf", "workflows")


def verlaufdateien() -> dict[str, dict]:
    verz = json.loads(lade("data/verlauf-verzeichnis.json"))
    return {m["monat"]: json.loads(lade(m["datei"])) for m in verz["monate"]}


def netzdateien() -> dict[str, dict]:
    return {n: json.loads(lade(n)) for n in NETZDATEIEN}


def eingaben() -> tuple:
    return (jahresdateien(), lade("index.html"), lade("assets/powerflow.js"),
            json.loads(lade("data/kraftwerke.json")),
            json.loads(lade("data/grundkarte.json")),
            netzdateien(), lade("assets/powerflow.css"), verlaufdateien(),
            workflowdateien())


def negativtests() -> int:
    """Verfaelscht jede Pruefgroesse und weist nach, dass die Pruefung anschlaegt.

    Die Faelle beschreiben nur, WAS sie aendern; alles Uebrige kommt unveraendert
    aus dem Ausgangszustand. Eine fruehere Fassung reichte die Eingaben als
    Stellungsargumente durch -- als spaeter zwei Argumente dazukamen, liefen die
    alten Faelle mit leeren Voreinstellungen und "schlugen an", ohne etwas zu
    pruefen. Mit benannten Feldern kann das nicht mehr passieren.
    """
    import copy

    basis = dict(zip(FELDER, eingaben()))
    grund = pruefe_alles(**basis)
    if grund.fehler:
        print("Die Negativtests brauchen einen sauberen Ausgangszustand, aber es gibt Fehler:")
        for f in grund.fehler:
            print("  FEHLT:", f)
        return 1

    jahr = max(basis["jahre"])

    def mit_jahr(aenderung):
        k = copy.deepcopy(basis["jahre"])
        aenderung(k[jahr])
        return {"jahre": k}

    def ersten_belegten(d) -> int:
        return next(i for i, v in enumerate(d["netzlast"]) if v is not None)

    def ersetze(feld: str, alt: str, neu: str):
        return {feld: basis[feld].replace(alt, neu)}

    def verlauf_verfaelscht():
        k = copy.deepcopy(basis["verlauf"])
        ein = sorted(k)[0]
        for i, v in enumerate(k[ein]["netzlast"]):
            if v is not None:
                k[ein]["netzlast"][i] = v + 500.0
                break
        return {"verlauf": k}

    faelle = [
        # Die Version wird aus der Datei gelesen, nicht fest eingetragen: ein
        # hart notierter Cache-Buster veraltet beim naechsten Versionswechsel
        # und der Negativtest wird stillschweigend wirkungslos. Genau das ist
        # hier schon einmal passiert.
        ("Cache-Buster entfernt",
         lambda: {"index_html": re.sub(r"\?v=\d{8}-[a-z0-9-]+", "", basis["index_html"])}),
        ("Anker aus index.html entfernt",
         lambda: ersetze("index_html", 'id="powerflow-anker"', 'id="weg"')),
        ("Namensnennung aus dem Modul entfernt",
         lambda: ersetze("js", "Bundesnetzagentur | SMARD.de", "irgendwer")),
        ("Herkunft der Grundkarte entfernt",
         lambda: ersetze("js", "Natural Earth", "irgendwoher")),
        ("ODbL-Namensnennung aus dem Modul entfernt",
         lambda: ersetze("js", "OpenStreetMap contributors", "irgendwer")),
        ("Warnung \"keinen Lastfluss\" aus der Karte entfernt",
         lambda: ersetze("js", "keinen Lastfluss", "den Lastfluss")),
        ("Hinweis auf die schematische Pfeillage entfernt",
         lambda: ersetze("js", "schematisch", "genau")),
        ("Tabellenansicht des Diagramms entfernt",
         lambda: ersetze("js", "Als Tabelle anzeigen", "Nichts")),
        ("Zuruecksetzen-Knopf entfernt",
         lambda: ersetze("js", "Zurücksetzen", "Weg")),
        ("toISOString() ins Modul geschmuggelt",
         lambda: {"js": basis["js"] + "\nvar x = new Date().toISOString();"}),
        ("localStorage ins Modul geschmuggelt",
         lambda: {"js": basis["js"] + "\nlocalStorage.setItem('a','b');"}),
        ("zweiter Regler ins Modul geschmuggelt",
         lambda: {"js": basis["js"] + '\nvar y = el("input", { type: "range" });'}),
        ("drittes Datumsfeld ins Modul geschmuggelt",
         lambda: {"js": basis["js"] + '\nvar z3 = el("input", { type: "date" });'}),
        ("Traegerfarbton aus einem Themenblock entfernt",
         lambda: {"css": basis["css"].replace("  --tr-wind: #5f92dd;\n", "", 1)}),
        ("Bilanz eines einzelnen Tages verfaelscht",
         lambda: mit_jahr(lambda d: d["netzlast"].__setitem__(
             ersten_belegten(d), d["netzlast"][ersten_belegten(d)] * 3))),
        ("Faktor 1000 an einem einzelnen Tag",
         lambda: mit_jahr(lambda d: d["netzlast"].__setitem__(
             ersten_belegten(d), d["netzlast"][ersten_belegten(d)] / 1000))),
        ("Regelzonensumme an einem Tag verfaelscht",
         lambda: mit_jahr(lambda d: d["regelzonen"]["50Hertz"]["netzlast"].__setitem__(
             ersten_belegten(d), 0.0))),
        ("Residuallast an einem Tag verfaelscht",
         lambda: mit_jahr(lambda d: d["residuallast"].__setitem__(
             ersten_belegten(d), d["residuallast"][ersten_belegten(d)] + 5000.0))),
        ("Eine Regelzone fehlt",
         lambda: mit_jahr(lambda d: d["regelzonen"].pop("TenneT"))),
        ("Bekannter Quellenfehler aus der Liste entfernt",
         lambda: {"jahre": _ohne_auffaellig(basis["jahre"])}),
        ("Quellenfehler stillschweigend korrigiert statt verzeichnet",
         lambda: {"jahre": _korrigiert(basis["jahre"])}),
        ("Eine Stunde im Verlauf verfaelscht",
         verlauf_verfaelscht),
        ("Kraftwerk ohne Koordinate",
         lambda: {"kraftwerke": _aendere(basis["kraftwerke"],
                                         lambda k: k["anlagen"][0].update(lat=None))}),
        ("Kraftwerk ausserhalb Deutschlands",
         lambda: {"kraftwerke": _aendere(basis["kraftwerke"],
                                         lambda k: k["anlagen"][0].update(lat=41.9, lon=12.5))}),
        ("Feld staat aus den Stammdaten entfernt",
         lambda: {"kraftwerke": _aendere(basis["kraftwerke"],
                                         lambda k: [a.pop("staat", None) for a in k["anlagen"]])}),
        ("Ein Bundesland fehlt in der Grundkarte",
         lambda: {"grundkarte": _aendere(basis["grundkarte"],
                                         lambda g: g["bundeslaender"].pop())}),
        ("Lizenzangabe der Grundkarte entfernt",
         lambda: {"grundkarte": _aendere(basis["grundkarte"], lambda g: g.update(_lizenz=""))}),
        ("Grundkarte auf [Breite, Laenge] gedreht",
         lambda: {"grundkarte": _gedreht(basis["grundkarte"])}),
        ("Share-alike-Hinweis aus einer Netzdatei entfernt",
         lambda: {"netz": _netz_ohne(basis["netz"], "_share_alike")}),
        ("Ein Pfad fehlt im paths-Filter des Workflows",
         lambda: {"workflows": _wf_ohne(basis["workflows"], "pruefen.yml",
                                        '      - "data/**"\n')}),
        ("force-Push in einen Datenworkflow geschmuggelt",
         lambda: {"workflows": _wf_mit(basis["workflows"], "daten-smard.yml",
                                       "git push", "git push --force")}),
        ("Pages-Anstoss aus einem Datenworkflow entfernt",
         lambda: {"workflows": _wf_ohne(basis["workflows"], "daten-smard.yml",
                                        "pages/builds")}),
        ("Netzdatei auf [Breite, Laenge] gedreht",
         lambda: {"netz": _netz_gedreht(basis["netz"])}),
    ]

    print("Negativtests -- jede Pruefung muss bei verfaelschter Eingabe anschlagen.")
    print()
    misslungen = 0
    for name, mach in faelle:
        eingabe = dict(basis)
        eingabe.update(mach())
        befund = pruefe_alles(**eingabe)
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


def _aendere(doc: dict, aenderung) -> dict:
    import copy
    k = copy.deepcopy(doc)
    aenderung(k)
    return k


def _wf_ohne(workflows: dict, name: str, text: str) -> dict:
    k = dict(workflows)
    k[name] = k[name].replace(text, "")
    return k


def _wf_mit(workflows: dict, name: str, alt: str, neu: str) -> dict:
    k = dict(workflows)
    k[name] = k[name].replace(alt, neu, 1)
    return k


def _netz_ohne(netz: dict, feld: str) -> dict:
    import copy
    k = copy.deepcopy(netz)
    for d in k.values():
        d[feld] = ""
    return k


def _netz_gedreht(netz: dict) -> dict:
    import copy
    k = copy.deepcopy(netz)
    for name, d in k.items():
        for o in d["objekte"]:
            if "p" in o:
                o["p"] = [[q[1], q[0]] for q in o["p"]]
            elif "lon" in o:
                o["lon"], o["lat"] = o["lat"], o["lon"]
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

    befund = pruefe_alles(**dict(zip(FELDER, eingaben())))
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
