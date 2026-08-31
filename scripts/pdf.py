"""Ein sehr kleiner PDF-Schreiber. Nur Standardbibliothek.

WARUM SELBST GESCHRIEBEN
Die Seite kommt ohne Paketmanager aus, und jede zusaetzliche Abhaengigkeit
muss begruendet werden. Fuer ein Dokument aus Text, Linien und Tabellen
braucht es keine Bibliothek: PDF ist an dieser Stelle ein einfaches Format.
Was hier fehlt -- Bilder, Farbverlaeufe, eingebettete Schriften -- wird auch
nicht gebraucht.

WAS DAS KANN UND WAS NICHT
* Die vierzehn Standardschriften, hier Helvetica und Helvetica-Bold. Sie
  muessen nicht eingebettet werden; jeder Betrachter hat sie.
* WinAnsi-Kodierung. Damit sind Umlaute, Anfuehrungszeichen und der
  Gedankenstrich abgedeckt. Zeichen ausserhalb (etwa das Euro-Zeichen in
  manchen Betrachtern) werden ersetzt, nicht stillschweigend verschluckt --
  siehe `_winansi`.
* Automatischer Umbruch und Seitenwechsel.
* Es gibt KEINE Silbentrennung. Ein sehr langes Wort ragt heraus, statt
  zerschnitten zu werden.
"""

from __future__ import annotations

import zlib

# Zeichenbreiten der Helvetica in 1/1000 em. Nur die Zeichen, die in einem
# deutschen Text vorkommen; alles Uebrige bekommt die Breite von "n". Die
# Werte stammen aus den Metriken der Standardschrift und sind noetig, damit
# der Umbruch stimmt -- ohne sie waere jede Zeile geschaetzt.
_BREITEN = {
    " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667,
    "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
    ".": 278, "/": 278, "0": 556, "1": 556, "2": 556, "3": 556, "4": 556,
    "5": 556, "6": 556, "7": 556, "8": 556, "9": 556, ":": 278, ";": 278,
    "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
    "A": 667, "B": 667, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778,
    "H": 722, "I": 278, "J": 500, "K": 667, "L": 556, "M": 833, "N": 722,
    "O": 778, "P": 667, "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722,
    "V": 667, "W": 944, "X": 667, "Y": 667, "Z": 611,
    "[": 278, "\\": 278, "]": 278, "^": 469, "_": 556, "`": 333,
    "a": 556, "b": 556, "c": 500, "d": 556, "e": 556, "f": 278, "g": 556,
    "h": 556, "i": 222, "j": 222, "k": 500, "l": 222, "m": 833, "n": 556,
    "o": 556, "p": 556, "q": 556, "r": 333, "s": 500, "t": 278, "u": 556,
    "v": 500, "w": 722, "x": 500, "y": 500, "z": 500,
    "{": 334, "|": 260, "}": 334, "~": 584,
    "ä": 556, "ö": 556, "ü": 556, "ß": 556,
    "Ä": 667, "Ö": 778, "Ü": 722,
    "—": 1000, "–": 556, "„": 333, "“": 333,
    "·": 278, "§": 556, "°": 400, "−": 584,
}
# Helvetica-Bold ist im Mittel breiter. Faktor aus den Metriken der beiden
# Schriften gemittelt; genauer als eine gemeinsame Tabelle es waere.
_FETT_FAKTOR = 1.06

# Was WinAnsi nicht kann, wird ERSETZT und nicht verschluckt. Wer ein Zeichen
# vermisst, findet hier, wodurch es ersetzt wurde.
_ERSATZ = {
    "−": "-",     # echtes Minus
    "‑": "-",     # geschuetzter Bindestrich
    " ": " ",     # geschuetztes Leerzeichen
    " ": " ",     # schmales Leerzeichen
    " ": " ",
}


def _winansi(text: str) -> bytes:
    for a, b in _ERSATZ.items():
        text = text.replace(a, b)
    return text.encode("cp1252", errors="replace")


def _pdftext(text: str) -> bytes:
    """Eine Zeichenkette fuer die Metadaten (Titel, Autor).

    ACHTUNG, hier liegt eine Falle, in die ich beim ersten Anlauf getreten bin:
    fuer den SEITENINHALT gilt WinAnsi, fuer TEXTSTRINGS im Dokument aber
    PDFDocEncoding -- und die beiden unterscheiden sich genau im Bereich 0x80
    bis 0x9F. Der Gedankenstrich ist dort 0x97 und wurde im Fenstertitel als
    "Š" angezeigt: aus "PowerFlow — Methodik" wurde "PowerFlow Š Methodik".

    Der sichere Weg ist UTF-16BE mit Byte-Order-Mark, als Hexzeichenkette. Das
    versteht jeder Betrachter, und es gibt nichts zu maskieren.
    """
    if all(ord(z) < 128 for z in text):
        roh = (text.encode("ascii").replace(b"\\", b"\\\\")
               .replace(b"(", b"\\(").replace(b")", b"\\)"))
        return b"(" + roh + b")"
    return b"<" + (b"\xfe\xff" + text.encode("utf-16-be")).hex().encode() + b">"


def breite(text: str, groesse: float, fett: bool = False) -> float:
    """Breite einer Zeichenkette in Punkt."""
    summe = sum(_BREITEN.get(z, 556) for z in text)
    return summe / 1000.0 * groesse * (_FETT_FAKTOR if fett else 1.0)


def umbrechen(text: str, groesse: float, maxbreite: float, fett: bool = False):
    """Text auf Zeilen umbrechen. Ohne Silbentrennung -- siehe Modulkopf."""
    zeilen, laufend = [], ""
    for wort in text.split(" "):
        probe = (laufend + " " + wort).strip()
        if laufend and breite(probe, groesse, fett) > maxbreite:
            zeilen.append(laufend)
            laufend = wort
        else:
            laufend = probe
    if laufend:
        zeilen.append(laufend)
    return zeilen or [""]


class Seite:
    def __init__(self) -> None:
        self.teile: list[bytes] = []
        # (x, Breite, Text) je gesetzter Zeile -- fuer die Ueberlaufpruefung.
        self.gesetzt: list[tuple[float, float, str]] = []

    def text(self, x: float, y: float, s: str, groesse: float = 10,
             fett: bool = False, grau: float = 0.0) -> None:
        self.gesetzt.append((x, breite(s, groesse, fett), s))
        roh = _winansi(s).replace(b"\\", b"\\\\").replace(b"(", b"\\(") \
                         .replace(b")", b"\\)")
        self.teile.append(
            b"BT /" + (b"F2" if fett else b"F1") + b" "
            + f"{groesse:.2f}".encode() + b" Tf "
            + f"{grau:.3f} {grau:.3f} {grau:.3f}".encode() + b" rg "
            + f"{x:.2f} {y:.2f}".encode() + b" Td (" + roh + b") Tj ET\n")

    def linie(self, x1: float, y1: float, x2: float, y2: float,
              staerke: float = 0.5, grau: float = 0.75) -> None:
        self.teile.append(
            f"{grau:.3f} {grau:.3f} {grau:.3f} RG {staerke:.2f} w ".encode()
            + f"{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S\n".encode())

    def kasten(self, x: float, y: float, b: float, h: float,
               grau: float = 0.94) -> None:
        self.teile.append(
            f"{grau:.3f} {grau:.3f} {grau:.3f} rg ".encode()
            + f"{x:.2f} {y:.2f} {b:.2f} {h:.2f} re f\n".encode())

    def inhalt(self) -> bytes:
        return b"".join(self.teile)

    def ueberlauf(self, rand_rechts: float) -> list[str]:
        """Welche Zeile ragt ueber den Satzspiegel hinaus?

        Der Umbruch rechnet mit Zeichenbreiten; ein einzelnes zu langes Wort
        oder eine zu enge Tabellenspalte laeuft trotzdem hinaus. Auf einer
        Seitenvorschau faellt das kaum auf -- deshalb wird es gemessen und
        nicht angesehen.
        """
        return [f"{s[:52]!r} bis {x + b:.0f} pt, erlaubt {rand_rechts:.0f}"
                for x, b, s in self.gesetzt if x + b > rand_rechts + 0.5]


class Dokument:
    """DIN A4 hoch, Masse in Punkt (72 je Zoll)."""

    BREITE, HOEHE = 595.28, 841.89

    def __init__(self, titel: str, autor: str) -> None:
        self.titel, self.autor = titel, autor
        self.seiten: list[Seite] = []

    def neue_seite(self) -> Seite:
        s = Seite()
        self.seiten.append(s)
        return s

    def bytes(self) -> bytes:
        objekte: list[bytes] = []

        def obj(inhalt: bytes) -> int:
            objekte.append(inhalt)
            return len(objekte)

        schrift1 = obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
                       b"/Encoding /WinAnsiEncoding >>")
        schrift2 = obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold "
                       b"/Encoding /WinAnsiEncoding >>")
        seiten_ids: list[int] = []
        inhalt_ids: list[int] = []
        for s in self.seiten:
            roh = zlib.compress(s.inhalt())
            inhalt_ids.append(obj(
                b"<< /Length " + str(len(roh)).encode()
                + b" /Filter /FlateDecode >>\nstream\n" + roh + b"\nendstream"))
        eltern = len(objekte) + len(self.seiten) + 1
        for i, _ in enumerate(self.seiten):
            seiten_ids.append(obj(
                b"<< /Type /Page /Parent " + str(eltern).encode() + b" 0 R "
                + f"/MediaBox [0 0 {self.BREITE:.2f} {self.HOEHE:.2f}] ".encode()
                + b"/Resources << /Font << /F1 " + str(schrift1).encode()
                + b" 0 R /F2 " + str(schrift2).encode() + b" 0 R >> >> "
                + b"/Contents " + str(inhalt_ids[i]).encode() + b" 0 R >>"))
        baum = obj(b"<< /Type /Pages /Kids ["
                   + b" ".join(str(i).encode() + b" 0 R" for i in seiten_ids)
                   + b"] /Count " + str(len(seiten_ids)).encode() + b" >>")
        assert baum == eltern, (baum, eltern)
        info = obj(b"<< /Title " + _pdftext(self.titel) + b" /Author "
                   + _pdftext(self.autor) + b" /Producer "
                   b"(PowerFlow, scripts/pdf.py) >>")
        wurzel = obj(b"<< /Type /Catalog /Pages " + str(baum).encode() + b" 0 R >>")

        aus = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        stellen = [0]
        for i, o in enumerate(objekte, start=1):
            stellen.append(len(aus))
            aus += str(i).encode() + b" 0 obj\n" + o + b"\nendobj\n"
        xref = len(aus)
        aus += b"xref\n0 " + str(len(objekte) + 1).encode() + b"\n"
        aus += b"0000000000 65535 f \n"
        for st in stellen[1:]:
            aus += f"{st:010d} 00000 n \n".encode()
        aus += (b"trailer\n<< /Size " + str(len(objekte) + 1).encode()
                + b" /Root " + str(wurzel).encode() + b" 0 R /Info "
                + str(info).encode() + b" 0 R >>\nstartxref\n"
                + str(xref).encode() + b"\n%%EOF\n")
        return bytes(aus)
