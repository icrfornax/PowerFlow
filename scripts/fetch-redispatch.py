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
HOCH = "hoch"
RUNTER = "runter"


def richtung(roh: str) -> str | None:
    """"hoch", "runter" oder None -- und ausdruecklich NICHT ueber Gleichheit.

    Am 31.08.2026 gefunden: die Quelle schreibt denselben Wert in zwei
    verschiedenen Kodierungen. Meistens "Wirkleistungseinspeisung erhöhen" mit
    richtigem ö (U+00F6), an einzelnen Saetzen aber "Wirkleistungseinspeisung
    erh¿hen" -- an der Quelle ist der Umlaut zu U+00BF zerfallen. Am
    22./23.04.2022 betraf das 3 von 104 Saetzen.

    Bis dahin stand hier ein Vergleich auf Gleichheit mit dem vollen Wortlaut.
    Die abweichend kodierten Saetze fielen dadurch aus BEIDEN Summen heraus:
    ihre Arbeit landete weder unter erhoehen_mwh noch unter reduzieren_mwh und
    fehlte damit auch in gesamt_mwh -- gezaehlt als Massnahme wurden sie
    trotzdem. Dieselbe Fehlerklasse wie das Dezimalkomma: eine Zeichenkette der
    Quelle wurde angenommen statt nachgesehen.

    Deshalb wird jetzt auf das gesucht, was den Zerfall ueberlebt. "reduzieren"
    ist reines ASCII und steht immer da; beim Gegenstueck traegt nur das "erh"
    vor dem Umlaut. Wer nichts davon findet, wird gezaehlt und nicht
    stillschweigend uebergangen.
    """
    s = (roh or "").strip().lower()
    if "reduzieren" in s:
        return RUNTER
    if s.startswith("wirkleistungseinspeisung erh"):
        return HOCH
    return None


# Dauerklassen. Die Quelle rastert auf Viertelstunden; feiner waere Schein-
# genauigkeit. Gemessen ueber 2025: Median vier Stunden, 18,4 % der Massnahmen
# hoechstens eine -- aber nur 1,4 % der Arbeit. Kurz heisst also nicht wenig
# Aufwand, sondern wenig Menge, und genau das soll man sehen koennen.
DAUERKLASSEN = ("bis 1 h", "1 bis 4 h", "4 bis 12 h", "ueber 12 h")


def dauerklasse(stunden: float) -> str:
    if stunden <= 1:
        return DAUERKLASSEN[0]
    if stunden <= 4:
        return DAUERKLASSEN[1]
    if stunden <= 12:
        return DAUERKLASSEN[2]
    return DAUERKLASSEN[3]


def zahl(roh: str) -> float:
    """Eine Zahl aus der Datei. Das Dezimaltrennzeichen ist ein KOMMA.

    Das war ein schwerer Fehler und ist am 31.08.2026 behoben worden: bis
    dahin stand hier float(s["GESAMTE_ARBEIT_MWH"]) ohne Umwandlung. Jeder
    Satz mit Nachkommastellen -- "1306,25" -- warf ValueError, wurde als
    "unvollstaendig" gezaehlt und mitsamt seiner Arbeit weggeworfen. Ueber
    2025 gerechnet waren das 4.374 von 19.257 Saetzen (22,7 %) und 5,529 von
    20,324 TWh (27,2 %). Die Seite hat monatelang zu niedrige Zahlen gezeigt.

    Ein Tausenderpunkt ist in der Quelle nicht aufgetreten. Falls er doch
    einmal kommt, wird er entfernt, bevor das Komma zum Punkt wird -- sonst
    machte "1.306,25" aus 1306,25 die Zahl 1,30625.
    """
    s = (roh or "").strip()
    if not s:
        raise ValueError("leer")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    return float(s)


def stundenblock() -> dict:
    """Ein leerer Satz Stundenzaehler fuer einen Tag.

    24 Zaehler je Merkmal, in Ortszeit. Gezaehlt wird immer dasselbe: WIE VIELE
    MASSNAHMEN liefen in dieser Stunde. Niemals Arbeit je Stunde -- die nennt
    die Quelle nicht, und sie ueber das Fenster zu verteilen waere eine
    Annahme, die bei 253 von 1.187 geprueften Saetzen nachweislich nicht
    traegt.

    Warum diese Merkmale und keine anderen:
      gesamt         -- die Grundlinie.
      hoch / runter  -- hochgefahren oder heruntergefahren.
      dauer_h        -- Summe der GESAMTdauern der laufenden Massnahmen; durch
                        ihre Anzahl geteilt ergibt das die mittlere Dauer.
      je_grund       -- WARUM. Im Wortlaut der Quelle; gruppiert wird erst in
                        der Anzeige.
      je_uenb        -- WER angewiesen hat; das ist zugleich die Regelzone und
                        damit die einzige belegbare Antwort auf das WO.
      je_energieart  -- WAS fuer eine Anlage betroffen war.

    Nicht dabei und auch nicht nachtragbar: eine Stufe oder Prioritaet (die
    Quelle hat kein solches Feld) und der Ort der betroffenen Anlage (das Feld
    BETROFFENE_ANLAGE ist eine Bezeichnung ohne Koordinate; 76,9 % der Arbeit
    liessen sich nicht zuordnen -- siehe docs/beleg-redispatch.md).
    """
    return {
        "gesamt": [0] * 24,
        "hoch": [0] * 24,
        "runter": [0] * 24,
        "dauer_h": [0.0] * 24,
        "je_grund": {},
        "je_uenb": {},
        "je_energieart": {},
    }


def reihe(karte: dict, schluessel: str) -> list:
    """Die 24er-Reihe zu einem Schluessel, bei Bedarf angelegt.

    Duenn besetzt: nur was an diesem Tag vorkam, steht in der Datei. Alle
    vierzehn Gruende mal 24 Nullen je Tag waeren das Vielfache der Nutzlast.
    """
    return karte.setdefault(schluessel, [0] * 24)


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
    # Tag -> Stundenblock. Getrennt gefuehrt, weil eine Massnahme in Stunden
    # laufen kann, die auf einem anderen Tag liegen als ihr Beginn.
    stunden_je_tag: dict[str, dict] = collections.defaultdict(stundenblock)
    ueber_mitternacht = 0.0
    unvollstaendig = 0
    # Zaehler statt stillschweigendem Uebergehen -- beide sind neu, beide
    # standen vorher als blosses "wenn es passt" im Code.
    ohne_richtung = 0
    ohne_richtung_mwh = 0.0
    fremder_uenb: collections.Counter = collections.Counter()
    for s in saetze:
        try:
            a = stempel(s["BEGINN_DATUM"], s["BEGINN_UHRZEIT"], s["ZEITZONE_VON"])
            b = stempel(s["ENDE_DATUM"], s["ENDE_UHRZEIT"], s["ZEITZONE_BIS"])
            arbeit = zahl(s["GESAMTE_ARBEIT_MWH"])
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
            "je_grund": collections.defaultdict(float),
            "je_anfordernd": collections.defaultdict(float),
            "dauer_stunden": collections.defaultdict(float),
        })
        e["massnahmen"] += 1
        # Zu welcher Tageszeit lief die Massnahme? Gezaehlt wird, OB sie in
        # einer Stunde lief -- nicht, wie viel Arbeit auf diese Stunde entfiel.
        # Das ist bewusst so: die Quelle nennt eine Gesamtarbeit und ein
        # Fenster, nicht den Verlauf darin. Eine Arbeit je Stunde gaebe es nur
        # unter der Annahme gleichmaessiger Leistung, und genau die ist bei 253
        # von 1.187 geprueften Saetzen nachweislich falsch (siehe Kopf). Aktiv
        # oder nicht aktiv braucht dagegen keine Annahme.
        #
        # Gezaehlt wird auf dem Kalendertag, auf dem die Stunde LIEGT -- nicht
        # auf dem Tag des Beginns. Eine Massnahme von 22 bis 02 Uhr steht mit
        # ihrer Arbeit beim ersten Tag (siehe oben), im Zeitprofil aber mit
        # zwei Stunden beim zweiten. Beides ist richtig, weil es zwei
        # verschiedene Fragen sind.
        #
        # Was je Stunde mitgezaehlt wird, steht im Kopf von stundenblock().
        grund = (s.get("GRUND_DER_MASSNAHME") or "unbekannt").strip()
        anweiser = (s.get("ANWEISENDER_UENB") or "unbekannt").strip()
        art = (s.get("PRIMAERENERGIEART") or "unbekannt").strip()
        r_richtung = richtung(s.get("RICHTUNG"))
        dauer_h = (b - a).total_seconds() / 3600
        lauf = a.astimezone(TZ).replace(minute=0, second=0, microsecond=0)
        ende = b.astimezone(TZ)
        while lauf < ende:
            blk = stunden_je_tag[lauf.date().isoformat()]
            h = lauf.hour
            blk["gesamt"][h] += 1
            if r_richtung:
                blk[r_richtung][h] += 1
            blk["dauer_h"][h] += dauer_h
            reihe(blk["je_grund"], grund)[h] += 1
            reihe(blk["je_uenb"], anweiser)[h] += 1
            reihe(blk["je_energieart"], art)[h] += 1
            lauf += dt.timedelta(hours=1)
        if r_richtung == HOCH:
            e["erhoehen_mwh"] += arbeit
        elif r_richtung == RUNTER:
            e["reduzieren_mwh"] += arbeit
        else:
            ohne_richtung += 1
            ohne_richtung_mwh += arbeit
        u = (s.get("ANWEISENDER_UENB") or "").strip()
        if u in e["je_uenb"]:
            e["je_uenb"][u] += arbeit
        else:
            # Auch hier wurde bisher stillschweigend uebergangen, was nicht in
            # die Liste der vier passte. Jetzt wird es gezaehlt.
            fremder_uenb[u] += 1
        e["je_energieart"][(s.get("PRIMAERENERGIEART") or "unbekannt").strip()] += arbeit

        # --- die drei bisher ungenutzten Felder --------------------------
        # Der Grund wird ROH gespeichert, nicht schon hier gruppiert. Die
        # Gruppierung ist eine Anzeigeentscheidung und gehoert in die Seite;
        # in der Datei bleibt stehen, was die Quelle sagt.
        e["je_grund"][(s.get("GRUND_DER_MASSNAHME") or "unbekannt").strip()] += arbeit
        # Wer das Problem hatte, ist nicht immer der, der gehandelt hat.
        # Darin stehen auch auslaendische Betreiber -- RTE, APG, swissgrid.
        e["je_anfordernd"][(s.get("ANFORDERNDER_UENB") or "unbekannt").strip()] += arbeit
        # Dauer aus Beginn und Ende. Die Klassen sind grob, weil die Quelle
        # ohnehin auf Viertelstunden rastert.
        stunden = (b - a).total_seconds() / 3600
        e["dauer_stunden"][dauerklasse(stunden)] += arbeit

    gruende = collections.Counter()
    anfordernd = collections.Counter()
    for e in tage.values():
        for k in ("erhoehen_mwh", "reduzieren_mwh"):
            e[k] = round(e[k], 2)
        e["gesamt_mwh"] = round(e["erhoehen_mwh"] + e["reduzieren_mwh"], 2)
        e["je_uenb"] = {k: round(v, 2) for k, v in e["je_uenb"].items()}
        # Nur belegte Schluessel behalten -- eine Null je Tag und Grund waere
        # bei vierzehn Gruenden das Vielfache der Nutzlast.
        for feld in ("je_energieart", "je_grund", "je_anfordernd", "dauer_stunden"):
            e[feld] = {k: round(v, 2) for k, v in sorted(e[feld].items()) if v}
        gruende.update(e["je_grund"].keys())
        anfordernd.update(e["je_anfordernd"].keys())

    # Das Zeitprofil erst hier anhaengen -- vorher steht nicht fest, welche
    # Stunden noch dazukommen. Ortszeit: am Tag der Umstellung ist 02:00
    # doppelt belegt bzw. gar nicht, und das bleibt so stehen.
    for tag_s, e in tage.items():
        blk = stunden_je_tag.get(tag_s) or stundenblock()
        e["aktive_je_stunde"] = blk["gesamt"]
        e["stunden_richtung"] = {"hoch": blk["hoch"], "runter": blk["runter"]}
        # Summe der Dauern der in dieser Stunde laufenden Massnahmen. Geteilt
        # durch die Zahl der Massnahmen ergibt das ihre mittlere Gesamtdauer --
        # nicht, wie lange sie in DIESER Stunde liefen. Der Unterschied steht
        # auf der Seite.
        e["stunden_dauer_h"] = [round(x, 1) for x in blk["dauer_h"]]
        for feld in ("je_grund", "je_uenb", "je_energieart"):
            e["stunden_" + feld] = {k: v for k, v in sorted(blk[feld].items())}

    return {
        "tage": tage,
        "arbeit_ueber_mitternacht_mwh": round(ueber_mitternacht, 2),
        "unvollstaendige_saetze": unvollstaendig,
        # Was in diesem Zeitraum ueberhaupt vorkam. Steht mit in der Datei,
        # damit man die Werteliste der Quelle sieht, ohne sie abzurufen.
        "gruende": sorted(gruende),
        "anfordernde": sorted(anfordernd),
        # Was nicht eingeordnet werden konnte. Steht in der Datei, wird vom
        # Waechter geprueft und von validate.py noch einmal nachgesehen.
        "saetze_ohne_richtung": ohne_richtung,
        "arbeit_ohne_richtung_mwh": round(ohne_richtung_mwh, 2),
        "anweiser_ausserhalb_der_vier": dict(fremder_uenb),
    }


def waechter(saetze: list[dict], ergebnis: dict) -> None:
    """Bricht ab, wenn nennenswert viele Saetze verworfen wurden.

    Der Anlass ist ein eigener Fehler: das Dezimalkomma der Quelle liess
    22,7 % der Saetze durch die Ausnahmebehandlung fallen. Das Feld
    unvollstaendige_saetze stand die ganze Zeit in der Datei -- niemand hat
    hineingesehen. Ein Zaehler, den keiner prueft, ist kein Zaehler. Also
    prueft ihn jetzt das Skript selbst.
    """
    verworfen = ergebnis["unvollstaendige_saetze"]
    if not saetze:
        return
    anteil = verworfen / len(saetze) * 100
    if anteil > 1.0:
        raise SystemExit(
            f"ABBRUCH: {verworfen} von {len(saetze)} Saetzen ({anteil:.1f} %) "
            "konnten nicht gelesen werden. Ueber 1 % heisst: die Quelle hat ihr "
            "Format geaendert oder der Leser ist falsch. Erst ansehen, dann "
            "weiterbauen -- nicht die Grenze anheben.")
    # Dieselbe Regel fuer die Richtung. Sie darf gar nicht fehlen: jede
    # Massnahme faehrt hoch oder runter, ein drittes gibt es nicht. Wenn hier
    # etwas steht, hat die Quelle ihren Wortlaut geaendert.
    if ergebnis["saetze_ohne_richtung"]:
        raise SystemExit(
            f"ABBRUCH: bei {ergebnis['saetze_ohne_richtung']} von "
            f"{len(saetze)} Saetzen war die RICHTUNG nicht einzuordnen "
            f"({ergebnis['arbeit_ohne_richtung_mwh']:,.0f} MWh). Nachsehen, "
            "welchen Wortlaut die Quelle jetzt liefert -- nicht wegwerfen.")
    fremd = ergebnis["anweiser_ausserhalb_der_vier"]
    if fremd:
        raise SystemExit(
            f"ABBRUCH: unbekannter anweisender Betreiber {fremd}. Erwartet "
            f"werden {UENB}. Erst nachsehen, dann die Liste erweitern.")


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
            "arbeit_ueber_mitternacht_mwh steht. je_grund, je_anfordernd und "
            "dauer_stunden stehen ROH so da, wie die Quelle sie nennt; "
            "gruppiert wird erst in der Anzeige. Wichtig dabei: nicht jede "
            "Massnahme ist ein Eingriff im Notfall -- Probefahrten, "
            "Probestarts, Testfahrten und Funktionstests stehen unter je_grund "
            "und machten 2025 rund 4 % der Arbeit aus. aktive_je_stunde sind "
            "24 Zaehler in Ortszeit: wie viele Massnahmen liefen in dieser "
            "Stunde des Tages. Dieselbe Zaehlung noch einmal aufgegliedert in "
            "stunden_richtung (hoch/runter), stunden_je_grund, stunden_je_uenb "
            "(der anweisende Betreiber, zugleich die Regelzone) und "
            "stunden_je_energieart; stunden_dauer_h ist die Summe der "
            "GESAMTdauern der in dieser Stunde laufenden Massnahmen, geteilt "
            "durch ihre Anzahl also die mittlere Dauer. Gezaehlt wird ueberall "
            "AKTIV ODER NICHT, keine Arbeit je Stunde -- die nennt die Quelle "
            "nicht, und sie gleichmaessig ueber das Fenster zu verteilen waere "
            "eine Annahme, die nachweislich nicht traegt. Eine Massnahme wird "
            "dabei auf dem Tag gezaehlt, auf dem die Stunde liegt, nicht auf "
            "dem Tag ihres Beginns. Was die Quelle NICHT hat: eine Stufe oder "
            "Prioritaet, und einen Ort der betroffenen Anlage."
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
        waechter(saetze, e)
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
        saetze = hole_spanne(von, bis)
        e = auswerten(saetze, von, bis)
        waechter(saetze, e)
        doc = kopf(jahr)
        doc.update(e)
        pfad = ZIEL / f"{jahr}.json"
        pfad.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                        encoding="utf-8", newline="\n")
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
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"  geschrieben: data/redispatch-verzeichnis.json ({len(verzeichnis)} Jahre)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
