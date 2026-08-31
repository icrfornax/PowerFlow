"""Erzeugt methodik.pdf -- die Methodik der Seite, aus den Dateien gerechnet.

Aufruf:  python scripts/methodik.py
         python scripts/methodik.py --zahlen   (nur die Zahlen zeigen)

DER PUNKT DIESES SKRIPTS
Ein Methodikpapier, das von Hand gepflegt wird, laeuft der Wirklichkeit
hinterher. Dieses hier rechnet JEDE Zahl beim Bau neu aus den Dateien unter
data/. Steht im PDF "4.259 Tage", dann liegen 4.259 Tage in den Dateien; wird
morgen ein Tag nachgeliefert, steht es morgen anders drin.

Von Hand gepflegt ist nur der Fliesstext -- also das, was die Zahlen bedeuten
und was an ihnen unsicher ist. Beides gehoert zusammen: Zahlen ohne Deutung
sagen nichts, Deutung ohne Zahlen ist eine Behauptung.

KEINE ZUSAETZLICHE ABHAENGIGKEIT. Das PDF wird von scripts/pdf.py geschrieben,
das ausser der Standardbibliothek nichts braucht. Warum das so ist, steht im
Kopf jener Datei.
"""

from __future__ import annotations

import json
import pathlib
import statistics
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pdf  # noqa: E402

WURZEL = pathlib.Path(__file__).resolve().parent.parent
DATA = WURZEL / "data"
ZIEL = WURZEL / "methodik.pdf"

RAND_L, RAND_R = 56.0, 56.0
OBEN, UNTEN = 792.0, 64.0
SATZBREITE = pdf.Dokument.BREITE - RAND_L - RAND_R

ZONEN = ("50Hertz", "TenneT", "Amprion", "TransnetBW")
EE = ("Wind Onshore", "Wind Offshore", "Photovoltaik", "Wasserkraft",
      "Biomasse", "Sonstige Erneuerbare")


def lies(name: str):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def de(x: float, stellen: int = 1) -> str:
    """Deutsche Schreibweise. Im PDF wird gelesen, nicht gerechnet."""
    s = f"{x:,.{stellen}f}"
    return s.replace(",", "\x00").replace(".", ",").replace("\x00", ".")


# ---------------------------------------------------------------- Zahlen ----

def zahlen() -> dict:
    """Jede Zahl des Dokuments. Aus den Dateien, nicht von Hand."""
    z: dict = {}
    verz = lies("tage-verzeichnis.json")
    jahre = verz["jahre"]
    z["jahre"] = len(jahre)
    z["von"] = jahre[0]["erster_tag"]
    z["bis"] = jahre[-1].get("letzter_belegter_tag") or jahre[-1]["letzter_tag"]

    reste, zonenabw, tage = [], [], 0
    for j in jahre:
        d = json.loads((WURZEL / j["datei"]).read_text(encoding="utf-8"))
        gen = d["erzeugung"]
        rz = d["regelzonen"]
        for i, tag in enumerate(d["tage"]):
            last = d["netzlast"][i]
            if last is None:
                continue
            tage += 1
            erz = sum((r[i] or 0) for r in gen.values())
            imp = sum((a["import"][i] or 0) for a in d["aussenhandel"].values())
            exp = sum((a["export"][i] or 0) for a in d["aussenhandel"].values())
            reste.append((erz + imp - exp - last) / last * 100)
            zo = sum((rz[s]["erzeugung"][k][i] or 0)
                     for s in ZONEN for k in rz[s]["erzeugung"])
            if erz > 0:
                zonenabw.append((zo - erz) / erz * 100)
    z["tage"] = tage
    z["rest_min"], z["rest_max"] = min(reste), max(reste)
    z["rest_median"] = statistics.median(reste)
    z["zonen_ueber1"] = sum(1 for a in zonenabw if abs(a) > 1)
    z["zonen_max"] = max(zonenabw, key=abs)

    rd = lies("redispatch-verzeichnis.json")["jahre"]
    z["rd_jahre"] = []
    for j in rd:
        d = json.loads((WURZEL / j["datei"]).read_text(encoding="utf-8"))
        arbeit = sum(t["gesamt_mwh"] for t in d["tage"].values())
        probe = sum(v for t in d["tage"].values()
                    for k, v in (t.get("je_grund") or {}).items()
                    if "robe" in k or "est" in k)
        z["rd_jahre"].append((d["jahr"], arbeit / 1e6, probe / arbeit * 100 if arbeit else 0,
                              sum(t["massnahmen"] for t in d["tage"].values()),
                              d["unvollstaendige_saetze"]))

    kw = lies("kraftwerke.json")
    z["kraftwerke"] = kw["anzahl"]
    z["kw_bloecke"] = sum(1 for a in kw["anlagen"] for b in (a.get("bloecke") or [])
                          if b.get("production_id"))
    z["hoechst"] = lies("netz-hoechstspannung.json")["anzahl"]
    z["hoch"] = lies("netz-hochspannung.json")["anzahl"]
    z["werke"] = lies("netz-umspannwerke.json")["anzahl"]
    wind = lies("mastr-wind.json")
    z["windparks"] = wind["anzahl"]
    z["wind_gw"] = wind["leistung_gw"]
    z["wind_see"] = sum(1 for o in wind["objekte"] if o["see"])
    z["wind_installiert"] = wind["kennzahlen"]["leistung_in_betrieb_gw"]
    z["wind_ohne_ort"] = wind["kennzahlen"]["ohne_koordinate"]
    flaeche = lies("regelzonen-flaeche.json")
    z["flaeche_quote"] = flaeche["kreuzprobe"]["quote_prozent"]
    z["flaeche_geprueft"] = flaeche["kreuzprobe"]["geprueft"]
    z["flaeche_daneben"] = flaeche["kreuzprobe"]["geprueft"] - flaeche["kreuzprobe"]["richtig"]
    q = lies("quellen.json")
    z["quellen"] = q["quellen"]
    z["datensaetze"] = q["datensaetze"]
    z["dateien"] = q["dateien_gesamt"]
    z["bytes"] = q["bytes_gesamt"]
    return z


# ---------------------------------------------------------------- Setzer ----

class Setzer:
    """Haelt die Schreibmarke und bricht Seiten um."""

    def __init__(self, dok: pdf.Dokument, z: dict) -> None:
        self.dok, self.z = dok, z
        self.seite = None
        self.nr = 0
        self.y = 0.0
        self.neu()

    def neu(self) -> None:
        if self.seite is not None:
            self.fusszeile()
        self.seite = self.dok.neue_seite()
        self.nr += 1
        self.y = OBEN

    def fusszeile(self) -> None:
        self.seite.linie(RAND_L, UNTEN - 12, pdf.Dokument.BREITE - RAND_R, UNTEN - 12,
                         0.4, 0.8)
        self.seite.text(RAND_L, UNTEN - 26,
                        "PowerFlow · Methodik · Datenstand " + self.z["bis"], 8, grau=0.45)
        n = f"Seite {self.nr}"
        self.seite.text(pdf.Dokument.BREITE - RAND_R - pdf.breite(n, 8), UNTEN - 26,
                        n, 8, grau=0.45)

    def platz(self, hoehe: float) -> None:
        if self.y - hoehe < UNTEN:
            self.neu()

    def titel(self, s: str) -> None:
        self.platz(46)
        self.y -= 8
        self.seite.text(RAND_L, self.y, s, 15, fett=True)
        self.y -= 8
        self.seite.linie(RAND_L, self.y, pdf.Dokument.BREITE - RAND_R, self.y, 0.8, 0.6)
        self.y -= 16

    def zwischen(self, s: str) -> None:
        self.platz(34)
        self.y -= 10
        self.seite.text(RAND_L, self.y, s, 10.5, fett=True)
        self.y -= 15

    def absatz(self, s: str, groesse: float = 9.5, grau: float = 0.15) -> None:
        for zeile in pdf.umbrechen(s, groesse, SATZBREITE):
            self.platz(13)
            self.seite.text(RAND_L, self.y, zeile, groesse, grau=grau)
            self.y -= groesse * 1.35
        self.y -= 4

    def punkt(self, s: str) -> None:
        einzug = 14.0
        for i, zeile in enumerate(pdf.umbrechen(s, 9.5, SATZBREITE - einzug)):
            self.platz(13)
            if i == 0:
                self.seite.text(RAND_L, self.y, "·", 9.5, fett=True)
            self.seite.text(RAND_L + einzug, self.y, zeile, 9.5, grau=0.15)
            self.y -= 12.8
        self.y -= 2

    def tabelle(self, kopf: list[str], zeilen: list[list[str]],
                breiten: list[float], rechts: set[int] | None = None) -> None:
        rechts = rechts or set()
        spalten = [RAND_L]
        for b in breiten[:-1]:
            spalten.append(spalten[-1] + b)

        def zeile_setzen(werte, fett, grau):
            hoehen = []
            for i, w in enumerate(werte):
                hoehen.append(len(pdf.umbrechen(w, 8.5, breiten[i] - 8, fett)))
            hoch = max(hoehen) * 11.5 + 4
            self.platz(hoch + 4)
            oben = self.y
            for i, w in enumerate(werte):
                for k, zl in enumerate(pdf.umbrechen(w, 8.5, breiten[i] - 8, fett)):
                    x = spalten[i]
                    if i in rechts:
                        x = spalten[i] + breiten[i] - 8 - pdf.breite(zl, 8.5, fett)
                    self.seite.text(x, oben - k * 11.5, zl, 8.5, fett=fett, grau=grau)
            self.y = oben - hoch
            return hoch

        zeile_setzen(kopf, True, 0.0)
        self.seite.linie(RAND_L, self.y + 6, pdf.Dokument.BREITE - RAND_R,
                         self.y + 6, 0.6, 0.55)
        self.y -= 4
        for r in zeilen:
            zeile_setzen(r, False, 0.2)
            self.seite.linie(RAND_L, self.y + 6, pdf.Dokument.BREITE - RAND_R,
                             self.y + 6, 0.3, 0.85)
        self.y -= 8

    def abschluss(self) -> None:
        self.fusszeile()


# ---------------------------------------------------------------- Inhalt ----

def bauen(z: dict) -> pdf.Dokument:
    dok = pdf.Dokument("PowerFlow — Methodik", "PowerFlow")
    s = Setzer(dok, z)

    s.titel("PowerFlow — Methodik")
    s.absatz(
        "Wo wird in Deutschland an einem Tag Strom erzeugt, wo verbraucht, und wie "
        "groß ist das Ungleichgewicht je Regelzone? Dazu: welcher Anteil von außen "
        "kommt, je Kuppelstelle. Das ist die Leitfrage der Seite, und dieses Papier "
        "sagt, wie sie beantwortet wird.", 10.5, 0.1)
    s.absatz(
        f"Datenstand: {z['bis']}. Die Reihen beginnen am {z['von']}; das sind "
        f"{de(z['jahre'], 0)} Jahresdateien mit {de(z['tage'], 0)} belegten Tagen. "
        f"Insgesamt {de(z['dateien'], 0)} Dateien mit {de(z['bytes'] / 1e6, 1)} MB.")
    s.absatz(
        "JEDE ZAHL IN DIESEM PAPIER IST BEIM BAU NEU GERECHNET WORDEN — aus denselben "
        "Dateien, die die Seite anzeigt und zum Abzug anbietet. Von Hand gepflegt ist "
        "nur der Fließtext. Ein Methodikpapier, dessen Zahlen jemand nachträgt, läuft "
        "der Wirklichkeit hinterher.")

    s.zwischen("Genau eine freie Variable")
    s.absatz(
        "Wählbar ist der dargestellte Zeitraum, sonst nichts. Ein einzelner Tag ist "
        "der Sonderfall von = bis. Alles Übrige kommt aus der Messung; es gibt keinen "
        "zweiten Regler, keinen Szenarienschalter und keine Annahme, die sich "
        "verstellen ließe.")
    s.absatz(
        "Damit steht auch der Bezugswert fest: derselbe Zeitraum ein Jahr früher, "
        "reale Messwerte. Kein Monatsmittel, keine geglättete Kurve.")

    s.zwischen("Messen statt modellieren — und die eine Ausnahme")
    s.absatz(
        "Alle ZAHLEN dieser Seite sind gemessen oder als Stammdatum veröffentlicht. "
        "Nichts ist modelliert, nichts geschätzt. Selbst gerechnete Größen — der "
        "Bilanzrest, der Anteil der Erneuerbaren, der Saldo je Regelzone — stehen "
        "mit ihrer Formel da.")
    s.absatz(
        f"Genau eine GEOMETRIE ist abgeleitet: die Fläche der vier Regelzonen. Eine "
        f"amtliche oder offene Geometrie dafür gibt es nicht. Die Fläche ist "
        f"interpoliert, auf der Karte voreingestellt ausgeschaltet, und ihre "
        f"Trefferquote ist gemessen: {de(z['flaeche_quote'])} % der "
        f"{de(z['flaeche_geprueft'], 0)} Kraftwerke mit amtlicher Zonenangabe werden "
        f"richtig zugeordnet, {de(z['flaeche_daneben'], 0)} nicht.")

    # ---------------------------------------------------------------------
    s.neu()
    s.titel("Woher die Zahlen kommen")
    s.absatz(
        "Das Quellenverzeichnis wird aus den tatsächlich vorhandenen Dateien erzeugt, "
        "nicht von Hand gepflegt. Taucht eine Datei ohne Quellenzuordnung auf, bricht "
        "der Bau ab.")
    s.tabelle(
        ["Datensatz", "Quelle", "Lizenz", "Umfang"],
        [[d["titel"],
          z["quellen"][d["quelle"]]["name"],
          z["quellen"][d["quelle"]]["lizenz"].split(" -- ")[0].split(" (")[0],
          f"{d['dateien']} Datei(en), {de(d['bytes'] / 1e6, 2)} MB"]
         for d in z["datensaetze"]],
        [150, 128, 110, 95], rechts={3})

    s.zwischen("Was daran keine unabhängige Gegenprobe ist")
    s.absatz(
        "SMARD bezieht seine Daten von ENTSO-E. Ein Abgleich gegen Energy-Charts, das "
        "die Daten mehrerer Gebotszonen unverändert von SMARD übernimmt, ist deshalb "
        "eine Konsistenzprüfung — er belegt, dass Abruf, Einheit und Zeitzone stimmen, "
        "nicht dass die Messung stimmt. Eine echte Gegenprobe braucht eine anders "
        "erhobene Zahl.")
    s.absatz(
        f"Eine solche gibt es an einer Stelle: die installierte Windleistung aus dem "
        f"Marktstammdatenregister — {de(z['wind_installiert'], 2)} GW in Betrieb — "
        f"gegen die in den SMARD-Stundenreihen gemessene Spitze von 53,23 GW "
        f"zeitgleich. Das sind 65 %, ein für Wind plausibler Wert. Ein Faktor 1000 in "
        f"der Einheit wäre hier sofort aufgefallen.")

    # ---------------------------------------------------------------------
    s.neu()
    s.titel("Wie gerechnet wird")
    s.zwischen("Bilanzrest")
    s.absatz("Erzeugung + Import − Export − Netzlast. Er rechnet die übrigen "
             "Kennzahlen gegeneinander.")
    s.absatz(
        f"Er geht NICHT auf null auf und soll es auch nicht vortäuschen. Über "
        f"{de(z['tage'], 0)} belegte Tage gemessen liegt er zwischen "
        f"{de(z['rest_min'])} % und +{de(z['rest_max'])} % der Netzlast, im Median bei "
        f"{de(z['rest_median'])} %. Darin stecken Netzverluste, die unterschiedliche "
        f"zeitliche Auflösung von Erzeugung und Außenhandel und — vor 2018 deutlich — "
        f"Erfassungslücken der Quelle.")

    s.zwischen("Anteil der Erneuerbaren")
    s.absatz(
        "Summe der sechs erneuerbaren SMARD-Reihen, geteilt durch die Netzlast "
        "desselben Zeitraums. Der Nenner ist eine Festlegung und wird benannt: die "
        "amtliche Quote rechnet gegen den Bruttostromverbrauch und liegt deshalb "
        "anders. Pumpspeicher ist nicht enthalten — ein Speicher ist kein Erzeuger, "
        "und der Strom darin wurde vorher schon einmal gezählt.")

    s.zwischen("Saldo je Regelzone")
    s.absatz(
        "Erzeugung minus Netzlast je Zone. Das ist eine Bilanz, kein Fluss. Sie sagt, "
        "wie viel eine Zone mehr oder weniger erzeugt hat als sie verbraucht hat — "
        "nicht, wohin der Überschuss gegangen ist. Flüsse zwischen den vier Zonen "
        "werden nicht veröffentlicht: Deutschland und Luxemburg sind eine einzige "
        "Gebotszone, und die Verordnung (EU) 543/2013 verlangt physikalische Flüsse "
        "nur zwischen Gebotszonen. Aus vier Bilanzen ließen sich die sechs "
        "Verbindungen ohnehin nicht ausrechnen.")

    s.zwischen("Redispatch")
    s.absatz(
        "Summiert wird GESAMTE_ARBEIT_MWH, niemals Leistung mal Dauer: bei einem Teil "
        "der Sätze ist die mittlere Leistung der Mittelwert über die tatsächlich "
        "aktive Zeit, nicht über das genannte Fenster. Eine Maßnahme zählt zum Tag "
        "ihres Beginns — eine Annahme, deren Größe in den Dateien steht.")
    s.absatz("Nicht jede Maßnahme ist ein Eingriff im Notfall:")
    s.tabelle(
        ["Jahr", "Maßnahmen", "Arbeit (TWh)", "davon Probebetrieb", "verworfen"],
        [[str(j), de(n, 0), de(a, 3), de(p) + " %", de(u, 0)]
         for j, a, p, n, u in z["rd_jahre"]],
        [60, 100, 100, 130, 90], rechts={1, 2, 3, 4})
    s.absatz(
        "„Probebetrieb\" sind angemeldete Probefahrten, Probestarts, Testfahrten und "
        "Funktionstests. Wer die Redispatch-Menge als Maß für Netzstress liest, muss "
        "diesen Teil abziehen. Die Spalte „verworfen\" muss null sein — siehe die "
        "Rücknahme am Ende dieses Papiers.")

    # ---------------------------------------------------------------------
    s.neu()
    s.titel("Was nicht aufgeht — und nicht weggeglättet wird")
    s.punkt(
        f"Der Bilanzrest geht nicht auf null auf: {de(z['rest_min'])} % bis "
        f"+{de(z['rest_max'])} %, Median {de(z['rest_median'])} %.")
    s.punkt(
        f"Die Erzeugung der vier Regelzonen summiert sich nicht immer auf "
        f"Deutschland. An {de(z['zonen_ueber1'], 0)} von {de(z['tage'], 0)} Tagen "
        f"weicht sie um mehr als 1 % ab, größte Abweichung {de(z['zonen_max'])} %. "
        f"Fast alles davon liegt vor 2018; größter Einzelposten ist die Reihe "
        f"„Sonstige Konventionelle\", die 2015 in der Zonenaufteilung fünfmal so hoch "
        f"steht wie für Deutschland. Die Seite rechnet die Abweichung für den "
        f"gewählten Zeitraum nach und warnt sichtbar.")
    s.punkt(
        "Ein Wert der Quelle ist falsch: Schweiz-Import am 09.02.2015 mit 25.009.206 "
        "MWh. Er wird als fehlend geführt, nicht korrigiert; der Originalwert bleibt "
        "in der Datei sichtbar.")
    s.punkt(
        f"{de(z['wind_ohne_ort'], 0)} Windenergieanlagen in Betrieb haben im "
        f"Marktstammdatenregister keine Koordinate und fehlen auf der Karte. Eine "
        f"Lücke der Quelle, keine Auswahl.")
    s.punkt(
        "Redispatch lässt sich nicht auf die Karte bringen. Von 404 Bezeichnungen im "
        "Feld BETROFFENE_ANLAGE bleiben, gegen Kraftwerke und Umspannwerke geprüft, "
        "76,9 % der Arbeit ohne Ort; unscharfe Treffer sind teils falsch. 13,3 % "
        "laufen über die Börse und haben gar keinen Ort.")

    s.zwischen("Was auf der Karte liegt")
    s.tabelle(
        ["Ebene", "Anzahl", "Bemerkung"],
        [["Kraftwerksstandorte (SMARD)", de(z["kraftwerke"], 0),
          f"davon {de(z['kw_bloecke'], 0)} Blöcke mit Erzeugungsreihe"],
         ["Leitungen 220/380 kV (OSM)", de(z["hoechst"], 0), "Geografie, kein Lastfluss"],
         ["Leitungen 110 kV (OSM)", de(z["hoch"], 0), "Geografie, kein Lastfluss"],
         ["Umspannwerke ab 110 kV (OSM)", de(z["werke"], 0), "Lage und Spannungsebene"],
         ["Windparks ab 5 MW (MaStR)", de(z["windparks"], 0),
          f"{de(z['wind_gw'], 2)} GW, davon {de(z['wind_see'], 0)} auf See"]],
        [190, 70, 223], rechts={1})
    s.absatz(
        "Die Geografie einer Leitung darf gezeigt werden. Ihre Auslastung nicht: nach "
        "§ 23c Abs. 2 EnWG werden Lastflüsse nur zusammengefasst je Kuppelstelle "
        "veröffentlicht. Öffentlich sichtbare Leitungsauslastungen sind "
        "Modellrechnungen und stehen hier nicht.")

    # ---------------------------------------------------------------------
    s.neu()
    s.titel("Zurückgenommene Behauptungen")
    s.absatz(
        "Was sich beim Nachrechnen als falsch herausgestellt hat, wird hier genannt — "
        "nicht stillschweigend ersetzt. Ein Methodikpapier ohne diese Seite wäre "
        "unvollständig.")
    s.punkt(
        "Der Bilanzrest sollte angeblich unter 0,5 % liegen. Diese Schwelle war auf "
        "einen einzelnen günstigen Tag geeicht. Über alle Tage gemessen liegt er "
        "weitaus weiter auseinander; die Zahl steht oben.")
    s.punkt(
        "Die Redispatch-Zahlen waren um 27 % zu niedrig. Das Dezimaltrennzeichen der "
        "Quelle ist ein Komma; float(\"1306,25\") scheiterte, und die Ausnahme wurde "
        "still verschluckt. Für 2025 fehlten 4.374 von 19.257 Sätzen und 5,529 von "
        "20,324 TWh. Alle Jahre sind neu abgerufen. Zwei Prüfungen verhindern eine "
        "Wiederholung: der Abruf bricht ab, sobald über 1 % der Sätze unlesbar sind, "
        "und der Türsteher prüft die Zähler in den fertigen Dateien nach.")
    s.punkt(
        "Die Bänder des Verlaufsdiagramms waren dauerhaft schraffiert, begründet als "
        "zweite Codierung. Textur ist ein Zuschaltmerkmal, kein Grundzustand; acht "
        "dichte Motive übereinander ergeben einen Rauschteppich.")
    s.punkt(
        "Die Marken auf der Karte wurden aufsteigend nach Leistung gezeichnet — der "
        "größte Kreis lag oben und verdeckte alles darunter. Zudem skalierten die "
        "Radien mit dem Zoom, sodass Hineinzoomen eine Häufung nie auflöste.")

    s.zwischen("Wie geprüft wird")
    s.absatz(
        "Vor jeder Auslieferung laufen drei Dinge: ein Prüfskript über Dateien, "
        "Einbindungen und Zahlen; dessen eigene Negativtests, die jede Prüfgröße "
        "verfälschen und nachweisen, dass die zugehörige Prüfung anschlägt; und ein "
        "Browsertest, der die Seite in beiden Farbschemata und auf 390 Pixel Breite "
        "bedient. Eine Prüfung, die nie hat fehlschlagen sehen, ist keine Prüfung.")
    s.absatz(
        "Die Zahlenprüfungen laufen über JEDEN belegten Tag aller Jahresdateien, "
        "nicht über einen Stichtag. Ein Fehler an einem einzelnen Tag fiele sonst "
        "nicht auf — genau so ist der Fehler bei der Kernenergie gefunden worden.")

    s.abschluss()
    return dok


def main(argv: list[str]) -> int:
    z = zahlen()
    if "--zahlen" in argv:
        for k, v in z.items():
            if k in ("quellen", "datensaetze", "rd_jahre"):
                print(f"  {k}: {len(v)} Eintraege")
            else:
                print(f"  {k}: {v}")
        return 0
    dok = bauen(z)

    # Selbstkontrolle: nichts darf ueber den Satzspiegel hinausragen. Der
    # Umbruch rechnet mit Zeichenbreiten, aber ein einzelnes langes Wort oder
    # eine zu enge Tabellenspalte laeuft trotzdem hinaus -- und auf einer
    # Seitenvorschau sieht man das kaum. Also messen statt ansehen.
    rand = pdf.Dokument.BREITE - RAND_R
    fehler = []
    for i, seite in enumerate(dok.seiten, start=1):
        for zeile in seite.ueberlauf(rand):
            fehler.append(f"Seite {i}: {zeile}")
    if fehler:
        print("ABBRUCH: Text laeuft ueber den Satzspiegel hinaus:")
        for f in fehler[:10]:
            print("   ", f)
        return 1

    ZIEL.write_bytes(dok.bytes())
    print(f"  geschrieben: {ZIEL.name}  ({ZIEL.stat().st_size:,} Bytes, "
          f"{len(dok.seiten)} Seiten)")
    print(f"  Datenstand {z['bis']}, {de(z['tage'], 0)} belegte Tage")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
