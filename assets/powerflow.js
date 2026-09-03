/* PowerFlow -- Stromfluss-Labor.
 *
 * Ein einziges Modul als IIFE. Es erzeugt sein Markup selbst und haengt es
 * VOR dem Anker #powerflow-anker in der index.html ein. Keine globalen
 * Bindungen: alles liegt im Funktionsraum der IIFE, kein Top-Level-const,
 * das mit einem anderen Skript derselben Seite kollidieren koennte.
 *
 * Freie Variable ist der KALENDERTAG. Genau ein Regler, sonst keiner.
 * Alles Uebrige ist gemessen und traegt den Hinweis, dass es keinen Regler hat.
 *
 * Bezugswert ist der REALE Wert desselben Kalendertags im Vorjahr -- kein
 * Monatsmittel, keine geglaettete Kurve.
 *
 * Kein localStorage. Aller Zustand kommt aus den Dateien unter data/.
 * Datum wird immer lokal formatiert, nie ueber toISOString().
 */
(function () {
  "use strict";

  var ANKER = "powerflow-anker";
  /* Cache-Buster fuer alle Datendateien. Er wird aus dem EIGENEN Skriptpfad
     gelesen, nicht daneben gepflegt: eine zweite Stelle laeuft irgendwann
     auseinander, und genau das war passiert -- die index.html stand auf
     20260831-mastr, diese Konstante noch auf 20260831-quellen. Nach einem
     Deploy haette der Browser alte Datendateien ausliefern koennen, waehrend
     Seite und Stylesheet neu waren.

     document.currentScript ist beim Ausfuehren eines klassischen Skripts
     gesetzt. Fehlt es wider Erwarten, bleibt der Wert leer und die Dateien
     werden ohne Anhang geholt -- das ist schlechter als ein Buster, aber
     besser als ein falscher. */
  var VERSION = (function () {
    var s = document.currentScript && document.currentScript.src;
    var m = s && s.match(/[?&]v=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  })();

  // ---- Formatierung -------------------------------------------------------
  // Anzeige deutsch. Die Exporte benutzen bewusst den Punkt als
  // Dezimaltrennzeichen; der Unterschied ist im Dateikopf erklaert.
  var nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function gwh(mwh, stellen) {
    if (mwh === null || mwh === undefined) { return "—"; }
    return (stellen === 2 ? nf2 : stellen === 0 ? nf0 : nf1).format(mwh / 1000);
  }
  function vz(x, stellen) {
    if (x === null || x === undefined) { return "—"; }
    return (x >= 0 ? "+" : "−") + gwh(Math.abs(x), stellen);
  }
  function prozent(neu, alt) {
    if (neu === null || alt === null || !alt) { return null; }
    return (neu - alt) / alt * 100;
  }

  // Lokale Datumsarbeit. toISOString() waere hier falsch: es rechnet nach UTC
  // und verschiebt in Europa jeden Tag um eins.
  function ausIso(iso) {
    var t = iso.split("-");
    return new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]));
  }
  // Fuehrende Null. Gebraucht fuer Datumsteile und fuer Uhrzeiten.
  function zwei(n) { return (n < 10 ? "0" : "") + n; }
  function nachIso(d) {
    return d.getFullYear() + "-" + zwei(d.getMonth() + 1) + "-" + zwei(d.getDate());
  }
  // Kurzform fuer Aufzaehlungen: 30.08.2026. Wie ueberall lokal gebildet, nie
  // ueber toISOString().
  function datumKurz(iso) {
    return ausIso(iso).toLocaleDateString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric"
    });
  }
  function datumLang(iso) {
    return ausIso(iso).toLocaleDateString("de-DE", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
  }
  function verschoben(iso, tage) {
    var d = ausIso(iso);
    d.setDate(d.getDate() + tage);
    return nachIso(d);
  }
  function el(tag, attrs, kinder) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "text") { n.textContent = attrs[k]; }
        else if (k === "html") { n.innerHTML = attrs[k]; }
        else { n.setAttribute(k, attrs[k]); }
      });
    }
    (kinder || []).forEach(function (k) { if (k) { n.appendChild(k); } });
    return n;
  }

  // ---- Zustand ------------------------------------------------------------

  var Z = {
    verzeichnis: null,
    grundkarte: null,
    kraftwerke: null,
    jahre: {},          // Jahr -> geladene Jahresdatei mit Tageswerten
    verlauf: {},
    redispatch: {},
    rdVerzeichnis: null,
    quellen: null,        // Monat -> geladene Monatsdatei mit Stundenwerten
    von: null,          // erster Tag des Zeitraums
    bis: null,          // letzter Tag des Zeitraums, einschliesslich
    startVon: null,     // fuer den Zuruecksetzen-Knopf
    startBis: null,
    minTag: null,
    maxTag: null,
    wurzel: null,
    // Netzgeometrie aus OpenStreetMap, ODbL. Wird erst geladen, wenn die
    // zugehoerige Ebene eingeschaltet wird -- die 110-kV-Ebene allein ist
    // 5,9 MB gross.
    netz: {},
    // Zoomzustand und Auswahl der Karte. Beides ueberlebt einen Wechsel des
    // Zeitraums.
    karte: { sicht: null, auswahl: null },
    ebenen: {
      kuppelstellen: true,
      kraftwerke: true,
      umspannwerke: true,
      hoechstspannung: true,
      hochspannung: false,
      mastrwind: true,
      /* Voreingestellt AUS, und das ist Absicht: die Flaeche ist die einzige
         abgeleitete Geometrie auf dieser Seite. Wer sie sehen will, schaltet
         sie ein und liest dabei, was sie ist. */
      zonenflaeche: false
    }
  };

  var NETZDATEI = {
    hoechstspannung: "data/netz-hoechstspannung.json",
    hochspannung: "data/netz-hochspannung.json",
    umspannwerke: "data/netz-umspannwerke.json",
    zonenflaeche: "data/regelzonen-flaeche.json",
    mastrwind: "data/mastr-wind.json"
  };

  function netzLaden(name) {
    if (Z.netz[name]) { return Promise.resolve(Z.netz[name]); }
    return fetch(NETZDATEI[name] + "?v=" + VERSION).then(function (r) {
      if (!r.ok) { throw new Error(NETZDATEI[name] + ": HTTP " + r.status); }
      return r.json();
    }).then(function (d) { Z.netz[name] = d; return d; });
  }

  function jahrLaden(jahr) {
    if (Object.prototype.hasOwnProperty.call(Z.jahre, jahr)) {
      return Promise.resolve(Z.jahre[jahr]);
    }
    var eintrag = Z.verzeichnis.jahre.filter(function (j) { return j.jahr === jahr; })[0];
    if (!eintrag) { Z.jahre[jahr] = null; return Promise.resolve(null); }
    return fetch(eintrag.datei + "?v=" + VERSION).then(function (r) {
      if (!r.ok) { throw new Error(eintrag.datei + ": HTTP " + r.status); }
      return r.json();
    }).then(function (d) { Z.jahre[jahr] = d; return d; });
  }

  // ---- Zeitraum -----------------------------------------------------------
  /* Die freie Variable ist der dargestellte ZEITRAUM. Ein einzelner Tag ist der
     Sonderfall von = bis. Alles Uebrige bleibt gemessen. */

  function tageImZeitraum(von, bis) {
    var raus = [], t = von, schutz = 0;
    while (t <= bis && schutz++ < 4000) { raus.push(t); t = verschoben(t, 1); }
    return raus;
  }

  function anzahlTage(von, bis) { return tageImZeitraum(von, bis).length; }

  function jahreImZeitraum(von, bis) {
    var raus = [];
    for (var j = Number(von.slice(0, 4)); j <= Number(bis.slice(0, 4)); j++) { raus.push(j); }
    return raus;
  }

  /* Ein Jahr frueher. Der 29. Februar hat kein Gegenstueck -- dann wird der
     28. genommen und das im Bezugstext gesagt, statt still zu verschieben. */
  function vorjahrstag(iso) {
    var t = iso.split("-");
    var jahr = Number(t[0]) - 1;
    if (t[1] === "02" && t[2] === "29") { return jahr + "-02-28"; }
    return jahr + "-" + t[1] + "-" + t[2];
  }

  function zeileImJahr(iso, pfad) {
    var d = Z.jahre[Number(iso.slice(0, 4))];
    if (!d) { return null; }
    var i = d.tage.indexOf(iso);
    if (i < 0) { return null; }
    var knoten = d;
    for (var k = 0; k < pfad.length; k++) {
      knoten = knoten[pfad[k]];
      if (!knoten) { return null; }
    }
    var v = knoten[i];
    return v === undefined ? null : v;
  }

  /* Summe eines Feldes ueber den Zeitraum. Fehlende Tage werden NICHT als Null
     gezaehlt -- die Zahl der belegten Tage wird mitgegeben, damit die Anzeige
     eine Luecke benennen kann. */
  function summeZeitraum(von, bis, pfad) {
    var summe = 0, belegt = 0;
    tageImZeitraum(von, bis).forEach(function (t) {
      var v = zeileImJahr(t, pfad);
      if (v !== null) { summe += v; belegt++; }
    });
    return belegt ? { wert: summe, belegt: belegt } : { wert: null, belegt: 0 };
  }

  function summeGruppe(von, bis, gruppe, unterschluessel) {
    var summe = 0, gefunden = false;
    tageImZeitraum(von, bis).forEach(function (t) {
      var d = Z.jahre[Number(t.slice(0, 4))];
      if (!d) { return; }
      var i = d.tage.indexOf(t);
      if (i < 0) { return; }
      Object.keys(d[gruppe]).forEach(function (k) {
        var reihe = unterschluessel ? d[gruppe][k][unterschluessel] : d[gruppe][k];
        if (reihe && reihe[i] !== null && reihe[i] !== undefined) {
          summe += reihe[i]; gefunden = true;
        }
      });
    });
    return gefunden ? summe : null;
  }

  /* Die sechs erneuerbaren Reihen von SMARD. Pumpspeicher steht bewusst NICHT
     darin: das ist ein Speicher, kein Erzeuger, und der Strom darin wurde
     vorher schon einmal gezaehlt. "Wasserkraft" ist bei SMARD das Laufwasser
     und damit von der Pumpspeicherreihe getrennt. */
  var EE_REIHEN = ["Wind Onshore", "Wind Offshore", "Photovoltaik",
                   "Wasserkraft", "Biomasse", "Sonstige Erneuerbare"];

  /* Wie summeGruppe, aber nur ueber benannte Reihen. Fehlt eine Reihe im
     Zeitraum ganz, faellt sie heraus -- das ist der Fall der Kernenergie ab
     2023 und darf die Summe nicht auf null ziehen. */
  function summeReihen(von, bis, gruppe, schluessel) {
    var summe = 0, gefunden = false;
    tageImZeitraum(von, bis).forEach(function (t) {
      var d = Z.jahre[Number(t.slice(0, 4))];
      if (!d) { return; }
      var i = d.tage.indexOf(t);
      if (i < 0) { return; }
      schluessel.forEach(function (k) {
        var reihe = d[gruppe][k];
        if (reihe && reihe[i] !== null && reihe[i] !== undefined) {
          summe += reihe[i]; gefunden = true;
        }
      });
    });
    return gefunden ? summe : null;
  }

  /* Alle Kennzahlen eines Zeitraums an einer Stelle. Wird fuer den gewaehlten
     Zeitraum und fuer denselben Zeitraum im Vorjahr mit derselben Funktion
     gerechnet -- damit kann der Vergleich nicht auseinanderlaufen. */
  function kennzahlen(von, bis) {
    var netz = summeZeitraum(von, bis, ["netzlast"]);
    if (netz.wert === null) { return null; }
    var erzeugung = summeGruppe(von, bis, "erzeugung");
    var imp = summeGruppe(von, bis, "aussenhandel", "import");
    var exp = summeGruppe(von, bis, "aussenhandel", "export");
    var saldo = (imp === null || exp === null) ? null : imp - exp;
    var tage = anzahlTage(von, bis);
    return {
      von: von, bis: bis, tage: tage, belegt: netz.belegt,
      netzlast: netz.wert,
      erzeugung: erzeugung,
      residuallast: summeZeitraum(von, bis, ["residuallast"]).wert,
      pumpen: summeZeitraum(von, bis, ["pumpspeicherverbrauch"]).wert,
      imp: imp,
      exp: exp,
      saldo: saldo,
      rest: (erzeugung === null || saldo === null) ? null : erzeugung + saldo - netz.wert,
      ee: summeReihen(von, bis, "erzeugung", EE_REIHEN),
      // Mittlere Leistung ueber die belegten Tage, nicht ueber den Kalender:
      // eine Luecke soll den Schnitt nicht nach unten ziehen.
      leistung: netz.belegt ? netz.wert / (netz.belegt * 24) : null
    };
  }

  function traeger(von, bis) {
    var namen = {};
    tageImZeitraum(von, bis).forEach(function (t) {
      var d = Z.jahre[Number(t.slice(0, 4))];
      if (d) { Object.keys(d.erzeugung).forEach(function (n) { namen[n] = true; }); }
    });
    return Object.keys(namen).map(function (name) {
      return { name: name, mwh: summeZeitraum(von, bis, ["erzeugung", name]).wert };
    }).filter(function (e) { return e.mwh !== null; })
      .sort(function (a, b) { return b.mwh - a.mwh; });
  }

  /* WELCHE TAGE FEHLEN -- und woran es liegt.

     Anlass: vom 30.08. bis 01.09.2026 fehlt die Deutschlandreihe ganz, waehrend
     TenneT, Amprion und TransnetBW an denselben Tagen vollstaendig vorliegen.
     Die Luecke steckt allein in den Stundenwerten von 50Hertz (16, 22 und 11
     von 24), und die Deutschlandsumme entsteht aus allen vier -- deshalb faellt
     sie mit aus. Ein blosses "nur 4 von 7 Tagen belegt" laesst das aussehen wie
     ein Ausfall des Abrufs. Es ist keiner.

     Zurueckgegeben wird die Liste der fehlenden Tage und, sofern eindeutig,
     welche Zonen an genau diesen Tagen SEHR WOHL Daten haben. */
  function luecken(von, bis) {
    var fehlend = [], mitDaten = {}, ohneDaten = {};
    tageImZeitraum(von, bis).forEach(function (tag) {
      var d = Z.jahre[Number(tag.slice(0, 4))];
      if (!d) { return; }
      var i = d.tage.indexOf(tag);
      if (i < 0) { return; }
      if (d.netzlast[i] !== null) { return; }
      fehlend.push(tag);
      Object.keys(d.regelzonen).forEach(function (z) {
        var w = d.regelzonen[z].netzlast[i];
        if (w === null || w === undefined) { ohneDaten[z] = true; }
        else { mitDaten[z] = true; }
      });
    });
    return { tage: fehlend,
             zonenMitDaten: Object.keys(mitDaten).filter(function (z) {
               return !ohneDaten[z];
             }),
             zonenOhneDaten: Object.keys(ohneDaten) };
  }

  function zonen(von, bis) {
    var d = Z.jahre[Number(von.slice(0, 4))];
    if (!d) { return []; }
    return Object.keys(d.regelzonen).map(function (z) {
      var last = summeZeitraum(von, bis, ["regelzonen", z, "netzlast"]).wert;
      var gen = 0, gefunden = false, fehlend = [];
      Object.keys(d.regelzonen[z].erzeugung).forEach(function (n) {
        var w = summeZeitraum(von, bis, ["regelzonen", z, "erzeugung", n]).wert;
        if (w === null) { fehlend.push(n); } else { gen += w; gefunden = true; }
      });
      return { zone: z, netzlast: last, erzeugung: gefunden ? gen : null,
               saldo: (last === null || !gefunden) ? null : gen - last, fehlend: fehlend };
    }).filter(function (x) { return x.saldo !== null; });
  }

  /* Erzeugung je Regelzone, nach denselben acht Gruppen wie im Verlauf. Damit
     traegt Braunkohle in der Zonenansicht dieselbe Farbe wie im Diagramm und
     auf der Karte -- Farbe sagt WER, nicht WO.

     Was hier NICHT steht und auch nicht stehen kann: wohin der Ueberschuss
     einer Zone geflossen ist. Erzeugung und Netzlast je Zone sind gemessen,
     ihre Differenz ist eine Bilanz. Ein Fluss von einer Zone in eine andere
     wird nicht veroeffentlicht -- Deutschland und Luxemburg sind EINE
     Gebotszone, und die Verordnung 543/2013 Art. 12.1(g) verlangt
     physikalische Fluesse nur zwischen Gebotszonen. Aus vier Bilanzen liessen
     sich die sechs Fluesse zwischen den Zonen ohnehin nicht ausrechnen; jede
     Aufteilung waere eine Modellrechnung. */
  function zonenTraeger(von, bis) {
    var d = Z.jahre[Number(von.slice(0, 4))];
    if (!d) { return []; }
    return Object.keys(d.regelzonen).map(function (z) {
      var last = summeZeitraum(von, bis, ["regelzonen", z, "netzlast"]).wert;
      var gruppen = TRAEGERGRUPPEN.map(function (g) {
        var summe = 0, gefunden = false;
        g.quellen.forEach(function (q) {
          var w = summeZeitraum(von, bis, ["regelzonen", z, "erzeugung", q]).wert;
          if (w !== null) { summe += w; gefunden = true; }
        });
        return { name: g.name, token: g.token, mwh: gefunden ? summe : 0 };
      }).filter(function (g) { return g.mwh > 0; });
      var gen = gruppen.reduce(function (a, g) { return a + g.mwh; }, 0);
      var ee = 0;
      EE_REIHEN.forEach(function (q) {
        var w = summeZeitraum(von, bis, ["regelzonen", z, "erzeugung", q]).wert;
        if (w !== null) { ee += w; }
      });
      return { zone: z, netzlast: last, erzeugung: gen, gruppen: gruppen, ee: ee,
               saldo: last === null ? null : gen - last };
    }).filter(function (x) { return x.erzeugung > 0; })
      .sort(function (a, b) { return b.erzeugung - a.erzeugung; });
  }

  /* Gegenprobe: die vier Zonen muessen sich auf Deutschland summieren. Ab 2021
     tun sie das praktisch exakt; davor nicht, und das darf nicht weggeglaettet
     werden. Gemessen ueber alle 4.258 Tage weicht die Zonensumme an 1.173 Tagen
     um mehr als 1 % ab, davon 1.076 vor 2018. Groesster Einzelposten: die Reihe
     "Sonstige Konventionelle" steht 2015 in der Zonenaufteilung fuenfmal so
     hoch wie fuer Deutschland insgesamt.

     Der Wert wird deshalb fuer den GEWAEHLTEN Zeitraum gerechnet und nicht an
     einer Jahreszahl festgemacht -- auch 2025 gibt es noch fuenf Tage
     daneben. */
  function zonenAbweichung(von, bis) {
    var de = summeGruppe(von, bis, "erzeugung");
    var zo = zonenTraeger(von, bis).reduce(function (a, x) { return a + x.erzeugung; }, 0);
    if (de === null || !de) { return null; }
    return (zo - de) / de * 100;
  }

  /* Mengengewichteter Preis der Ein- und Ausfuhr im Zeitraum.

     Gewichtet wird STUENDLICH, nicht ueber Tagesmittel. Der Unterschied ist
     kein Detail: ueber 2023 bis 2026 ergab die Tagesnaeherung 67,53 Euro je
     MWh fuer die Ausfuhr, stuendlich gerechnet sind es 77,65. An einem Tag
     wird zu teuren Stunden eingefuehrt und zu billigen ausgefuehrt; im
     Tagesmittel mittelt sich das weg.

     Moeglich ist das ohne Nachladen der Stundendateien, weil je Tag vier
     Summen vorliegen -- Preis mal Menge und Menge, je Richtung. Der
     gewichtete Preis eines Zeitraums ist die Summe der Zaehler durch die
     Summe der Nenner. Das ist keine Naeherung, sondern Assoziativitaet. */
  function aussenhandelspreis(von, bis) {
    var d = Z.ahPreis;
    if (!d) { return null; }
    var pEin = 0, ein = 0, pAus = 0, aus = 0, stunden = 0, tage = 0;
    for (var i = 0; i < d.tage.length; i++) {
      var tag = d.tage[i];
      if (tag < von || tag > bis) { continue; }
      pEin += d.p_ein[i]; ein += d.ein[i];
      pAus += d.p_aus[i]; aus += d.aus[i];
      stunden += d.stunden[i];
      tage++;
    }
    if (!ein || !aus) { return null; }
    return { ein: pEin / ein, aus: pAus / aus, menge_ein: ein, menge_aus: aus,
             stunden: stunden, tage: tage };
  }

  function laender(von, bis) {
    var d = Z.jahre[Number(von.slice(0, 4))];
    if (!d) { return []; }
    return Object.keys(d.aussenhandel).map(function (l) {
      var imp = summeZeitraum(von, bis, ["aussenhandel", l, "import"]).wert;
      var exp = summeZeitraum(von, bis, ["aussenhandel", l, "export"]).wert;
      return { land: l, imp: imp, exp: exp,
               saldo: (imp === null || exp === null) ? null : imp - exp };
    }).filter(function (x) { return x.saldo !== null; })
      .sort(function (a, b) { return b.saldo - a.saldo; });
  }

  /* Beschriftung des Zeitraums. Ein Tag heisst wie ein Tag, ein ganzer Monat
     wie ein Monat -- nicht "01.07. bis 31.07.". */
  function zeitraumLang(von, bis) {
    if (von === bis) { return datumLang(von); }
    var a = ausIso(von), b = ausIso(bis);
    var monatsende = nachIso(new Date(b.getFullYear(), b.getMonth() + 1, 0));
    if (von.slice(8) === "01" && bis === monatsende && von.slice(0, 7) === bis.slice(0, 7)) {
      return a.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    }
    if (von.slice(5) === "01-01" && bis.slice(5) === "12-31"
        && von.slice(0, 4) === bis.slice(0, 4)) {
      return "Jahr " + von.slice(0, 4);
    }
    return a.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" })
      + " bis " + b.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
  }

  function zeitraumKurz(von, bis) {
    return von === bis ? von : von + " bis " + bis;
  }

  // ---- Info-Popover -------------------------------------------------------
  // Oeffnet beim Ueberfahren, schliesst beim Wegbewegen des Zeigers, aber NICHT
  // beim Scrollen, solange der zugehoerige Knopf sichtbar bleibt. Klick heftet
  // an, Escape schliesst.

  var offenesPopover = null, offenerKnopf = null, angeheftet = false;

  function popoverSchliessen() {
    if (offenesPopover && offenesPopover.parentNode) {
      offenesPopover.parentNode.removeChild(offenesPopover);
    }
    if (offenerKnopf) { offenerKnopf.setAttribute("aria-expanded", "false"); }
    offenesPopover = null; offenerKnopf = null; angeheftet = false;
  }

  function popoverBauen(inhalt) {
    var box = el("div", { "class": "pf-popover", role: "dialog", "aria-label": "Herkunft der Zahl" });
    box.appendChild(el("h4", { text: "Aktueller Wert" }));
    box.appendChild(el("p", { text: inhalt.wert }));
    box.appendChild(el("h4", { text: inhalt.grenzenTitel || "Grenzen" }));
    box.appendChild(el("p", { text: inhalt.grenzen }));
    if (inhalt.quellen && inhalt.quellen.length) {
      var p = el("p");
      inhalt.quellen.forEach(function (q, i) {
        if (i) { p.appendChild(document.createTextNode(" · ")); }
        p.appendChild(el("a", { href: q.url, text: q.text, target: "_blank", rel: "noopener" }));
      });
      box.appendChild(p);
    }
    box.appendChild(el("p", { "class": "pf-messung", text: inhalt.messung }));
    return box;
  }

  function infoKnopf(traegerEl, inhalt, beschriftung) {
    var knopf = el("button", {
      "class": "pf-info", type: "button", "aria-expanded": "false",
      "aria-label": "Herkunft: " + beschriftung
    });
    knopf.textContent = "i";
    function oeffnen() {
      if (offenerKnopf === knopf) { return; }
      popoverSchliessen();
      offenesPopover = popoverBauen(inhalt);
      offenerKnopf = knopf;
      knopf.setAttribute("aria-expanded", "true");
      traegerEl.appendChild(offenesPopover);
    }
    knopf.addEventListener("mouseenter", oeffnen);
    knopf.addEventListener("focus", oeffnen);
    traegerEl.addEventListener("mouseleave", function () {
      if (!angeheftet && offenerKnopf === knopf) { popoverSchliessen(); }
    });
    knopf.addEventListener("click", function (e) {
      e.stopPropagation();
      if (offenerKnopf === knopf && angeheftet) { popoverSchliessen(); }
      else { oeffnen(); angeheftet = true; }
    });
    traegerEl.appendChild(knopf);
    return knopf;
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { popoverSchliessen(); }
  });
  document.addEventListener("click", function (e) {
    if (angeheftet && offenesPopover && !offenesPopover.contains(e.target)) {
      popoverSchliessen();
    }
  });
  window.addEventListener("scroll", function () {
    if (!offenerKnopf) { return; }
    var r = offenerKnopf.getBoundingClientRect();
    if (!(r.bottom > 0 && r.top < (window.innerHeight || 0))) { popoverSchliessen(); }
  }, { passive: true });

  // ---- Bausteine ----------------------------------------------------------

  var QUELLE_SMARD = [{ text: "Bundesnetzagentur | SMARD.de", url: "https://www.smard.de/" }];

  function kachel(o) {
    var k = el("div", { "class": "pf-kachel" });
    if (o.akzent) { k.setAttribute("data-akzent", o.akzent); }
    k.appendChild(el("p", { "class": "pf-titel", text: o.titel }));
    var w = el("p", { "class": "pf-wert", text: o.wert });
    if (o.einheit) { w.appendChild(el("span", { "class": "pf-einheit", text: o.einheit })); }
    k.appendChild(w);
    if (o.bezug) { k.appendChild(el("p", { "class": "pf-bezug", text: o.bezug })); }
    k.appendChild(el("p", { "class": "pf-marke",
      text: o.marke || "kein Regler — gemessener Wert" }));
    if (o.info) { infoKnopf(k, o.info, o.titel); }
    return k;
  }

  /* Bezugszeile: derselbe Zeitraum ein Jahr frueher, reale Messwerte. */
  function bezugstext(heute, vorher, vvon, vbis) {
    if (vorher === null || vorher === undefined) {
      return "kein Vergleichswert für " + zeitraumKurz(vvon, vbis) + " vorhanden";
    }
    var p = prozent(heute, vorher);
    return gwh(vorher, 1) + " GWh im Vorjahreszeitraum · "
      + (p >= 0 ? "+" : "−") + nf1.format(Math.abs(p)) + " %";
  }

  function traegerFarbe(name) {
    var treffer = TRAEGERGRUPPEN.filter(function (g) {
      return g.quellen.indexOf(name) >= 0;
    })[0];
    return "var(" + (treffer ? treffer.token : "--tr-sonst") + ")";
  }

  /* farbe gilt fuer alle Balken; farbeJe (optional) entscheidet je Eintrag und
     hat Vorrang. So tragen Energietraeger ihre Farbe und Nachbarlaender die
     eine Farbe ihrer Richtung. */
  function balkenliste(eintraege, farbe, maxWert, farbeJe) {
    var liste = el("div", { "class": "pf-balken" });
    eintraege.forEach(function (e) {
      var zeile = el("div", { "class": "pf-zeile" });
      zeile.appendChild(el("span", { "class": "pf-name", text: e.name, title: e.name }));
      zeile.appendChild(el("span", { "class": "pf-zahl", text: gwh(e.mwh, 1) }));
      liste.appendChild(zeile);
      var schiene = el("div", { "class": "pf-schiene" });
      schiene.appendChild(el("div", {
        "class": "pf-fuellung",
        style: "width:" + (maxWert > 0 ? Math.max(0, e.mwh / maxWert * 100) : 0).toFixed(2)
          + "%;background:" + (farbeJe ? farbeJe(e.name) : farbe) + ";"
      }));
      liste.appendChild(schiene);
    });
    return liste;
  }

  /* massstab (optional) sagt, wie lang ein voller Balken in dieser Saeule ist.
     Ohne diese Zeile ist eine Balkenlaenge nur innerhalb der Saeule lesbar --
     und wer zwei Saeulen nebeneinander sieht, vergleicht sie trotzdem. Genau
     das ist einmal schiefgegangen: 170 GWh Einfuhr aus Frankreich standen als
     kurzer Strich neben 278 GWh Ausfuhr nach Oesterreich als vollem Balken. */
  function saeule(rolle, titel, summeText, inhalt, massstab) {
    var s = el("div", { "class": "pf-saeule", "data-rolle": rolle });
    s.appendChild(el("h3", { text: titel }));
    s.appendChild(el("p", { "class": "pf-saeule-summe", text: summeText }));
    if (massstab) {
      s.appendChild(el("p", { "class": "pf-saeule-massstab", text: massstab }));
    }
    s.appendChild(inhalt);
    return s;
  }

  function abschnitt(titel, inhalt) {
    var a = el("section", { "class": "pf-abschnitt" });
    a.appendChild(el("h2", { text: titel }));
    a.appendChild(inhalt);
    return a;
  }

  // ---- Karte --------------------------------------------------------------
  // Vektorkarte, dunkel und zurueckhaltend. Es werden KEINE fremden
  // Kartenkacheln geladen -- die Geometrie kommt aus data/grundkarte.json
  // (Natural Earth, gemeinfrei) und wird hier als SVG gezeichnet.

  var ZONENFARBE = {
    "50Hertz": "var(--teal)",
    "TenneT": "var(--violett)",
    "Amprion": "var(--orange)",
    "TransnetBW": "var(--gruen)"
  };

  /* Zwei Farbfamilien, zwei Bedeutungen -- nie gemischt:

     ENERGIETRAEGER faerben die Kraftwerkspunkte, und zwar mit DENSELBEN Tokens
     wie das Verlaufsdiagramm. Braunkohle ist auf der Karte dieselbe Farbe wie
     im Diagramm, egal welchem Betreiber der Block gehoert. Vorher waren die
     Punkte nach Regelzone gefaerbt -- damit hatten zwei Braunkohleblocke
     verschiedene Farben, und die Karte widersprach dem Diagramm. Das war ein
     Verstoss gegen "semantische Farbe nie dekorativ".

     REGELZONEN faerben die Hoechstspannungsleitungen, dazu die Strichstaerke
     nach Spannungsebene. Farbe sagt WER, Staerke sagt WELCHE SPANNUNG. */
  var TRAEGERFARBE = {
    "Braunkohle": "--tr-braun",
    "Steinkohle": "--tr-stein",
    "Erdgas": "--tr-gas",
    "Kernenergie": "--tr-kern",
    "Wasser": "--tr-bio",
    "Biomasse": "--tr-bio",
    "Pumpspeicher": "--tr-sonst",
    "Abfall": "--tr-sonst",
    "Wärme": "--tr-sonst",
    "Mineralölprodukte": "--tr-sonst",
    "Batteriespeicher": "--tr-sonst",
    "Sonstige Energieträger (nicht erneuerbar)": "--tr-sonst"
  };

  /* Gruppierung wie im Diagramm, damit die Legende dieselben Namen nennt. */
  var TRAEGERGRUPPE_ANZEIGE = {
    "Braunkohle": "Braunkohle", "Steinkohle": "Steinkohle", "Erdgas": "Erdgas",
    "Kernenergie": "Kernenergie", "Wasser": "Wasser & Biomasse",
    "Biomasse": "Wasser & Biomasse", "Pumpspeicher": "Sonstige",
    "Abfall": "Sonstige", "Wärme": "Sonstige", "Mineralölprodukte": "Sonstige",
    "Batteriespeicher": "Sonstige",
    "Sonstige Energieträger (nicht erneuerbar)": "Sonstige"
  };

  function traegerToken(art) {
    return TRAEGERFARBE[art] || "--tr-sonst";
  }

  /* Betreibername aus OpenStreetMap auf einen der vier UeNB abbilden.
     OSM schreibt denselben Betreiber verschieden ("TenneT", "TenneT TSO",
     "TenneT TSO GmbH"). Wer nicht zuzuordnen ist, bleibt grau -- das sind
     45,5 Prozent der Hoechstspannungsabschnitte, und das wird gesagt statt
     geraten. */
  function zoneAusBetreiber(b) {
    if (!b) { return null; }
    var x = b.toLowerCase();
    if (x.indexOf("50hertz") >= 0) { return "50Hertz"; }
    if (x.indexOf("amprion") >= 0) { return "Amprion"; }
    if (x.indexOf("tennet") >= 0) { return "TenneT"; }
    if (x.indexOf("transnetbw") >= 0 || x.indexOf("transnet bw") >= 0) { return "TransnetBW"; }
    return null;
  }

  /* Die Zone eines Kraftwerks heisst in den SMARD-Stammdaten "TenneT", in den
     OSM-Betreibernamen ebenfalls -- bis auf die Redispatch-Schreibweise
     "TenneT DE". Hier wird auf eine Form gebracht. */
  function zoneNormal(z) {
    return z === "TenneT DE" ? "TenneT" : z;
  }

  /* Spannungsebenen. Farbe und Staerke nach Ebene, nicht dekorativ:
     je hoeher die Spannung, desto heller und kraeftiger die Linie. */
  var EBENEN = [
    { ab: 380000, name: "380 kV", farbe: "var(--netz-380)", breite: 1.1 },
    { ab: 220000, name: "220 kV", farbe: "var(--netz-220)", breite: 0.8 },
    { ab: 110000, name: "110 kV", farbe: "var(--netz-110)", breite: 0.5 }
  ];

  function ebeneVon(volt) {
    for (var i = 0; i < EBENEN.length; i++) {
      if (volt >= EBENEN[i].ab) { return EBENEN[i]; }
    }
    return null;
  }

  /* Schematische Ankerpunkte fuer die Kuppelstellen-Pfeile.
     Schweden und Norwegen haben keine Landgrenze zu Deutschland; ihre Kabel
     landen an der Ostsee- bzw. Nordseekueste. Fuer beide gibt es in
     data/grundkarte.json auch kein Polygon. Deshalb hier feste Richtungen.
     WICHTIG: Diese Punkte sind SCHEMATISCH. Gemessen sind Richtung und Menge,
     nicht der Ort des Uebergangs. Das steht auch auf der Seite. */
  var KUPPEL_RICHTUNG = {
    "Schweden": [0.55, -1.0],
    "Norwegen": [-0.35, -1.0]
  };

  var svgNS = "http://www.w3.org/2000/svg";
  function s(tag, attrs) {
    var n = document.createElementNS(svgNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function schwerpunkt(ringe) {
    var x = 0, y = 0, n = 0;
    ringe.forEach(function (r) {
      r.forEach(function (p) { x += p[0]; y += p[1]; n++; });
    });
    return n ? [x / n, y / n] : null;
  }

  function karte(grundkarte, anlagen, von, bis) {
    /* Breiter Ausschnitt: Deutschland fuellt die Hoehe, die Nachbarlaender
       fuellen die Seiten. So bleibt links und rechts keine leere Flaeche. */
    var B = 1000, H = 780, rand = 14;

    var lonMin = 1e9, lonMax = -1e9, latMin = 1e9, latMax = -1e9;
    grundkarte.bundeslaender.forEach(function (b) {
      b.ringe.forEach(function (r) {
        r.forEach(function (p) {
          if (p[0] < lonMin) { lonMin = p[0]; }
          if (p[0] > lonMax) { lonMax = p[0]; }
          if (p[1] < latMin) { latMin = p[1]; }
          if (p[1] > latMax) { latMax = p[1]; }
        });
      });
    });
    // Die auslaendischen Anlagen deutscher Regelzonen muessen mit aufs Bild.
    anlagen.forEach(function (a) {
      if (a.lon < lonMin) { lonMin = a.lon; }
      if (a.lon > lonMax) { lonMax = a.lon; }
      if (a.lat < latMin) { latMin = a.lat; }
      if (a.lat > latMax) { latMax = a.lat; }
    });

    var kx = Math.cos((latMin + latMax) / 2 * Math.PI / 180);
    var spanX = (lonMax - lonMin) * kx, spanY = latMax - latMin;
    // Auf die Hoehe einpassen und waagerecht mittig setzen -- die Karte soll
    // ihren Rahmen ausfuellen, nicht in der Mitte schweben.
    var skala = (H - 2 * rand) / spanY;
    var vx = (B - spanX * skala) / 2, vy = (H - spanY * skala) / 2;
    function X(lon) { return vx + (lon - lonMin) * kx * skala; }
    function Y(lat) { return vy + (latMax - lat) * skala; }
    function ringPfad(ring) {
      var d = "";
      for (var i = 0; i < ring.length; i++) {
        d += (i ? "L" : "M") + X(ring[i][0]).toFixed(1) + " " + Y(ring[i][1]).toFixed(1);
      }
      return d + "Z";
    }

    if (!Z.karte.sicht) { Z.karte.sicht = { x: 0, y: 0, w: B, h: H }; }
    var sicht = Z.karte.sicht;

    var svg = s("svg", {
      "class": "pf-karte", viewBox: [sicht.x, sicht.y, sicht.w, sicht.h].join(" "),
      role: "img", tabindex: "0",
      "aria-label": "Karte Deutschlands mit Hoechstspannungsnetz, Umspannwerken, "
        + "Kraftwerksstandorten und der gemessenen Richtung des Stromflusses an den "
        + "Kuppelstellen zu den Nachbarlaendern im Zeitraum "
        + zeitraumKurz(von, bis)
    });

    // Auch der Anfangszustand bekommt seinen Faktor -- sonst haengt die
    // Markengroesse davon ab, ob schon einmal gezoomt wurde.
    svg.style.setProperty("--pf-zoom", (sicht.w / B).toFixed(4));

    var gNachbarn = s("g", { "class": "pf-geo-nachbar" });
    grundkarte.nachbarn.forEach(function (nb) {
      nb.ringe.forEach(function (r) { gNachbarn.appendChild(s("path", { d: ringPfad(r) })); });
    });
    svg.appendChild(gNachbarn);

    var gLaender = s("g", { "class": "pf-geo-land" });
    grundkarte.bundeslaender.forEach(function (b) {
      b.ringe.forEach(function (r) {
        var pth = s("path", { d: ringPfad(r) });
        pth.appendChild(s("title")).textContent = b.name;
        gLaender.appendChild(pth);
      });
    });
    svg.appendChild(gLaender);

    /* Regelzonen als Flaeche -- die EINZIGE abgeleitete Geometrie auf dieser
       Karte.

       Sie liegt UEBER der Bundeslandfuellung -- die ist deckend, darunter
       waere die Flaeche unsichtbar -- und unter Leitungen, Umspannwerken und
       Kraftwerken, damit die gemessenen Dinge oben bleiben.

       Gezeichnet wird je Zone EIN Pfad aus vielen Rechtecken. Die Rechtecke
       stossen aneinander und ergeben eine geschlossene Flaeche; einzelne
       Elemente waeren bei 1.871 Rechtecken zu langsam. */
    if (Z.ebenen.zonenflaeche && Z.netz.zonenflaeche) {
      var zf = Z.netz.zonenflaeche;
      var gZf = s("g", { "class": "pf-zonenflaeche" });
      Object.keys(zf.zonen).forEach(function (zone) {
        var d = "";
        zf.zonen[zone].forEach(function (r) {
          var x0 = X(r[0]), x1 = X(r[0] + r[2]);
          var y0 = Y(r[1] + zf.raster), y1 = Y(r[1]);
          d += "M" + x0.toFixed(1) + " " + y0.toFixed(1)
             + "L" + x1.toFixed(1) + " " + y0.toFixed(1)
             + "L" + x1.toFixed(1) + " " + y1.toFixed(1)
             + "L" + x0.toFixed(1) + " " + y1.toFixed(1) + "Z";
        });
        var pfad = s("path", { d: d, fill: ZONENFARBE[zone], "data-zone": zone });
        pfad.appendChild(s("title")).textContent =
          "Regelzone " + zone + " — abgeleitete Fläche, keine amtliche Grenze";
        gZf.appendChild(pfad);
      });
      svg.appendChild(gZf);
    }


    /* Leitungen. Bei knapp 40.000 Wegen waeren 40.000 SVG-Elemente zu langsam.
       Deshalb EIN Pfadelement je Spannungsebene mit vielen Teilzuegen. */
    /* Ein Pfad je Kombination aus Betreiber und Spannungsebene. Farbe sagt
       WER, Staerke sagt WELCHE SPANNUNG. Bei knapp 40.000 Wegen waeren
       Einzelelemente zu langsam; so bleiben es hoechstens 15 Pfade. */
    function leitungsgruppe(objekte, klasse, nachBetreiber) {
      var g = s("g", { "class": klasse });
      var zonen = nachBetreiber ? Object.keys(ZONENFARBE).concat([null]) : [null];
      zonen.forEach(function (zone) {
        EBENEN.forEach(function (e) {
          var d = "";
          objekte.forEach(function (o) {
            if (ebeneVon(o.v) !== e) { return; }
            if (nachBetreiber && zoneAusBetreiber(o.b) !== zone) { return; }
            var p = o.p;
            for (var i = 0; i < p.length; i++) {
              d += (i ? "L" : "M") + X(p[i][0]).toFixed(1) + " " + Y(p[i][1]).toFixed(1);
            }
          });
          if (!d) { return; }
          var pfad = s("path", {
            d: d, fill: "none",
            stroke: (nachBetreiber && zone) ? ZONENFARBE[zone] : "var(--netz-unbekannt)",
            "stroke-width": e.breite, "stroke-linecap": "round",
            "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke"
          });
          if (zone) { pfad.setAttribute("data-zone", zone); }
          g.appendChild(pfad);
        });
      });
      return g;
    }

    if (Z.ebenen.hochspannung && Z.netz.hochspannung) {
      // 110 kV traegt fast nur Verteilnetzbetreiber, keine UeNB -- deshalb
      // hier keine Betreiberfarbe, sondern durchgehend neutral.
      svg.appendChild(leitungsgruppe(Z.netz.hochspannung.objekte, "pf-netz-110", false));
    }
    if (Z.ebenen.hoechstspannung && Z.netz.hoechstspannung) {
      svg.appendChild(leitungsgruppe(Z.netz.hoechstspannung.objekte, "pf-netz-hoechst", true));
    }

    /* Auswaehlbare Punkte. Statt eines schwebenden Tooltips setzt ein Klick die
       Auswahl; die Einzelheiten stehen danach in einem festen Kasten unter der
       Karte und bleiben dort stehen. */
    function waehlbar(kreis, angabe) {
      kreis.setAttribute("tabindex", "0");
      kreis.setAttribute("role", "button");
      kreis.setAttribute("aria-label", angabe.titel);
      function waehlen(e) {
        e.stopPropagation();
        Z.karte.auswahl = angabe;
        auswahlZeigen();
        svg.querySelectorAll("[data-gewaehlt]").forEach(function (x) {
          x.removeAttribute("data-gewaehlt");
        });
        kreis.setAttribute("data-gewaehlt", "1");
      }
      kreis.addEventListener("click", waehlen);
      kreis.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); waehlen(e); }
      });
    }

    if (Z.ebenen.umspannwerke && Z.netz.umspannwerke) {
      var gW = s("g", { "class": "pf-netz-werk" });
      Z.netz.umspannwerke.objekte.forEach(function (w) {
        var e = ebeneVon(w.v);
        if (!e) { return; }
        var rw = (w.v >= 380000 ? 2.1 : w.v >= 220000 ? 1.6 : 1.0);
        var c = s("circle", {
          cx: X(w.lon).toFixed(1), cy: Y(w.lat).toFixed(1),
          r: rw.toFixed(1), style: "--r:" + rw.toFixed(2),
          fill: "var(--netz-unbekannt)"
        });
        waehlbar(c, {
          art: "Umspannwerk", titel: w.n || "Umspannwerk",
          zeilen: [["Spannungsebene", e.name],
                   ["Betreiber", w.b || "in OpenStreetMap nicht angegeben"],
                   ["Lage", nf1.format(w.lat) + " N, " + nf1.format(w.lon) + " O"]],
          fuss: "Stammdatum aus OpenStreetMap. Wie viel Strom hier durchgeht, "
            + "ist nicht veröffentlicht."
        });
        gW.appendChild(c);
      });
      svg.appendChild(gW);
    }

    /* Wind- und Solarparks aus dem Marktstammdatenregister.

       Sie liegen UNTER den Kraftwerken aus den SMARD-Stammdaten, aber ueber den
       Umspannwerken. Der Radius folgt derselben Formel wie bei den Kraftwerken
       -- Wurzel der Leistung mal 0,30 -- damit ein 900-MW-Offshorepark und ein
       900-MW-Braunkohleblock im Bild gleich gross sind. Ein Vergleich, der
       sonst nur im Kopf stattfaende.

       Farbe sagt WER: Wind traegt --tr-wind, Solar --tr-pv. Dieselben Toene wie
       im Verlaufsdiagramm und bei den Regelzonenbaendern. */
    function parkebene(schluessel, klasse, token, traeger, auswahl, beschriften) {
      if (!Z.ebenen[schluessel] || !Z.netz[schluessel]) { return; }
      var d = Z.netz[schluessel];
      var g = s("g", { "class": "pf-geo-park " + klasse });
      auswahl(d.objekte.slice().sort(function (a, b) { return b.kw - a.kw; }))
        .forEach(function (o) {
        var mw = o.kw / 1000;
        var r = Math.max(1.4, Math.sqrt(mw) * 0.30);
        var c = s("circle", {
          cx: X(o.lon).toFixed(1), cy: Y(o.lat).toFixed(1),
          r: r.toFixed(1), style: "--r:" + r.toFixed(2),
          fill: "var(" + token + ")", stroke: "var(" + token + ")",
          "data-traeger": traeger
        });
        waehlbar(c, beschriften(o, mw, d));
        g.appendChild(c);
      });
      svg.appendChild(g);
    }

    /* AUSWAHL, keine Vollstaendigkeit -- und das steht auch so an der Ebene.
       Alle 4.030 Windparks und alle Solarstandorte auf einmal machten aus der
       Karte ein Nadelkissen; die Marken lagen dichter als die Leitungen
       darunter. Gezeigt werden deshalb die groessten, und auf See alle: dort
       sind es nur 47, und sie sind der interessante Teil.

       Die Dateien unter data/ bleiben vollstaendig. Die Auswahl ist eine Frage
       der Darstellung, nicht der Daten -- der Abzug im Quellenverzeichnis
       enthaelt weiterhin jeden Park. */
    var KARTE_GROESSTE = 20;

    parkebene("mastrwind", "pf-park-wind", "--tr-wind", "Wind",
      function (alle) {
        var see = alle.filter(function (o) { return o.see; });
        var land = alle.filter(function (o) { return !o.see; }).slice(0, KARTE_GROESSTE);
        return see.concat(land);
      },
      function (o, mw, d) {
        return {
          art: o.see ? "Windpark auf See" : "Windpark an Land",
          titel: o.n,
          zeilen: [["Nettonennleistung", nf0.format(mw) + " MW"],
                   ["Anlagen", nf0.format(o.a) + (o.a === 1 ? " Anlage" : " Anlagen")],
                   ["Lage", o.see ? "auf See" : "an Land"],
                   ["Älteste Anlage", o.j || "—"],
                   ["Ort", nf1.format(o.lat) + " N, " + nf1.format(o.lon) + " O"]],
          fuss: "Stammdatum aus dem Marktstammdatenregister der Bundesnetzagentur. "
            + "Einzelne Anlagen sind über die Angabe des Betreibers zum Park "
            + "zusammengefasst; der gezeigte Ort ist der Mittelwert der Anlagenorte. "
            + "Die Leistung sagt, was der Park kann — nicht, was er erzeugt hat."
        };
      });

    if (Z.ebenen.kraftwerke) {
      var gPunkte = s("g", { "class": "pf-geo-anlage" });
      /* ABSTEIGEND nach Leistung: der groesste Kreis wird zuerst gezeichnet und
         liegt damit unten. Vorher war es umgekehrt -- Karlsruhe mit 1.706 MW
         legte sich ueber alles in seiner Umgebung, und was darunter lag, war
         nicht mehr anzuklicken. Beim Ueberlappen gewinnt jetzt der kleinere
         Kreis, und das ist die richtige Wahl: der grosse ist auch daneben noch
         zu treffen. */
      anlagen.slice().sort(function (a, b) {
        return (b.leistung_mw || 0) - (a.leistung_mw || 0);
      }).forEach(function (a) {
        var mw = a.leistung_mw || 0;
        var farbe = "var(" + traegerToken(a.energietraeger) + ")";
        var ra = Math.max(1.6, Math.sqrt(mw) * 0.30);
        var c = s("circle", {
          cx: X(a.lon).toFixed(1), cy: Y(a.lat).toFixed(1),
          r: ra.toFixed(1), style: "--r:" + ra.toFixed(2),
          fill: farbe, stroke: farbe,
          "data-zone": zoneNormal(a.regelzone),
          "data-traeger": TRAEGERGRUPPE_ANZEIGE[a.energietraeger] || "Sonstige"
        });
        var bloecke = (a.bloecke || []).filter(function (b) { return b.production_id; });
        waehlbar(c, {
          art: "Kraftwerk", titel: (a.ort || "Kraftwerk") + (a.betreiber ? " · " + a.betreiber : ""),
          zeilen: [["Energieträger", a.energietraeger || "—"],
                   ["Nettoleistung", nf0.format(mw) + " MW"],
                   ["Regelzone", a.regelzone],
                   ["Land", (a.land || "") + (a.staat && a.staat !== "Deutschland"
                     ? " (" + a.staat + ")" : "")],
                   ["Blöcke", (a.bloecke || []).length + " (" + bloecke.length
                     + " mit Erzeugungsreihe)"]],
          fuss: "Stammdatum aus SMARD. Die Nettoleistung sagt, was die Anlage kann — "
            + "nicht, was sie an diesem Tag erzeugt hat."
        });
        gPunkte.appendChild(c);
      });
      svg.appendChild(gPunkte);
    }

    /* Kuppelstellen: gemessene Richtung und Menge des physikalischen
       Stromflusses am gewaehlten Tag. Das ist die EINZIGE Stelle der Karte, an
       der eine Richtung gezeigt wird -- weil sie hier gemessen ist. */
    if (Z.ebenen.kuppelstellen) {
      var mitte = [(lonMin + lonMax) / 2, (latMin + latMax) / 2];
      var werte = laender(von, bis);
      var groesstes = 0;
      werte.forEach(function (w) {
        if (Math.abs(w.saldo) > groesstes) { groesstes = Math.abs(w.saldo); }
      });
      var gK = s("g", { "class": "pf-kuppel" });
      werte.forEach(function (w) {
        var ziel = null;
        var nb = grundkarte.nachbarn.filter(function (x) {
          return x.name === NACHBARNAME[w.land];
        })[0];
        if (nb) {
          var sp = schwerpunkt(nb.ringe);
          ziel = [sp[0] - mitte[0], sp[1] - mitte[1]];
        } else if (KUPPEL_RICHTUNG[w.land]) {
          ziel = KUPPEL_RICHTUNG[w.land];
        }
        if (!ziel) { return; }
        var laenge = Math.sqrt(ziel[0] * ziel[0] + ziel[1] * ziel[1]) || 1;
        var ex = ziel[0] / laenge, ey = ziel[1] / laenge;
        // Anker in Richtung des Nachbarn, nahe an der Grenze. 0,62 statt 0,42:
        // bei 0,42 schwebten die Pfeile mitten im Land und liessen sich als
        // innerdeutsche Fluesse missverstehen -- genau das, was sie nicht sind.
        var ax = X(mitte[0] + ex * (lonMax - lonMin) * 0.62);
        var ay = Y(mitte[1] + ey * (latMax - latMin) * 0.62);
        var px = ex * kx * skala, py = -ey * skala;
        var pl = Math.sqrt(px * px + py * py) || 1;
        px /= pl; py /= pl;
        // Import zeigt nach innen, Export nach aussen.
        var einwaerts = w.saldo >= 0;
        var vorz = einwaerts ? -1 : 1;
        var staerke = groesstes ? Math.abs(w.saldo) / groesstes : 0;
        var lang = 14 + staerke * 26;
        var x1 = ax - px * lang / 2 * vorz, y1 = ay - py * lang / 2 * vorz;
        var x2 = ax + px * lang / 2 * vorz, y2 = ay + py * lang / 2 * vorz;
        var farbe = einwaerts ? "var(--teal)" : "var(--orange)";
        var pfeil = s("g", { "class": "pf-pfeil" });
        pfeil.appendChild(s("line", {
          x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1),
          stroke: farbe, "stroke-width": (1.6 + staerke * 3).toFixed(1),
          "stroke-linecap": "round", "vector-effect": "non-scaling-stroke"
        }));
        var sp2 = 4 + staerke * 4;
        pfeil.appendChild(s("polygon", {
          points: [x2 + px * sp2, y2 + py * sp2, x2 - py * sp2 * 0.6 - px * sp2 * 0.2,
                   y2 + px * sp2 * 0.6 - py * sp2 * 0.2,
                   x2 + py * sp2 * 0.6 - px * sp2 * 0.2,
                   y2 - px * sp2 * 0.6 - py * sp2 * 0.2].map(function (z) {
            return z.toFixed(1); }).join(" "),
          fill: farbe
        }));
        var kreis = s("circle", { cx: ax.toFixed(1), cy: ay.toFixed(1), r: "9",
          fill: "transparent", "class": "pf-pfeil-ziel" });
        waehlbar(kreis, {
          art: "Kuppelstelle", titel: w.land,
          zeilen: [["Richtung", einwaerts ? "Zufluss nach DE" : "Abfluss aus DE"],
                   ["Saldo", vz(w.saldo, 2) + " GWh"],
                   ["Import", gwh(w.imp, 2) + " GWh"],
                   ["Export", gwh(w.exp, 2) + " GWh"]],
          fuss: "Zeitraum " + zeitraumKurz(von, bis) + ". Gemessen: Richtung und Menge "
            + "stammen aus den SMARD-Reihen für den physikalischen Stromfluss. Die Lage "
            + "des Pfeils ist schematisch und bezeichnet keinen konkreten Grenzübergang."
        });
        pfeil.appendChild(kreis);
        gK.appendChild(pfeil);
      });
      svg.appendChild(gK);
    }

    /* Zoom und Verschieben ueber die viewBox. Der Zustand liegt in Z.karte und
       ueberlebt einen Tageswechsel -- wer hineingezoomt hat, bleibt drin. */
    function sichtSetzen(neu) {
      var minB = B / 40, maxB = B * 1.4;
      neu.w = Math.max(minB, Math.min(maxB, neu.w));
      neu.h = neu.w * H / B;
      neu.x = Math.max(-B * 0.3, Math.min(B * 1.3 - neu.w, neu.x));
      neu.y = Math.max(-H * 0.3, Math.min(H * 1.3 - neu.h, neu.y));
      Z.karte.sicht = neu;
      svg.setAttribute("viewBox", [neu.x, neu.y, neu.w, neu.h].join(" "));
      /* Marken bleiben beim Zoomen gleich GROSS auf dem Bildschirm, waehrend
         die Geografie auseinandergeht. Nur so loest ein Zoom eine Haeufung
         auf; skalierten die Kreise mit, saehe jede Zoomstufe gleich gedraengt
         aus. Der Radius bleibt weiterhin proportional zur Wurzel der Leistung,
         die Aussage der Marke aendert sich also nicht.

         Gerechnet wird das im Stylesheet ueber eine einzige Variable -- 5.855
         Kreise bei jedem Mausrad-Schritt einzeln anzufassen waere zu langsam.
         Wo der Browser die CSS-Eigenschaft r nicht kennt, bleibt der
         Attributwert stehen und die Karte verhaelt sich wie bisher. */
      svg.style.setProperty("--pf-zoom", (neu.w / B).toFixed(4));
    }

    function zoomAn(faktor, zx, zy) {
      var a = Z.karte.sicht;
      var w = a.w * faktor;
      sichtSetzen({ x: zx - (zx - a.x) * (w / a.w), y: zy - (zy - a.y) * (w / a.w),
                    w: w, h: a.h * faktor });
    }

    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var kasten = svg.getBoundingClientRect();
      var a = Z.karte.sicht;
      var zx = a.x + (e.clientX - kasten.left) / kasten.width * a.w;
      var zy = a.y + (e.clientY - kasten.top) / kasten.height * a.h;
      zoomAn(e.deltaY > 0 ? 1.15 : 1 / 1.15, zx, zy);
    }, { passive: false });

    var zieht = null;
    svg.addEventListener("pointerdown", function (e) {
      if (e.target !== svg && e.target.getAttribute("tabindex") !== null) { return; }
      zieht = { x: e.clientX, y: e.clientY, sicht: Object.assign({}, Z.karte.sicht) };
      svg.setPointerCapture(e.pointerId);
      svg.setAttribute("data-zieht", "1");
    });
    svg.addEventListener("pointermove", function (e) {
      if (!zieht) { return; }
      var kasten = svg.getBoundingClientRect();
      var dx = (e.clientX - zieht.x) / kasten.width * zieht.sicht.w;
      var dy = (e.clientY - zieht.y) / kasten.height * zieht.sicht.h;
      sichtSetzen({ x: zieht.sicht.x - dx, y: zieht.sicht.y - dy,
                    w: zieht.sicht.w, h: zieht.sicht.h });
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (n) {
      svg.addEventListener(n, function (e) {
        if (!zieht) { return; }
        zieht = null;
        svg.removeAttribute("data-zieht");
        try { svg.releasePointerCapture(e.pointerId); } catch (ignoriert) { /* egal */ }
      });
    });
    svg.addEventListener("keydown", function (e) {
      var a = Z.karte.sicht, schritt = a.w * 0.12;
      if (e.key === "+" || e.key === "=") { zoomAn(1 / 1.3, a.x + a.w / 2, a.y + a.h / 2); }
      else if (e.key === "-") { zoomAn(1.3, a.x + a.w / 2, a.y + a.h / 2); }
      else if (e.key === "ArrowLeft") { sichtSetzen({ x: a.x - schritt, y: a.y, w: a.w, h: a.h }); }
      else if (e.key === "ArrowRight") { sichtSetzen({ x: a.x + schritt, y: a.y, w: a.w, h: a.h }); }
      else if (e.key === "ArrowUp") { sichtSetzen({ x: a.x, y: a.y - schritt, w: a.w, h: a.h }); }
      else if (e.key === "ArrowDown") { sichtSetzen({ x: a.x, y: a.y + schritt, w: a.w, h: a.h }); }
      else { return; }
      e.preventDefault();
    });
    svg.addEventListener("click", function (e) {
      if (e.target === svg) { Z.karte.auswahl = null; auswahlZeigen();
        svg.querySelectorAll("[data-gewaehlt]").forEach(function (x) {
          x.removeAttribute("data-gewaehlt"); }); }
    });

    return { svg: svg, zoomAn: zoomAn, sichtSetzen: sichtSetzen, breite: B, hoehe: H };
  }

  /* Zuordnung deutscher Landesname -> Name in der Grundkarte (englisch). */
  var NACHBARNAME = {
    "Daenemark": "Denmark", "Dänemark": "Denmark", "Frankreich": "France",
    "Luxemburg": "Luxembourg", "Niederlande": "Netherlands",
    "Oesterreich": "Austria", "Österreich": "Austria", "Polen": "Poland",
    "Schweiz": "Switzerland", "Tschechien": "Czechia", "Belgien": "Belgium"
  };

  /* Der Auswahlkasten unter der Karte. Er wird einzeln aktualisiert, damit ein
     Klick nicht die ganze Seite neu baut und den Zoom verliert. */
  function auswahlZeigen() {
    var kasten = document.getElementById("pf-auswahl");
    if (!kasten) { return; }
    kasten.textContent = "";
    var a = Z.karte.auswahl;
    if (!a) {
      // Nichts ausgewaehlt heisst: nichts einblenden. Ein leerer Kasten ueber
      // der Karte wuerde nur Flaeche verdecken.
      kasten.hidden = true;
      return;
    }
    kasten.hidden = false;
    var schliessen = el("button", { "class": "pf-auswahl-zu", type: "button",
      "aria-label": "Auswahl schließen", text: "×" });
    schliessen.addEventListener("click", function () {
      Z.karte.auswahl = null;
      auswahlZeigen();
      var svg = document.querySelector(".pf-karte");
      if (svg) {
        svg.querySelectorAll("[data-gewaehlt]").forEach(function (x) {
          x.removeAttribute("data-gewaehlt");
        });
      }
    });
    kasten.appendChild(schliessen);
    kasten.appendChild(el("p", { "class": "pf-auswahl-art", text: a.art }));
    kasten.appendChild(el("h3", { text: a.titel }));
    var liste = el("dl", { "class": "pf-auswahl-liste" });
    a.zeilen.forEach(function (z) {
      liste.appendChild(el("dt", { text: z[0] }));
      liste.appendChild(el("dd", { text: z[1] }));
    });
    kasten.appendChild(liste);
    kasten.appendChild(el("p", { "class": "pf-auswahl-fuss", text: a.fuss }));
  }

  /* Ebenen-Schalter. Das ist KEIN Regler im Sinne der Datendisziplin: er
     veraendert keine Zahl, sondern nur, was sichtbar ist. Die einzige freie
     Variable bleibt der Kalendertag. */
  function ebenenSchalter() {
    var kasten = el("div", { "class": "pf-ebenen" });
    [
      { schluessel: "kuppelstellen", text: "Flussrichtung an den Kuppelstellen" },
      { schluessel: "kraftwerke", text: "Kraftwerke" },
      { schluessel: "umspannwerke", text: "Umspannwerke ab 110 kV", datei: "umspannwerke" },
      { schluessel: "hoechstspannung", text: "Leitungen 220/380 kV", datei: "hoechstspannung" },
      { schluessel: "mastrwind",
        text: "Windparks: alle auf See, 20 größte an Land", datei: "mastrwind" },
      { schluessel: "hochspannung", text: "Leitungen 110 kV (5,9 MB)", datei: "hochspannung" },
      { schluessel: "zonenflaeche", text: "Regelzonen als Fläche (abgeleitet)",
        datei: "zonenflaeche" }
    ].forEach(function (e) {
      var id = "pf-ebene-" + e.schluessel;
      var wrap = el("label", { "class": "pf-ebene", "for": id });
      var box = el("input", { type: "checkbox", id: id });
      box.checked = !!Z.ebenen[e.schluessel];
      box.addEventListener("change", function () {
        Z.ebenen[e.schluessel] = box.checked;
        if (box.checked && e.datei && !Z.netz[e.datei]) {
          wrap.setAttribute("data-laedt", "1");
          netzLaden(e.datei).then(zeichnen).catch(function (fehler) {
            Z.ebenen[e.schluessel] = false;
            wrap.removeAttribute("data-laedt");
            window.alert("Ebene konnte nicht geladen werden: " + fehler.message);
          });
        } else {
          zeichnen();
        }
      });
      wrap.appendChild(box);
      wrap.appendChild(document.createTextNode(" " + e.text));
      kasten.appendChild(wrap);
    });
    return kasten;
  }

  // ---- Zeitreihe ----------------------------------------------------------
  /* Gestapelte Flaechen: Erzeugung nach Energietraeger ueber die Zeit, darueber
     die Netzlast als Linie. Beide in derselben Einheit -- EINE Achse, nie zwei.

     Ein einzelner Tag wird stuendlich gezeigt (aus data/verlauf/), ein laengerer
     Zeitraum tageweise (aus data/tage/). Ueber Wochen hinweg waeren Stunden
     weder lesbar noch noetig.

     Zwoelf Traeger waeren als Stapel nicht lesbar. Gruppiert wird auf sieben
     farbige Baender plus ein graues "Sonstige". Die Farben sind mit dem
     Validierer geprueft (Helligkeitsband, Chroma, Farbsehschwaeche, Kontrast),
     hell und dunkel getrennt. Das graue "Sonstige" ist bewusst KEIN achter
     Farbton, sondern die Sammelposition -- und es trennt im Stapel das Orange
     des Erdgases vom Gruen der Biomasse, die bei Rotblindheit sonst kaum
     auseinanderzuhalten waeren. */
  var TRAEGERGRUPPEN = [
    { name: "Kernenergie", token: "--tr-kern", quellen: ["Kernenergie"] },
    { name: "Braunkohle", token: "--tr-braun", quellen: ["Braunkohle"] },
    { name: "Steinkohle", token: "--tr-stein", quellen: ["Steinkohle"] },
    { name: "Erdgas", token: "--tr-gas", quellen: ["Erdgas"] },
    { name: "Sonstige", token: "--tr-sonst",
      quellen: ["Sonstige Konventionelle", "Sonstige Erneuerbare", "Pumpspeicher"] },
    { name: "Wasser & Biomasse", token: "--tr-bio", quellen: ["Wasserkraft", "Biomasse"] },
    { name: "Wind", token: "--tr-wind", quellen: ["Wind Onshore", "Wind Offshore"] },
    { name: "Photovoltaik", token: "--tr-pv", quellen: ["Photovoltaik"] }
  ];

  function monatVon(iso) { return iso.slice(0, 7); }

  function verlaufLaden(iso) {
    var m = monatVon(iso);
    if (Object.prototype.hasOwnProperty.call(Z.verlauf, m)) {
      return Promise.resolve(Z.verlauf[m]);
    }
    return fetch("data/verlauf/" + m + ".json?v=" + VERSION).then(function (r) {
      if (!r.ok) { throw new Error("kein Verlauf"); }
      return r.json();
    }).then(function (d) { Z.verlauf[m] = d; return d; })
      .catch(function () { Z.verlauf[m] = null; return null; });
  }

  /* Alle Monate, die ein Zeitraum beruehrt. Eine Woche liegt oft in zwei. */
  function monateImZeitraum(von, bis) {
    var raus = [], m = monatVon(von);
    for (var schutz = 0; schutz < 400; schutz++) {
      raus.push(m);
      if (m === monatVon(bis)) { break; }
      var j = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) + 1;
      if (mo > 12) { j++; mo = 1; }
      m = j + "-" + (mo < 10 ? "0" : "") + mo;
    }
    return raus;
  }

  function verlaufLadenZeitraum(von, bis) {
    return Promise.all(monateImZeitraum(von, bis).map(function (m) {
      return verlaufLaden(m + "-01");
    }));
  }

  /* Bis zu dieser Laenge wird stuendlich gezeigt. Eine Woche sind 168 Punkte --
     das ist auf 900 px noch gut zu lesen. Darueber wird es Kammputz. */
  var STUNDEN_BIS_TAGE = 7;

  /* Stundenwerte eines Zeitraums, gruppiert. Laeuft ueber alle beruehrten
     Monatsdateien; eine Woche liegt oft in zweien. */
  function reiheStuendlich(von, bis) {
    var marken = [], netzlast = [], preis = [], rohe = {}, tage = [];
    TRAEGERGRUPPEN.forEach(function (g) { rohe[g.name] = []; });
    var gefunden = false;
    monateImZeitraum(von, bis).forEach(function (m) {
      var d = Z.verlauf[m];
      if (!d) { return; }
      for (var i = 0; i < d.stunden.length; i++) {
        var tag = d.stunden[i].slice(0, 10);
        if (tag < von || tag > bis) { continue; }
        gefunden = true;
        marken.push(d.stunden[i].slice(11, 13));
        tage.push(tag);
        netzlast.push(d.netzlast[i]);
        preis.push(d.preis_eur_mwh ? d.preis_eur_mwh[i] : null);
        TRAEGERGRUPPEN.forEach(function (g) {
          var summe = 0;
          g.quellen.forEach(function (q) {
            var r = d.erzeugung[q];
            if (r && r[i] !== null && r[i] !== undefined) { summe += r[i]; }
          });
          rohe[g.name].push(summe);
        });
      }
    });
    if (!gefunden) { return null; }
    return {
      teiler: 1000,           // MWh je Stunde -> GW
      einheit: "GW",
      stuendlich: true,
      marken: marken,
      tage: tage,
      netzlast: netzlast,
      preis: preis,
      reihen: TRAEGERGRUPPEN.map(function (g) {
        return { name: g.name, token: g.token, werte: rohe[g.name],
                 summe: rohe[g.name].reduce(function (a, b) { return a + b; }, 0) };
      })
    };
  }

  /* Tageswerte eines laengeren Zeitraums, gruppiert. */
  function reiheTaeglich(von, bis) {
    var tage = tageImZeitraum(von, bis);
    if (!tage.length) { return null; }
    return {
      teiler: 1000,           // MWh je Tag -> GWh je Tag
      einheit: "GWh am Tag",
      marken: tage.map(function (t) { return t.slice(8) + "." + t.slice(5, 7) + "."; }),
      tage: tage,
      netzlast: tage.map(function (t) { return zeileImJahr(t, ["netzlast"]); }),
      preis: tage.map(function (t) { return zeileImJahr(t, ["preis_eur_mwh"]); }),
      reihen: TRAEGERGRUPPEN.map(function (g) {
        var werte = tage.map(function (t) {
          var summe = 0;
          g.quellen.forEach(function (q) {
            var v = zeileImJahr(t, ["erzeugung", q]);
            if (v !== null) { summe += v; }
          });
          return summe;
        });
        return { name: g.name, token: g.token, werte: werte,
                 summe: werte.reduce(function (a, b) { return a + b; }, 0) };
      })
    };
  }

  function zeitreihe(von, bis) {
    if (anzahlTage(von, bis) <= STUNDEN_BIS_TAGE) {
      var s = reiheStuendlich(von, bis);
      if (s) { return s; }
    }
    return reiheTaeglich(von, bis);
  }

  /* ZURUECKGENOMMEN: die flaechendeckende Schraffur.

     Frueher wurde jedes Band mit einem eigenen Muster gefuellt -- mit zwei
     Begruendungen, von denen eine falsch war und die andere zu teuer bezahlt
     wurde.

     Richtig war: eine 2-px-Fuge zwischen den Baendern wird beim Skalieren zu
     einem dicken Rahmen, die Kurve sieht platt aus. Das bleibt wahr; geloest
     wird es jetzt durch eine haarduenne Oberkante in der Traegerfarbe
     (.pf-kante, non-scaling-stroke) statt durch eine Fuellung.

     Falsch war: die Schraffur sei als zweite Codierung noetig und deshalb
     dauerhaft einzuschalten. Textur ist ein ZUSCHALTMERKMAL -- fuer Ausdruck,
     Farbsehschwaeche, erzwungene Farben. Dauerhaft eingeschaltet ist sie
     selbst eine Stoerung, und acht dichte Motive uebereinander ergeben einen
     Rauschteppich. Genau so sah es aus. Der Fehler war meiner, nicht der der
     Daten.

     Was stattdessen gilt: gesaettigte Fuellung gehoert an kleine Marken --
     Legende, Fadenkreuz, Ablesung. Grosse Flaechen tragen denselben Farbton
     stark gedaempft (.pf-band, fill-opacity 0.34). Die Identitaet einer Reihe
     haengt damit nie an der Flaeche allein: Legende und Ablesung nennen jeden
     Traeger im Klartext, und das Band unter dem Zeiger wird angehoben. */

  function zeitreihenDiagramm(von, bis) {
    var v = zeitreihe(von, bis);
    var huelle = el("div", { "class": "pf-verlauf" });
    if (!v) {
      huelle.appendChild(el("p", { "class": "pf-laden",
        text: "Für diesen Zeitraum liegt noch keine Kurve im Repository." }));
      return huelle;
    }

    var hatPreis = v.preis && v.preis.some(function (x) { return x !== null; });
    var B = 900, links = 54, rechts = 14, oben = 30;
    var hoeheOben = 268, luecke = 16, hoehePreis = hatPreis ? 120 : 0;
    var yPreis = oben + hoeheOben + luecke;
    var achsenY = yPreis + hoehePreis + 20;
    var H = achsenY + 12;
    var n = v.marken.length;
    var innenB = B - links - rechts;

    var stapel = [], laufend = [], maxWert = 0, i;
    for (i = 0; i < n; i++) { laufend.push(0); }
    v.reihen.forEach(function (r) {
      var unterkante = laufend.slice();
      laufend = laufend.map(function (x, k) { return x + r.werte[k]; });
      stapel.push({ reihe: r, unten: unterkante, oben: laufend.slice() });
    });
    var stapelOben = laufend;
    stapelOben.forEach(function (x) { if (x > maxWert) { maxWert = x; } });
    v.netzlast.forEach(function (x) { if (x !== null && x > maxWert) { maxWert = x; } });

    function stufeFuer(roh) {
      var kand = [1, 2, 2.5, 5, 10], st = 1;
      for (var z = -3; z <= 9; z++) {
        for (var y = 0; y < kand.length; y++) {
          st = kand[y] * Math.pow(10, z);
          if (st * 4 >= roh) { return st; }
        }
      }
      return st;
    }
    var stufe = stufeFuer(maxWert / v.teiler), achse = stufe * 4;

    function X(k) { return links + (n === 1 ? innenB / 2 : k / (n - 1) * innenB); }
    function Y(mwh) { return oben + hoeheOben - (mwh / v.teiler) / achse * hoeheOben; }

    var svg = s("svg", {
      "class": "pf-diagramm", viewBox: "0 0 " + B + " " + H, role: "img",
      tabindex: "0",
      "aria-label": "Erzeugung nach Energieträger, " + zeitraumLang(von, bis)
        + ", gestapelt in " + v.einheit + ", dazu die Netzlast als Linie"
        + (hatPreis ? " und der Großhandelspreis" : "")
    });

    var gitter = s("g", { "class": "pf-gitter" });
    for (var g = 0; g <= achse + 1e-9; g += stufe) {
      var y = Y(g * v.teiler);
      gitter.appendChild(s("line", { x1: links, x2: B - rechts, y1: y, y2: y }));
      var tx = s("text", { x: links - 8, y: y + 3.5, "text-anchor": "end" });
      tx.textContent = stufe < 1 ? nf1.format(g) : nf0.format(g);
      gitter.appendChild(tx);
    }
    var einheit = s("text", { x: links - 8, y: oben - 12, "text-anchor": "end",
      "class": "pf-achsentitel" });
    einheit.textContent = v.einheit;
    gitter.appendChild(einheit);

    var wechsel = [];
    if (v.tage) {
      for (var w = 0; w < n; w++) {
        if (w === 0 || v.tage[w] !== v.tage[w - 1]) { wechsel.push(w); }
      }
    }
    if (v.stuendlich && wechsel.length > 1) {
      wechsel.forEach(function (anfang, idx) {
        if (idx > 0) {
          gitter.appendChild(s("line", { "class": "pf-tagestrenner",
            x1: X(anfang), x2: X(anfang), y1: oben, y2: yPreis + hoehePreis }));
        }
        var ende = (idx + 1 < wechsel.length) ? wechsel[idx + 1] : n;
        var mitte = (X(anfang) + X(Math.max(anfang, ende - 1))) / 2;
        var b2 = s("text", { x: mitte, y: achsenY, "text-anchor": "middle" });
        var dd = ausIso(v.tage[anfang]);
        b2.textContent = (wechsel.length > 9
          ? dd.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })
          : dd.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }));
        gitter.appendChild(b2);
      });
    } else {
      var jeder = Math.max(1, Math.ceil(n / 12));
      for (var h = 0; h < n; h += jeder) {
        var t2 = s("text", { x: X(h), y: achsenY, "text-anchor": "middle" });
        t2.textContent = v.marken[h];
        gitter.appendChild(t2);
      }
    }
    svg.appendChild(gitter);

    /* Gestapelte Flaechen, gedaempft. Getrennt werden zwei Baender durch die
       haarduenne Oberkante darueber, nicht durch eine Umrandung ringsum. */
    var gFl = s("g", { "class": "pf-flaechen" });
    var gKa = s("g", { "class": "pf-kanten" });
    stapel.forEach(function (b) {
      if (b.reihe.summe <= 0) { return; }
      var d = "M" + X(0).toFixed(1) + " " + Y(b.unten[0]).toFixed(1), k;
      for (k = 0; k < n; k++) { d += "L" + X(k).toFixed(1) + " " + Y(b.oben[k]).toFixed(1); }
      for (k = n - 1; k >= 0; k--) { d += "L" + X(k).toFixed(1) + " " + Y(b.unten[k]).toFixed(1); }
      b.flaeche = s("path", { d: d + "Z", "class": "pf-band",
        fill: "var(" + b.reihe.token + ")" });
      gFl.appendChild(b.flaeche);
      var ok = "M" + X(0).toFixed(1) + " " + Y(b.oben[0]).toFixed(1);
      for (k = 1; k < n; k++) { ok += "L" + X(k).toFixed(1) + " " + Y(b.oben[k]).toFixed(1); }
      b.kante = s("path", { d: ok, "class": "pf-kante",
        stroke: "var(" + b.reihe.token + ")" });
      gKa.appendChild(b.kante);
    });
    svg.appendChild(gFl);
    svg.appendChild(gKa);

    /* Das Band unter dem Zeiger wird angehoben -- leicht, nicht grell. Es ist
       eine Lesehilfe, keine zweite Codierung: die Ablesung nennt denselben
       Traeger im Klartext, damit die Auskunft auch ohne Zeiger vollstaendig
       ist (Tastatur, Bildschirmfoto, Vorlesesoftware). */
    var hell = null;
    function hebeAn(b) {
      if (hell === b) { return; }
      if (hell) {
        hell.flaeche.classList.remove("pf-band-hell");
        hell.kante.classList.remove("pf-kante-hell");
      }
      hell = b;
      if (hell) {
        hell.flaeche.classList.add("pf-band-hell");
        hell.kante.classList.add("pf-kante-hell");
      }
    }
    /* Welches Band liegt an dieser Stelle unter dem Zeiger? Gesucht wird ueber
       den WERT, nicht ueber die Pixelreihenfolge -- ein Band der Hoehe null
       faellt damit von selbst heraus. */
    function bandBei(k, mwh) {
      for (var i2 = 0; i2 < stapel.length; i2++) {
        var b = stapel[i2];
        if (!b.flaeche) { continue; }
        if (mwh >= b.unten[k] && mwh < b.oben[k]) { return b; }
      }
      return null;
    }

    /* UNTERDECKUNG: die Luecke zwischen Stapelspitze und Netzlast, wenn die
       Erzeugung nicht reicht. Sie wird orange getoent -- das ist leere
       Flaeche, dort verfaelscht eine Toenung nichts.

       Die UEBERDECKUNG bleibt ungetoent. Sie liegt ueber der Netzlastlinie und
       damit MITTEN in den Traegerflaechen; eine Toenung darueber machte aus
       dem Gold der Photovoltaik ein Olivbraun und log ueber den Energietraeger.
       Dass die Erzeugung die Last uebersteigt, sieht man ohnehin: der Stapel
       ragt ueber die Linie. Der Zahlenwert steht in der Ablesung.

       An den Kreuzungen wird geteilt, sonst faerbte ein Segment falsch. */
    var gDeck = s("g", { "class": "pf-deckung" });
    var deckPfade = { ueber: "", unter: "" };
    for (i = 0; i < n - 1; i++) {
      var la = v.netzlast[i], lb = v.netzlast[i + 1];
      if (la === null || lb === null) { continue; }
      var ea = stapelOben[i], eb = stapelOben[i + 1];
      var da = ea - la, db = eb - lb;
      function quad(xa, yEa, yLa, xb, yEb, yLb, positiv) {
        var d = "M" + xa.toFixed(1) + " " + yEa.toFixed(1)
              + "L" + xb.toFixed(1) + " " + yEb.toFixed(1)
              + "L" + xb.toFixed(1) + " " + yLb.toFixed(1)
              + "L" + xa.toFixed(1) + " " + yLa.toFixed(1) + "Z";
        deckPfade[positiv ? "ueber" : "unter"] += d;
      }
      if ((da >= 0) === (db >= 0)) {
        quad(X(i), Y(ea), Y(la), X(i + 1), Y(eb), Y(lb), da >= 0);
      } else {
        var t = da / (da - db);
        var xm = X(i) + (X(i + 1) - X(i)) * t;
        var ym = Y(ea + (eb - ea) * t);
        quad(X(i), Y(ea), Y(la), xm, ym, ym, da >= 0);
        quad(xm, ym, ym, X(i + 1), Y(eb), Y(lb), db >= 0);
      }
    }
    if (deckPfade.unter) {
      gDeck.appendChild(s("path", { d: deckPfade.unter, fill: "var(--orange)",
        "fill-opacity": 0.30 }));
    }
    svg.appendChild(gDeck);

    /* Netzlast als duenne Linie in Textfarbe. non-scaling-stroke, damit sie
       beim Skalieren duenn bleibt und nicht zum Balken wird. */
    var dl = "";
    v.netzlast.forEach(function (x, k) {
      if (x === null) { return; }
      dl += (dl ? "L" : "M") + X(k).toFixed(1) + " " + Y(x).toFixed(1);
    });
    if (dl) { svg.appendChild(s("path", { d: dl, "class": "pf-lastlinie", fill: "none" })); }

    /* Preisstreifen. EIGENE Achse in einem EIGENEN Feld -- niemals eine zweite
       y-Achse im selben Bild. Euro je MWh und Gigawatt haben nichts
       miteinander zu tun. */
    var Yp = null, preisRahmen = null;
    if (hatPreis) {
      var pw = v.preis.filter(function (x) { return x !== null; });
      var pMin = Math.min.apply(null, pw), pMax = Math.max.apply(null, pw);
      /* Fester Rahmen von -100 bis 400 Euro je MWh. Ein fester Rahmen macht
         zwei Zeitraeume vergleichbar; eine mitwandernde Achse laesst jede
         Woche gleich dramatisch aussehen.

         ABER er wird geweitet, sobald der Zeitraum darueber hinausgeht. Die
         Quelle kennt beides: -500,00 Euro am 02.07.2023 um 14 Uhr und
         +936,28 Euro am 12.12.2024 um 17 Uhr. Einen gemessenen Wert am
         Bildrand abzuschneiden waere eine stillschweigende Korrektur -- die
         gibt es hier nicht. Die Achsenbeschriftung nennt dann den echten
         Rand, und die Legende sagt, dass geweitet wurde. */
      var pUnten = Math.min(-100, Math.floor(pMin / 100) * 100);
      var pOben = Math.max(400, Math.ceil(pMax / 100) * 100);
      preisRahmen = { unten: pUnten, oben: pOben,
                      geweitet: pUnten < -100 || pOben > 400 };
      Yp = function (e) {
        return yPreis + hoehePreis - (e - pUnten) / (pOben - pUnten) * hoehePreis;
      };
      var gp = s("g", { "class": "pf-gitter" });
      [pUnten, 0, pOben].forEach(function (e) {
        var yy = Yp(e);
        gp.appendChild(s("line", { x1: links, x2: B - rechts, y1: yy, y2: yy,
          "stroke-dasharray": e === 0 ? "" : "2 3" }));
        var tt = s("text", { x: links - 8, y: yy + 3.5, "text-anchor": "end" });
        tt.textContent = nf0.format(e);
        gp.appendChild(tt);
      });
      // Links neben der Achse sitzt schon die Null des oberen Feldes. Die
      // Einheit des Preisstreifens steht deshalb IM Feld, linksbuendig.
      var pe = s("text", { x: links + 4, y: yPreis + 10, "text-anchor": "start",
        "class": "pf-achsentitel" });
      pe.textContent = "€/MWh";
      gp.appendChild(pe);
      svg.appendChild(gp);

      /* Stufenflaeche statt Staebchen: ein Preis gilt seine Stunde (bzw. seinen
         Tag) ueber konstant. Jeder Wert bekommt deshalb ein Kaestchen um seine
         Marke, nicht einen Strich auf ihr. Negative Stunden behalten ihren
         eigenen Ton -- sie sind der interessante Fall und kein Fehler. */
      var halb = n > 1 ? innenB / (n - 1) / 2 : innenB / 2;
      var dNeg = "", dPos = "", dKante = "", yNull = Yp(0);
      v.preis.forEach(function (e, k) {
        if (e === null) { return; }
        var xa = Math.max(links, X(k) - halb), xb = Math.min(B - rechts, X(k) + halb);
        var yw = Yp(e);
        var kasten = "M" + xa.toFixed(1) + " " + yNull.toFixed(1)
          + "L" + xa.toFixed(1) + " " + yw.toFixed(1)
          + "L" + xb.toFixed(1) + " " + yw.toFixed(1)
          + "L" + xb.toFixed(1) + " " + yNull.toFixed(1) + "Z";
        if (e < 0) { dNeg += kasten; } else { dPos += kasten; }
        // Durchgezogene Treppe mit Steigern, nicht einzelne Striche: sonst
        // sieht die Oberkante aus wie eine gestrichelte Linie.
        dKante += (dKante ? "L" : "M") + xa.toFixed(1) + " " + yw.toFixed(1)
          + "L" + xb.toFixed(1) + " " + yw.toFixed(1);
      });
      if (dPos) { svg.appendChild(s("path", { d: dPos, "class": "pf-preis-pos" })); }
      if (dNeg) { svg.appendChild(s("path", { d: dNeg, "class": "pf-preis-neg" })); }
      if (dKante) { svg.appendChild(s("path", { d: dKante, "class": "pf-preis-kante" })); }
    }

    var kreuz = s("line", { "class": "pf-kreuz", y1: oben, y2: yPreis + hoehePreis,
      x1: "-99", x2: "-99" });
    svg.appendChild(kreuz);

    /* Ablesung IM Bild, senkrecht am Fadenkreuz. Sie kippt auf die andere
       Seite, sobald sie sonst ueber den Rand liefe. */
    var gAb = s("g", { "class": "pf-ablesung-svg" });
    svg.appendChild(gAb);
    huelle.appendChild(svg);

    var stelle = Math.min(Math.floor(n / 2), n - 1);
    var texte = el("p", { "class": "pf-ablesung-text", role: "status" });

    function zeige(k, band) {
      stelle = k;
      hebeAn(band || null);
      kreuz.setAttribute("x1", X(k));
      kreuz.setAttribute("x2", X(k));
      gAb.textContent = "";

      var zeilen = [];
      zeilen.push({ label: v.stuendlich
        ? ausIso(v.tage[k]).toLocaleDateString("de-DE",
            { weekday: "short", day: "2-digit", month: "2-digit" }) + ", " + v.marken[k] + ":00"
        : datumLang(v.tage[k]), wert: "", kopf: true });
      if (v.netzlast[k] !== null) {
        zeilen.push({ label: "Netzlast", wert: nf1.format(v.netzlast[k] / v.teiler),
          farbe: "var(--last-linie)" });
        var deck = (stapelOben[k] - v.netzlast[k]) / v.teiler;
        zeilen.push({ label: deck >= 0 ? "Überdeckung" : "Unterdeckung",
          wert: (deck >= 0 ? "+" : "−") + nf1.format(Math.abs(deck)),
          farbe: deck >= 0 ? "var(--teal)" : "var(--orange)" });
      }
      if (hatPreis && v.preis[k] !== null) {
        zeilen.push({ label: "Preis", wert: nf2.format(v.preis[k]) + " €/MWh",
          farbe: v.preis[k] < 0 ? "var(--orange)" : "var(--preis-linie)" });
      }
      v.reihen.slice().reverse().forEach(function (r) {
        if (!r.werte[k]) { return; }
        zeilen.push({ label: r.name, wert: nf1.format(r.werte[k] / v.teiler),
          farbe: "var(" + r.token + ")",
          aktiv: !!(band && band.reihe === r) });
      });

      var zh = 14, breite = 186, hoehe = zeilen.length * zh + 12;
      var rechtsRum = X(k) < links + innenB * 0.6;
      var bx = rechtsRum ? X(k) + 12 : X(k) - 12 - breite;
      var by = Math.max(oben + 4, Math.min(oben + hoeheOben - hoehe - 4, oben + 12));
      gAb.appendChild(s("rect", { x: bx, y: by, width: breite, height: hoehe,
        rx: 8, "class": "pf-ablesung-grund" }));
      zeilen.forEach(function (z, idx) {
        var yy = by + 16 + idx * zh;
        if (!z.kopf) {
          gAb.appendChild(s("rect", { x: bx + 10, y: yy - 7, width: 7, height: 7,
            rx: 1.5, fill: z.farbe }));
        }
        var tl = s("text", { x: bx + (z.kopf ? 10 : 22), y: yy,
          "class": (z.kopf ? "pf-ablesung-kopf" : "pf-ablesung-label")
            + (z.aktiv ? " pf-ablesung-aktiv" : "") });
        tl.textContent = z.label;
        gAb.appendChild(tl);
        if (z.wert) {
          var tw = s("text", { x: bx + breite - 10, y: yy, "text-anchor": "end",
            "class": "pf-ablesung-wert" + (z.aktiv ? " pf-ablesung-aktiv" : "") });
          tw.textContent = z.wert;
          gAb.appendChild(tw);
        }
      });
      texte.textContent = zeilen.map(function (z) {
        return z.kopf ? z.label : z.label + " " + z.wert; }).join(", ");
    }

    function ausPosition(punkt) {
      var kasten = svg.getBoundingClientRect();
      var px = (punkt.clientX - kasten.left) / kasten.width * B;
      var py = (punkt.clientY - kasten.top) / kasten.height * H;
      var k = Math.max(0, Math.min(n - 1,
        Math.round((px - links) / innenB * (n - 1))));
      // Aus der Hoehe zurueck in Megawattstunden -- die Umkehrung von Y().
      var mwh = (oben + hoeheOben - py) / hoeheOben * achse * v.teiler;
      var imFeld = py >= oben && py <= oben + hoeheOben;
      zeige(k, imFeld ? bandBei(k, mwh) : null);
    }
    svg.addEventListener("mousemove", ausPosition);
    svg.addEventListener("touchmove", function (e) {
      if (e.touches.length) { ausPosition(e.touches[0]); }
    }, { passive: true });
    svg.addEventListener("keydown", function (e) {
      // Ohne Zeiger gibt es keine Hoehe; das hervorgehobene Band bleibt, was
      // es war. Die Ablesung ist ohnehin vollstaendig.
      if (e.key === "ArrowRight") { zeige(Math.min(n - 1, stelle + 1), hell); }
      else if (e.key === "ArrowLeft") { zeige(Math.max(0, stelle - 1), hell); }
      else { return; }
      e.preventDefault();
    });
    svg.addEventListener("mouseleave", function () { zeige(stelle, null); });
    zeige(stelle);
    huelle.appendChild(texte);

    var gesamt = v.reihen.reduce(function (a, r) { return a + r.summe; }, 0) || 1;
    var legende = el("div", { "class": "pf-legende pf-legende-traeger" });
    legende.appendChild(el("span", { "class": "pf-legende-titel",
      text: "Anteil im Zeitraum:" }));
    v.reihen.slice().reverse().forEach(function (r) {
      if (!r.summe) { return; }
      var sp = el("span");
      sp.appendChild(el("i", { style: "background:var(" + r.token + ");" }));
      sp.appendChild(document.createTextNode(
        r.name + " " + nf1.format(r.summe / gesamt * 100) + " %"));
      legende.appendChild(sp);
    });
    var spl = el("span");
    spl.appendChild(el("i", { "class": "pf-strich pf-last" }));
    spl.appendChild(document.createTextNode("Netzlast"));
    legende.appendChild(spl);
    var spd = el("span");
    spd.appendChild(el("i", { style: "background:var(--orange);opacity:0.45;" }));
    spd.appendChild(document.createTextNode("Unterdeckung: Erzeugung unter der Last"));
    legende.appendChild(spd);
    if (hatPreis) {
      var spp = el("span");
      spp.appendChild(el("i", { "class": "pf-strich pf-preis" }));
      spp.appendChild(document.createTextNode(
        "Großhandelspreis Day-Ahead, Achse " + nf0.format(preisRahmen.unten)
        + " bis " + nf0.format(preisRahmen.oben) + " €/MWh"
        + (preisRahmen.geweitet
            ? " — geweitet, der Zeitraum geht über −100 bis 400 hinaus"
            : "")));
      legende.appendChild(spp);
    }
    huelle.appendChild(legende);

    var schalter = el("button", { "class": "pf-tabellenschalter", type: "button",
      "aria-expanded": "false", text: "Als Tabelle anzeigen" });
    var tabHuelle = el("div", { "class": "pf-tabellen-rollbereich" });
    tabHuelle.hidden = true;
    schalter.addEventListener("click", function () {
      var auf = tabHuelle.hidden;
      tabHuelle.hidden = !auf;
      schalter.setAttribute("aria-expanded", auf ? "true" : "false");
      schalter.textContent = auf ? "Tabelle ausblenden" : "Als Tabelle anzeigen";
      if (auf && !tabHuelle.childNodes.length) {
        var tab = el("table", { "class": "pf-tabelle" });
        var kopfz = el("tr");
        kopfz.appendChild(el("th", { text: v.stuendlich ? "Stunde" : "Tag", scope: "col" }));
        v.reihen.forEach(function (r) {
          if (r.summe) { kopfz.appendChild(el("th", { text: r.name, scope: "col" })); }
        });
        kopfz.appendChild(el("th", { text: "Netzlast", scope: "col" }));
        kopfz.appendChild(el("th", { text: "Über-/Unterdeckung", scope: "col" }));
        if (hatPreis) { kopfz.appendChild(el("th", { text: "€/MWh", scope: "col" })); }
        var kopf = el("thead"); kopf.appendChild(kopfz); tab.appendChild(kopf);
        var koerper = el("tbody");
        v.marken.forEach(function (mk, k) {
          var tr = el("tr");
          tr.appendChild(el("td", {
            text: v.stuendlich ? v.tage[k] + " " + mk + ":00" : v.tage[k] }));
          v.reihen.forEach(function (r) {
            if (r.summe) { tr.appendChild(el("td", { text: nf1.format(r.werte[k] / v.teiler) })); }
          });
          tr.appendChild(el("td", { text: v.netzlast[k] === null ? "—"
            : nf1.format(v.netzlast[k] / v.teiler) }));
          tr.appendChild(el("td", { text: v.netzlast[k] === null ? "—"
            : nf1.format((stapelOben[k] - v.netzlast[k]) / v.teiler) }));
          if (hatPreis) {
            tr.appendChild(el("td", { text: v.preis[k] === null ? "—"
              : nf2.format(v.preis[k]) }));
          }
          koerper.appendChild(tr);
        });
        tab.appendChild(koerper);
        tabHuelle.appendChild(tab);
      }
    });
    huelle.appendChild(schalter);
    huelle.appendChild(tabHuelle);
    return huelle;
  }

  /* Erzeugung nach Energietraeger, aufgeteilt auf die vier Regelzonen.

     Der Balken einer Zone ist auf die groesste Zone skaliert, nicht auf sich
     selbst -- sonst saehen alle vier gleich gross aus und die Aussage "im
     Norden steht das meiste" ginge verloren. Die Anteile innerhalb einer Zone
     bleiben trotzdem ablesbar, weil die Abschnitte anteilig geteilt sind. */
  function regelzonenAbschnitt(von, bis) {
    var huelle = el("div", { "class": "pf-zonen-huelle" });
    var zz = zonenTraeger(von, bis);
    if (!zz.length) {
      huelle.appendChild(el("p", { "class": "pf-laden",
        text: "Für diesen Zeitraum liegt keine Aufteilung auf die Regelzonen vor." }));
      return huelle;
    }
    var maxGen = Math.max.apply(null, zz.map(function (x) { return x.erzeugung; }));

    var liste = el("div", { "class": "pf-zonen" });
    zz.forEach(function (x) {
      var karte = el("div", { "class": "pf-zone" });
      var kopf = el("div", { "class": "pf-zone-kopf" });
      kopf.appendChild(el("span", { "class": "pf-zone-name", text: x.zone }));
      kopf.appendChild(el("span", { "class": "pf-zone-zahl",
        text: gwh(x.erzeugung, 1) + " GWh erzeugt" }));
      karte.appendChild(kopf);

      var schiene = el("div", { "class": "pf-zone-schiene" });
      var stapel = el("div", { "class": "pf-zone-stapel",
        style: "width:" + (x.erzeugung / maxGen * 100).toFixed(2) + "%;" });
      /* FESTE Reihenfolge, nicht nach Groesse sortiert. Sonst steht Wind in
         jedem der vier Balken an einer anderen Stelle und der Vergleich
         zwischen den Zonen -- der eigentliche Zweck -- wird zum Suchspiel. */
      x.gruppen.forEach(function (g) {
        var anteil = g.mwh / x.erzeugung * 100;
        stapel.appendChild(el("span", {
          style: "width:" + anteil.toFixed(2) + "%;background:var(" + g.token + ");",
          title: g.name + ": " + gwh(g.mwh, 1) + " GWh · " + nf1.format(anteil) + " %"
        }));
      });
      schiene.appendChild(stapel);
      karte.appendChild(schiene);

      var fuss = [];
      if (x.netzlast !== null) {
        fuss.push("Netzlast " + gwh(x.netzlast, 1) + " GWh");
        fuss.push("Saldo " + vz(x.saldo, 1) + " GWh");
      }
      if (x.erzeugung > 0 && x.netzlast) {
        fuss.push("Erneuerbare " + nf1.format(x.ee / x.netzlast * 100) + " % der Zonenlast");
      }
      karte.appendChild(el("p", { "class": "pf-zone-fuss", text: fuss.join(" · ") }));
      liste.appendChild(karte);
    });
    huelle.appendChild(liste);

    var legende = el("div", { "class": "pf-legende pf-legende-traeger" });
    legende.appendChild(el("span", { "class": "pf-legende-titel", text: "Energieträger:" }));
    TRAEGERGRUPPEN.slice().reverse().forEach(function (g) {
      if (!zz.some(function (x) {
        return x.gruppen.some(function (y) { return y.name === g.name; });
      })) { return; }
      var sp = el("span");
      sp.appendChild(el("i", { style: "background:var(" + g.token + ");" }));
      sp.appendChild(document.createTextNode(g.name));
      legende.appendChild(sp);
    });
    huelle.appendChild(legende);

    /* Was die Zahlen sagen und was nicht. Der Satz steht bewusst hier und
       nicht nur in einem Popover: die naheliegende Fehllesung ist, aus vier
       Salden auf Fluesse zwischen den Zonen zu schliessen. */
    huelle.appendChild(el("p", { "class": "pf-bezug",
      text: "Erzeugung und Netzlast je Zone sind gemessen. Ihre Differenz ist eine "
        + "Bilanz — sie sagt, wie viel eine Zone mehr oder weniger erzeugt hat als "
        + "sie verbraucht hat, aber nicht, wohin der Überschuss gegangen ist. Flüsse "
        + "zwischen den vier Regelzonen werden nicht veröffentlicht und stehen "
        + "deshalb hier nicht. Aus vier Bilanzen ließen sie sich auch nicht "
        + "ausrechnen: es sind sechs Verbindungen, und jede Zone tauscht zusätzlich "
        + "direkt mit dem Ausland. Jede Aufteilung wäre eine Modellrechnung." }));

    // Gegenprobe im Klartext, nicht versteckt.
    var abw = zonenAbweichung(von, bis);
    if (abw !== null) {
      huelle.appendChild(el("p", { "class": "pf-bezug",
        text: "Gegenprobe: die vier Zonen zusammen ergeben "
          + (Math.abs(abw) < 0.05 ? "genau" : nf2.format(Math.abs(abw)) + " % "
             + (abw > 0 ? "mehr" : "weniger") + " als")
          + " die Erzeugung für Deutschland insgesamt." }));
    }

    var schalter = el("button", { "class": "pf-tabellenschalter", type: "button",
      "aria-expanded": "false", text: "Als Tabelle anzeigen" });
    var tabHuelle = el("div", { "class": "pf-tabellen-rollbereich" });
    tabHuelle.hidden = true;
    schalter.addEventListener("click", function () {
      var auf = tabHuelle.hidden;
      tabHuelle.hidden = !auf;
      schalter.setAttribute("aria-expanded", auf ? "true" : "false");
      schalter.textContent = auf ? "Tabelle ausblenden" : "Als Tabelle anzeigen";
      if (auf && !tabHuelle.childNodes.length) {
        var tab = el("table", { "class": "pf-tabelle" });
        var kopfz = el("tr");
        kopfz.appendChild(el("th", { text: "Regelzone", scope: "col" }));
        TRAEGERGRUPPEN.forEach(function (g) {
          kopfz.appendChild(el("th", { text: g.name, scope: "col" }));
        });
        ["Erzeugung", "Netzlast", "Saldo"].forEach(function (h) {
          kopfz.appendChild(el("th", { text: h + " (GWh)", scope: "col" }));
        });
        var kopf = el("thead"); kopf.appendChild(kopfz); tab.appendChild(kopf);
        var koerper = el("tbody");
        zz.forEach(function (x) {
          var tr = el("tr");
          tr.appendChild(el("th", { text: x.zone, scope: "row" }));
          TRAEGERGRUPPEN.forEach(function (g) {
            var e = x.gruppen.filter(function (y) { return y.name === g.name; })[0];
            tr.appendChild(el("td", { text: e ? gwh(e.mwh, 1) : "—" }));
          });
          tr.appendChild(el("td", { text: gwh(x.erzeugung, 1) }));
          tr.appendChild(el("td", { text: x.netzlast === null ? "—" : gwh(x.netzlast, 1) }));
          tr.appendChild(el("td", { text: x.saldo === null ? "—" : vz(x.saldo, 1) }));
          koerper.appendChild(tr);
        });
        tab.appendChild(koerper);
        tabHuelle.appendChild(tab);
      }
    });
    huelle.appendChild(schalter);
    huelle.appendChild(tabHuelle);
    return huelle;
  }

  // ---- Redispatch ---------------------------------------------------------
  /* Eingriffe der Uebertragungsnetzbetreiber ins Kraftwerkseinsatzprogramm.
     Das ist die gemessene Antwort auf die Frage nach dem Netzengpass -- und
     etwas anderes als ein Lastfluss auf einer Leitung. Den gibt es weiterhin
     nicht.

     Die Reihe beginnt 2021; fuer frueher liefert die Quelle HTTP 400. */
  var REDISPATCH_AB = "2021-01-01";

  function redispatchLaden(jahr) {
    if (Object.prototype.hasOwnProperty.call(Z.redispatch, jahr)) {
      return Promise.resolve(Z.redispatch[jahr]);
    }
    var eintrag = (Z.rdVerzeichnis && Z.rdVerzeichnis.jahre || []).filter(
      function (j) { return j.jahr === jahr; })[0];
    if (!eintrag) { Z.redispatch[jahr] = null; return Promise.resolve(null); }
    return fetch(eintrag.datei + "?v=" + VERSION).then(function (r) {
      if (!r.ok) { throw new Error(eintrag.datei); }
      return r.json();
    }).then(function (d) { Z.redispatch[jahr] = d; return d; })
      .catch(function () { Z.redispatch[jahr] = null; return null; });
  }

  function redispatchLadenZeitraum(von, bis) {
    return Promise.all(jahreImZeitraum(von, bis).map(redispatchLaden));
  }

  /* Summiert die Tagesaggregate ueber den Zeitraum. Tage ohne Massnahme fehlen
     in der Quelle -- das ist kein Loch, sondern eine Null, und wird auch so
     gezaehlt. */
  /* Die vierzehn Gruende der Quelle auf vier lesbare Gruppen. Die Zuordnung
     steht HIER und nicht im Abrufskript: die Datei behaelt den Wortlaut der
     Quelle, gruppiert wird erst fuer die Anzeige. Wer die Einteilung nicht
     teilt, sieht in data/redispatch/*.json unter je_grund das Original.

     Die Reihenfolge ist die der Gruppen weiter unten -- geprueft wird von
     oben nach unten, der erste Treffer gewinnt. "Strom- und Spannungsbedingter
     RD" faellt deshalb unter Spannungshaltung und nicht unter Engpass; das ist
     eine Entscheidung und keine Messung, sie betrifft 0,1 % der Arbeit. */
  var RD_GRUNDGRUPPEN = [
    { name: "Probebetrieb", token: "--tr-sonst",
      trifft: function (g) { return /probe|test/i.test(g); },
      was: "Probefahrten, Probestarts, Testfahrten, Funktionstests. Geplanter "
        + "Betrieb, kein Eingriff im Notfall." },
    { name: "Countertrade an der Grenze", token: "--teal",
      trifft: function (g) { return /countertrade/i.test(g); },
      was: "Gegengeschäft über eine Kuppelstelle statt eines Eingriffs an einer "
        + "Anlage im Inland." },
    { name: "Spannungshaltung", token: "--violett",
      trifft: function (g) { return /spannung/i.test(g); },
      was: "Die Spannung im Netz läuft aus dem Band, nicht die Leistung über "
        + "eine Grenze." },
    { name: "Netzengpass", token: "--orange",
      trifft: function () { return true; },
      was: "Strombedingter Redispatch: das Netz trägt den geplanten Transport "
        + "nicht. Das ist der Regelfall." }
  ];

  /* Die Stunde mit den meisten bzw. wenigsten laufenden Massnahmen. Zwei
     kleine Funktionen statt einer Schleife an drei Stellen. */
  function spitzenstunde(reihe) {
    var i = 0;
    for (var h = 1; h < 24; h++) { if (reihe[h] > reihe[i]) { i = h; } }
    return i;
  }
  function tiefststunde(reihe) {
    var i = 0;
    for (var h = 1; h < 24; h++) { if (reihe[h] < reihe[i]) { i = h; } }
    return i;
  }

  function rdGruppe(grund) {
    for (var i = 0; i < RD_GRUNDGRUPPEN.length; i++) {
      if (RD_GRUNDGRUPPEN[i].trifft(grund)) { return RD_GRUNDGRUPPEN[i]; }
    }
    return RD_GRUNDGRUPPEN[RD_GRUNDGRUPPEN.length - 1];
  }

  /* Wer die Massnahme angefordert hat. Die Quelle nennt teils mehrere
     zugleich ("50Hertz & Amprion & TenneT DE & TransnetBW") und teils
     auslaendische Betreiber. Beides wird NICHT aufgeloest -- eine Aufteilung
     der Arbeit auf mehrere Anforderer waere geraten. Stattdessen wird die
     Zeichenkette als Ganzes gezaehlt und nur danach sortiert, ob ein
     auslaendischer Betreiber darin vorkommt. */
  var RD_AUSLAND = /RTE|APG|swissgrid|CEPS|Statnett|EnDK|TenneT NL/i;

  function redispatch(von, bis) {
    var gesamt = 0, hoch = 0, runter = 0, massnahmen = 0;
    var jeUenb = {}, jeArt = {}, mitMassnahme = 0, belegteTage = 0, gefunden = false;
    var jeGrund = {}, jeGruppe = {}, jeAnfordernd = {}, jeDauer = {}, ausland = 0;
    /* Zeitprofil: je Stunde des Tages die Summe der laufenden Massnahmen ueber
       alle Tage (stunden) und die Zahl der Tage, an denen in dieser Stunde
       ueberhaupt eine lief (stundenTage). Beides wird gebraucht: die erste
       Reihe sagt WIE VIEL, die zweite WIE OFT. Ein hoher Mittelwert aus wenigen
       Tagen mit vielen Massnahmen sieht sonst aus wie Dauerbetrieb. */
    var stunden = [], stundenTage = [], stundenDauer = [];
    for (var si = 0; si < 24; si++) {
      stunden.push(0); stundenTage.push(0); stundenDauer.push(0);
    }
    /* Dieselbe Zaehlung, aufgegliedert. Die Schluessel bleiben der Wortlaut
       der Quelle; zu Gruppen zusammengefasst wird erst beim Zeichnen. */
    var stdGruppe = {}, stdUenb = {}, stdArt = {}, stdHoch = [], stdRunter = [];
    for (var sj = 0; sj < 24; sj++) { stdHoch.push(0); stdRunter.push(0); }
    function reihe24(karte, schluessel) {
      if (!karte[schluessel]) {
        karte[schluessel] = [];
        for (var q = 0; q < 24; q++) { karte[schluessel].push(0); }
      }
      return karte[schluessel];
    }
    tageImZeitraum(von, bis).forEach(function (tag) {
      if (tag < REDISPATCH_AB) { return; }
      var d = Z.redispatch[Number(tag.slice(0, 4))];
      if (!d) { return; }
      belegteTage++;
      var t = d.tage[tag];
      if (!t) { return; }        // Tag ohne Massnahme: zaehlt als Null
      gefunden = true;
      mitMassnahme++;
      gesamt += t.gesamt_mwh;
      hoch += t.erhoehen_mwh;
      runter += t.reduzieren_mwh;
      massnahmen += t.massnahmen;
      Object.keys(t.je_uenb).forEach(function (u) {
        jeUenb[u] = (jeUenb[u] || 0) + t.je_uenb[u];
      });
      Object.keys(t.je_energieart).forEach(function (a) {
        jeArt[a] = (jeArt[a] || 0) + t.je_energieart[a];
      });
      Object.keys(t.je_grund || {}).forEach(function (g) {
        jeGrund[g] = (jeGrund[g] || 0) + t.je_grund[g];
        var name = rdGruppe(g).name;
        jeGruppe[name] = (jeGruppe[name] || 0) + t.je_grund[g];
      });
      Object.keys(t.je_anfordernd || {}).forEach(function (a) {
        jeAnfordernd[a] = (jeAnfordernd[a] || 0) + t.je_anfordernd[a];
        if (RD_AUSLAND.test(a)) { ausland += t.je_anfordernd[a]; }
      });
      Object.keys(t.dauer_stunden || {}).forEach(function (d) {
        jeDauer[d] = (jeDauer[d] || 0) + t.dauer_stunden[d];
      });
      var ajs = t.aktive_je_stunde;
      if (ajs) {
        for (var h = 0; h < 24; h++) {
          stunden[h] += ajs[h];
          if (ajs[h]) { stundenTage[h]++; }
          if (t.stunden_dauer_h) { stundenDauer[h] += t.stunden_dauer_h[h]; }
        }
        Object.keys(t.stunden_je_grund || {}).forEach(function (g) {
          var ziel = reihe24(stdGruppe, rdGruppe(g).name), q = t.stunden_je_grund[g];
          for (var h2 = 0; h2 < 24; h2++) { ziel[h2] += q[h2]; }
        });
        Object.keys(t.stunden_je_uenb || {}).forEach(function (u) {
          var ziel = reihe24(stdUenb, u), q = t.stunden_je_uenb[u];
          for (var h3 = 0; h3 < 24; h3++) { ziel[h3] += q[h3]; }
        });
        Object.keys(t.stunden_je_energieart || {}).forEach(function (a) {
          var ziel = reihe24(stdArt, a), q = t.stunden_je_energieart[a];
          for (var h4 = 0; h4 < 24; h4++) { ziel[h4] += q[h4]; }
        });
        if (t.stunden_richtung) {
          for (var h5 = 0; h5 < 24; h5++) {
            stdHoch[h5] += t.stunden_richtung.hoch[h5];
            stdRunter[h5] += t.stunden_richtung.runter[h5];
          }
        }
      }
    });
    if (!gefunden) { return null; }
    return { gesamt: gesamt, hoch: hoch, runter: runter, massnahmen: massnahmen,
             jeUenb: jeUenb, jeArt: jeArt, tageMitMassnahme: mitMassnahme,
             belegteTage: belegteTage, jeGrund: jeGrund, jeGruppe: jeGruppe,
             jeAnfordernd: jeAnfordernd, jeDauer: jeDauer, ausland: ausland,
             stunden: stunden, stundenTage: stundenTage,
             stundenDauer: stundenDauer, stdGruppe: stdGruppe, stdUenb: stdUenb,
             stdArt: stdArt, stdHoch: stdHoch, stdRunter: stdRunter };
  }

  var QUELLE_RD = [
    { text: "netztransparenz.de — 50Hertz, Amprion, TenneT, TransnetBW",
      url: "https://www.netztransparenz.de/de-de/Systemdienstleistungen/Betriebsfuehrung/Redispatch" },
    { text: "ENTSO-E Transparency Platform", url: "https://transparency.entsoe.eu/" }
  ];

  function redispatchAbschnitt(von, bis, netzlast) {
    var r = redispatch(von, bis);
    var huelle = el("div", { "class": "pf-verlauf" });
    if (!r) {
      huelle.appendChild(el("p", { "class": "pf-laden",
        text: von < REDISPATCH_AB
          ? "Für Zeiträume vor 2021 liegen keine Redispatch-Daten vor — die Quelle "
            + "beginnt am 01.01.2021."
          : "Für diesen Zeitraum liegen keine Redispatch-Daten vor." }));
      return huelle;
    }

    var kopfzeile = el("div", { "class": "pf-rd-kopf" });
    [["Gesamt", gwh(r.gesamt, 1), "violett"],
     ["Hochgefahren", gwh(r.hoch, 1), "teal"],
     ["Heruntergefahren", gwh(r.runter, 1), "orange"]].forEach(function (k) {
      var b = el("div", { "class": "pf-rd-zahl", "data-akzent": k[2] });
      b.appendChild(el("span", { "class": "pf-titel", text: k[0] }));
      var w = el("p", { "class": "pf-wert", text: k[1] });
      w.appendChild(el("span", { "class": "pf-einheit", text: "GWh" }));
      b.appendChild(w);
      kopfzeile.appendChild(b);
    });
    huelle.appendChild(kopfzeile);

    huelle.appendChild(el("p", { "class": "pf-bezug",
      text: r.massnahmen.toLocaleString("de-DE") + " Maßnahmen an "
        + r.tageMitMassnahme + " von " + r.belegteTage + " Tagen"
        + (netzlast ? " · entspricht " + nf2.format(r.gesamt / netzlast * 100)
            + " % der Netzlast im Zeitraum" : "") }));

    function balken(titel, werte, farbe) {
      var box = el("div", { "class": "pf-rd-gruppe" });
      box.appendChild(el("h4", { text: titel }));
      var namen = Object.keys(werte).sort(function (a, b) { return werte[b] - werte[a]; });
      var max = werte[namen[0]] || 1;
      namen.forEach(function (n) {
        if (!werte[n]) { return; }
        var h = el("div", { "class": "pf-balken" });
        var z = el("div", { "class": "pf-zeile" });
        z.appendChild(el("span", { "class": "pf-name", text: n }));
        z.appendChild(el("span", { "class": "pf-zahl",
          text: gwh(werte[n], 1) + " GWh · " + nf1.format(werte[n] / r.gesamt * 100) + " %" }));
        h.appendChild(z);
        var schiene = el("div", { "class": "pf-schiene" });
        schiene.appendChild(el("div", { "class": "pf-fuellung",
          style: "width:" + (werte[n] / max * 100).toFixed(1) + "%;background:" + farbe + ";" }));
        h.appendChild(schiene);
        box.appendChild(h);
      });
      return box;
    }

    /* WANN UND WARUM -- ein Block statt zweier.

       Vorher standen hier zwei getrennte Kaesten: ein Streifen mit den
       Gruenden und darueber ein Zeitprofil aus 24 grauen Saeulen. Das
       Zeitprofil sagte nur "mittags mehr als nachts" und beantwortete keine
       einzige Anschlussfrage; beim Zeigen kam der Text des title-Attributs und
       sonst nichts. Beides ist jetzt dieselbe Grafik: die Saeule zeigt, WIE
       VIELE Massnahmen zu dieser Tageszeit gleichzeitig liefen, ihre Farbe
       WARUM, und beim Zeigen oeffnet sich eine echte Ablesung mit Richtung,
       anweisendem Betreiber, betroffener Erzeugungsart und mittlerer Dauer.
       Die Gruppenliste darunter ist zugleich die Legende.

       Was hier bewusst NICHT steht, ist Arbeit je Stunde. Die Quelle nennt je
       Massnahme eine Gesamtarbeit und ein Fenster, nicht den Verlauf darin;
       sie gleichmaessig zu verteilen waere eine Annahme, die bei 253 von 1.187
       geprueften Saetzen nachweislich nicht traegt. "Aktiv oder nicht" ist
       ohne jede Annahme ablesbar.

       Was die Quelle gar nicht hat: eine Stufe oder Prioritaet der Massnahme,
       und einen Ort der betroffenen Anlage. Das WO wird deshalb ueber den
       anweisenden Betreiber beantwortet -- das ist die Regelzone und damit die
       einzige belegbare Antwort. */
    var gruppen = RD_GRUNDGRUPPEN.filter(function (g) { return r.jeGruppe[g.name]; })
      .sort(function (a, b) { return r.jeGruppe[b.name] - r.jeGruppe[a.name]; });
    var maxStd = Math.max.apply(null, r.stunden);
    if (gruppen.length) {
      var gkasten = el("div", { "class": "pf-rd-gruende" });
      gkasten.appendChild(el("h4", { text: "Wann und warum eingegriffen wurde" }));

      if (r.belegteTage && maxStd > 0) {
        var mittel = function (x) { return x / r.belegteTage; };
        var hoechst = mittel(maxStd);
        var rahmen = el("div", { "class": "pf-rd-rahmen" });

        var achseY = el("div", { "class": "pf-rd-achse-y" });
        [1, 0.5, 0].forEach(function (f) {
          achseY.appendChild(el("span", { text: nf1.format(hoechst * f) }));
        });
        rahmen.appendChild(achseY);

        var flaeche = el("div", { "class": "pf-rd-flaeche",
          tabindex: "0", role: "group",
          "aria-label": "Zeitprofil der Redispatch-Maßnahmen über 24 Stunden. "
            + "Mit den Pfeiltasten die Stunde wechseln." });
        [0.5, 1].forEach(function (f) {
          flaeche.appendChild(el("i", { "class": "pf-rd-hilfslinie",
            style: "bottom:" + (f * 100) + "%;" }));
        });

        var spalten24 = [];
        for (var h = 0; h < 24; h++) {
          var spalte = el("div", { "class": "pf-rd-spalte" });
          var stapel = el("div", { "class": "pf-rd-stapel",
            style: "height:" + (r.stunden[h] / maxStd * 100).toFixed(1) + "%;" });
          /* Stapelreihenfolge fest: der Regelfall unten, das Seltene oben.
             Sie folgt der Arbeit im Zeitraum und nicht der Stunde -- sonst
             taenzelten die Farben von Saeule zu Saeule. */
          gruppen.forEach(function (g) {
            var reiheG = r.stdGruppe[g.name];
            var n = reiheG ? reiheG[h] : 0;
            if (!n || !r.stunden[h]) { return; }
            stapel.appendChild(el("i", { "class": "pf-rd-teil",
              style: "height:" + (n / r.stunden[h] * 100).toFixed(2) + "%;"
                + "background:var(" + g.token + ");" }));
          });
          spalte.appendChild(stapel);
          flaeche.appendChild(spalte);
          spalten24.push(spalte);
        }

        /* Die Ablesung. Ein eigenes Element, kein title-Attribut: dort steht
           eine Zeile ohne Zeilenumbruch, ohne Farbe und ohne Tastaturzugang,
           und sie kam obendrein erst nach einer Sekunde. */
        var info = el("div", { "class": "pf-rd-info", role: "status", hidden: "hidden" });
        flaeche.appendChild(info);

        function zeile(dl, name, wert, token) {
          var dt2 = el("dt");
          if (token) { dt2.appendChild(el("i", { style: "background:var(" + token + ");" })); }
          dt2.appendChild(document.createTextNode(name));
          dl.appendChild(dt2);
          dl.appendChild(el("dd", { text: wert }));
        }

        function anteilszeile(dl, karte, stunde, titelToken) {
          var namen = Object.keys(karte).filter(function (k) {
            return karte[k][stunde];
          }).sort(function (a, b) { return karte[b][stunde] - karte[a][stunde]; });
          namen.forEach(function (n) {
            zeile(dl, n, nf1.format(mittel(karte[n][stunde])) + " · "
              + nf0.format(karte[n][stunde] / r.stunden[stunde] * 100) + " %",
              titelToken ? titelToken(n) : null);
          });
        }

        var aktiv = -1;
        function zeigen(stunde) {
          if (stunde < 0 || stunde > 23 || !r.stunden[stunde]) { return; }
          if (aktiv >= 0) { spalten24[aktiv].removeAttribute("data-aktiv"); }
          aktiv = stunde;
          spalten24[aktiv].setAttribute("data-aktiv", "ja");
          info.innerHTML = "";
          info.appendChild(el("p", { "class": "pf-rd-info-uhr",
            text: zwei(stunde) + ":00 bis " + zwei((stunde + 1) % 24) + ":00 Uhr" }));
          var wert = el("p", { "class": "pf-rd-info-wert",
            text: nf1.format(mittel(r.stunden[stunde])) });
          wert.appendChild(el("span", { text: "Maßnahmen gleichzeitig, im Mittel" }));
          info.appendChild(wert);
          info.appendChild(el("p", { "class": "pf-bezug",
            text: "an " + nf0.format(r.stundenTage[stunde]) + " von "
              + nf0.format(r.belegteTage) + " Tagen lief in dieser Stunde "
              + "mindestens eine · sie dauerten im Mittel "
              + nf1.format(r.stundenDauer[stunde] / r.stunden[stunde])
              + " Stunden insgesamt" }));

          var dl = el("dl", { "class": "pf-rd-info-liste" });
          dl.appendChild(el("dt", { "class": "pf-rd-info-titel", text: "Warum" }));
          dl.appendChild(el("dd", { "class": "pf-rd-info-titel" }));
          anteilszeile(dl, r.stdGruppe, stunde, function (name) {
            var g = RD_GRUNDGRUPPEN.filter(function (x) { return x.name === name; })[0];
            return g ? g.token : null;
          });
          dl.appendChild(el("dt", { "class": "pf-rd-info-titel", text: "Richtung" }));
          dl.appendChild(el("dd", { "class": "pf-rd-info-titel" }));
          zeile(dl, "hochgefahren", nf1.format(mittel(r.stdHoch[stunde])) + " · "
            + nf0.format(r.stdHoch[stunde] / r.stunden[stunde] * 100) + " %", "--teal");
          zeile(dl, "heruntergefahren", nf1.format(mittel(r.stdRunter[stunde])) + " · "
            + nf0.format(r.stdRunter[stunde] / r.stunden[stunde] * 100) + " %", "--orange");
          dl.appendChild(el("dt", { "class": "pf-rd-info-titel",
            text: "Angewiesen von — die Regelzone" }));
          dl.appendChild(el("dd", { "class": "pf-rd-info-titel" }));
          anteilszeile(dl, r.stdUenb, stunde);
          dl.appendChild(el("dt", { "class": "pf-rd-info-titel",
            text: "Betroffene Erzeugung" }));
          dl.appendChild(el("dd", { "class": "pf-rd-info-titel" }));
          anteilszeile(dl, r.stdArt, stunde);
          info.appendChild(dl);

          /* Rand halten: an den ersten und letzten Stunden wuerde die Ablesung
             sonst aus dem Bild laufen. */
          info.removeAttribute("hidden");
          info.style.left = stunde < 12 ? (stunde / 24 * 100) + "%" : "auto";
          info.style.right = stunde < 12 ? "auto" : ((23 - stunde) / 24 * 100) + "%";
        }

        function verbergen() {
          if (aktiv >= 0) { spalten24[aktiv].removeAttribute("data-aktiv"); }
          aktiv = -1;
          info.setAttribute("hidden", "hidden");
        }

        spalten24.forEach(function (sp, i) {
          sp.addEventListener("mouseenter", function () { zeigen(i); });
        });
        flaeche.addEventListener("mouseleave", verbergen);
        flaeche.addEventListener("focus", function () {
          if (aktiv < 0) { zeigen(spitzenstunde(r.stunden)); }
        });
        flaeche.addEventListener("blur", verbergen);
        flaeche.addEventListener("keydown", function (ev) {
          if (ev.key === "Escape") { verbergen(); return; }
          var schritt = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
          if (!schritt) { return; }
          ev.preventDefault();
          var naechste = (aktiv < 0 ? spitzenstunde(r.stunden) : aktiv + schritt + 24) % 24;
          zeigen(naechste);
        });

        rahmen.appendChild(flaeche);
        gkasten.appendChild(rahmen);

        var achse = el("div", { "class": "pf-rd-uhr-achse" });
        for (var hb = 0; hb < 24; hb++) {
          achse.appendChild(el("span", { text: hb % 3 === 0 ? zwei(hb) : "" }));
        }
        gkasten.appendChild(achse);

        var spitze = spitzenstunde(r.stunden);
        var tief = tiefststunde(r.stunden);
        gkasten.appendChild(el("p", { "class": "pf-bezug",
          text: "Höhe: gleichzeitig laufende Maßnahmen je Stunde des Tages, "
            + "gemittelt über " + nf0.format(r.belegteTage) + " Tage (Ortszeit). "
            + "Farbe: der Grund. Am meisten um " + zwei(spitze) + ":00 mit "
            + nf1.format(mittel(r.stunden[spitze])) + ", am wenigsten um "
            + zwei(tief) + ":00 mit " + nf1.format(mittel(r.stunden[tief]))
            + ". Zeigen oder mit den Pfeiltasten wählen öffnet die Ablesung. "
            + "Gezählt wird, ob eine Maßnahme in der Stunde lief — nicht, wie "
            + "viel Arbeit auf sie entfiel: die Quelle nennt je Maßnahme eine "
            + "Gesamtarbeit und ein Fenster, keinen Verlauf darin. Eine Stufe "
            + "oder Priorität führt sie nicht, und der Ort der betroffenen "
            + "Anlage lässt sich nicht auflösen — deshalb steht dort, wer "
            + "angewiesen hat." }));
      }

      /* Die Gruppenliste ist jetzt zugleich die Legende der Grafik daruber.
         Sie fuehrt die ARBEIT in GWh -- die Grafik zaehlt Massnahmen. Zwei
         verschiedene Groessen, und deswegen stehen beide da: der Probebetrieb
         ist nach Zahl der Massnahmen sichtbar, nach Arbeit aber klein. */
      var streifen = el("div", { "class": "pf-rd-streifen" });
      gruppen.forEach(function (g) {
        var anteil = r.jeGruppe[g.name] / r.gesamt * 100;
        streifen.appendChild(el("span", {
          style: "width:" + anteil.toFixed(2) + "%;background:var(" + g.token + ");",
          title: g.name + ": " + gwh(r.jeGruppe[g.name], 1) + " GWh · "
            + nf1.format(anteil) + " %"
        }));
      });
      gkasten.appendChild(el("p", { "class": "pf-gruppentitel",
        text: "Dieselben Gründe nach Arbeit — die Grafik oben zählt Maßnahmen" }));
      gkasten.appendChild(streifen);
      var gliste = el("div", { "class": "pf-rd-grundliste" });
      gruppen.forEach(function (g) {
        var z = el("div", { "class": "pf-rd-grund" });
        var kopf2 = el("div", { "class": "pf-zeile" });
        var name = el("span", { "class": "pf-name" });
        name.appendChild(el("i", { style: "background:var(" + g.token + ");" }));
        name.appendChild(document.createTextNode(g.name));
        kopf2.appendChild(name);
        kopf2.appendChild(el("span", { "class": "pf-zahl",
          text: gwh(r.jeGruppe[g.name], 1) + " GWh · "
            + nf1.format(r.jeGruppe[g.name] / r.gesamt * 100) + " %" }));
        z.appendChild(kopf2);
        z.appendChild(el("p", { "class": "pf-bezug", text: g.was }));
        // Der Wortlaut der Quelle, damit die Einteilung nachvollziehbar ist.
        var roh = Object.keys(r.jeGrund).filter(function (x) {
          return rdGruppe(x).name === g.name && r.jeGrund[x];
        }).sort(function (a, b) { return r.jeGrund[b] - r.jeGrund[a]; });
        z.appendChild(el("p", { "class": "pf-rd-roh",
          text: "In der Quelle: " + roh.join(" · ") }));
        gliste.appendChild(z);
      });
      gkasten.appendChild(gliste);
      var probe = r.jeGruppe["Probebetrieb"] || 0;
      gkasten.appendChild(el("p", { "class": "pf-karte-warnung",
        text: probe
          ? "Der Probebetrieb ist kein Notfall. " + gwh(probe, 1) + " GWh — "
            + nf1.format(probe / r.gesamt * 100) + " % der Arbeit in diesem "
            + "Zeitraum — entfallen auf angemeldete Probefahrten, Probestarts, "
            + "Testfahrten und Funktionstests. Wer die Redispatch-Menge als Maß "
            + "für Netzstress liest, muss diesen Teil abziehen."
          : "In diesem Zeitraum gab es keinen Probebetrieb; die gesamte Arbeit "
            + "entfällt auf Eingriffe." }));
      huelle.appendChild(gkasten);
    }

    var spalten2 = el("div", { "class": "pf-rd-spalten" });
    /* WER ANGEFORDERT HAT gegen WER ANGEWIESEN HAT. Die Quelle fuehrt beides
       getrennt, und es ist nicht dasselbe: angewiesen hat immer einer der vier
       deutschen Betreiber, angefordert haben teils mehrere zugleich und teils
       auslaendische. Mehrfachnennungen werden NICHT aufgeteilt -- welcher
       Anteil auf wen entfaellt, sagt die Quelle nicht. */
    if (Object.keys(r.jeAnfordernd).length) {
      var top = Object.keys(r.jeAnfordernd)
        .sort(function (a, b) { return r.jeAnfordernd[b] - r.jeAnfordernd[a]; });
      var gezeigt = {};
      var rest = 0;
      top.forEach(function (a, i) {
        if (i < 8) { gezeigt[a] = r.jeAnfordernd[a]; } else { rest += r.jeAnfordernd[a]; }
      });
      if (rest) { gezeigt["übrige " + (top.length - 8) + " Anforderer"] = rest; }
      spalten2.appendChild(balken("Angefordert von", gezeigt, "var(--gruen)"));
    }
    if (Object.keys(r.jeDauer).length) {
      var dsort = {};
      ["bis 1 h", "1 bis 4 h", "4 bis 12 h", "ueber 12 h"].forEach(function (k) {
        if (r.jeDauer[k]) { dsort[k === "ueber 12 h" ? "über 12 h" : k] = r.jeDauer[k]; }
      });
      spalten2.appendChild(balken("Dauer der Maßnahme", dsort, "var(--violett)"));
    }
    if (spalten2.childNodes.length) { huelle.appendChild(spalten2); }

    if (r.ausland) {
      huelle.appendChild(el("p", { "class": "pf-bezug",
        text: "Auf Anforderung eines ausländischen Betreibers: "
          + gwh(r.ausland, 1) + " GWh · " + nf1.format(r.ausland / r.gesamt * 100)
          + " % der Arbeit. In der Quelle stehen unter anderem RTE (Frankreich), "
          + "APG (Österreich), swissgrid, CEPS (Tschechien), Statnett (Norwegen), "
          + "TenneT NL und Energinet. Deutschland greift also auch dann ein, wenn "
          + "das Problem nicht im eigenen Netz liegt. Bei Mehrfachnennungen zählt "
          + "die ganze Maßnahme — die Quelle sagt nicht, welcher Anteil auf wen "
          + "entfällt." }));
    }

    var spalten = el("div", { "class": "pf-rd-spalten" });
    spalten.appendChild(balken("Angewiesen von", r.jeUenb, "var(--violett)"));
    spalten.appendChild(balken("Betroffene Erzeugung", r.jeArt, "var(--teal)"));
    huelle.appendChild(spalten);

    huelle.appendChild(el("p", { "class": "pf-karte-warnung",
      text: "Redispatch heißt im Regelfall: ein Netzbetreiber greift in den "
        + "Kraftwerkseinsatz ein, weil das Netz den geplanten Transport nicht trägt. "
        + "Nicht jede Maßnahme ist das — siehe die Aufgliederung oben. "
        + "Es sagt, WO das Netz an "
        + "seine Grenze kommt — nicht, wie viel Strom über eine einzelne Leitung "
        + "fließt. Das wird nach § 23c Abs. 2 EnWG nicht veröffentlicht." }));

    infoKnopf(huelle, {
      wert: "Summe der Tagesaggregate aus " + r.massnahmen.toLocaleString("de-DE")
        + " einzelnen Maßnahmen. Summiert wird das Feld GESAMTE_ARBEIT_MWH.",
      grenzenTitel: "Zwei Dinge, die man wissen muss",
      grenzen: "Erstens: die mittlere Leistung einer Maßnahme ist der Mittelwert über "
        + "die tatsächlich aktive Zeit, nicht über das genannte Fenster — die Quelle "
        + "dokumentiert das selbst. Wer Leistung mal Dauer rechnet, überschätzt "
        + "erheblich. Zweitens: eine Maßnahme zählt zum Tag ihres Beginns. Im August "
        + "2026 lagen 22,2 % der Arbeit in Maßnahmen über Mitternacht. Die Quelle "
        + "liefert UTC; hier ist auf Ortszeit umgerechnet. Die Reihe beginnt 2021.",
      quellen: QUELLE_RD,
      messung: "Messung. Die Zuordnung zum Kalendertag ist eine benannte Annahme, "
        + "ihre Größe steht in data/redispatch/<jahr>.json."
    }, "Redispatch");
    return huelle;
  }

  // ---- CSV-Export ---------------------------------------------------------
  // Wird aus dem gewaehlten Zeitraum erzeugt, damit der Abzug immer zu dem
  // passt, was auf der Seite steht.

  function csvBauen(von, bis) {
    var k = kennzahlen(von, bis);
    var vv = vorjahrstag(von), vb = vorjahrstag(bis);
    var v = kennzahlen(vv, vb) || {};
    var z = [
      "# PowerFlow -- Bilanz des deutschen Stromsystems",
      "# Zeitraum (Ortszeit Europe/Berlin): " + von + " bis " + bis
        + " (" + k.tage + " Kalendertage, " + k.belegt + " mit Daten)",
      "# Vergleichszeitraum: " + vv + " bis " + vb + " -- derselbe Zeitraum ein Jahr",
      "#   frueher, reale Messwerte, kein Monatsmittel und keine geglaettete Kurve",
      "# Quelle: SMARD, Bundesnetzagentur -- https://www.smard.de/",
      "# Lizenz: CC BY 4.0",
      "# Namensnennung: Bundesnetzagentur | SMARD.de",
      "# Erzeugt: " + new Date().toLocaleString("de-DE"),
      "#",
      "# Einheit: MWh. Die SMARD-Reihen liefern eine Energiemenge je Intervall,",
      "# keine mittlere Leistung. Nachgewiesen aus den Daten selbst: der",
      "# Stundenwert ist die Summe der vier Viertelstundenwerte.",
      "#",
      "# Zahlformat: Diese Datei ist maschinenlesbar und benutzt den PUNKT als",
      "# Dezimaltrennzeichen. Die Anzeige auf der Seite ist deutsch formatiert",
      "# (Tausenderpunkt, Dezimalkomma). Das ist kein Fehler, sondern derselbe",
      "# Wert in zwei Schreibweisen.",
      "#",
      "# Rechenwege:",
      "#   aussensaldo = import - export",
      "#   bilanzrest  = erzeugung + aussensaldo - netzlast",
      "#   zonensaldo  = erzeugung(zone) - netzlast(zone)",
      "# Der Zonensaldo ist der Austausch der Zone mit ALLEM -- anderen",
      "# Regelzonen UND Ausland. Er ist kein Fluss von einer Zone in eine andere;",
      "# solche Fluesse werden nicht veroeffentlicht.",
      "#",
      "# Freie Variable ist der dargestellte Zeitraum. Alles Uebrige ist gemessen.",
      "#",
      "gruppe,name,von,bis,wert_mwh,vergleich_von,vergleich_bis,wert_mwh_vorjahr"
    ];
    function zeile(gruppe, name, a, b) {
      z.push([gruppe, name, von, bis, (a === null || a === undefined) ? "" : a.toFixed(2),
              vv, vb, (b === null || b === undefined) ? "" : b.toFixed(2)].join(","));
    }
    zeile("kennzahl", "netzlast", k.netzlast, v.netzlast);
    zeile("kennzahl", "erzeugung", k.erzeugung, v.erzeugung);
    zeile("kennzahl", "residuallast", k.residuallast, v.residuallast);
    zeile("kennzahl", "pumpspeicherverbrauch", k.pumpen, v.pumpen);
    zeile("kennzahl", "import", k.imp, v.imp);
    zeile("kennzahl", "export", k.exp, v.exp);
    zeile("kennzahl", "aussensaldo", k.saldo, v.saldo);
    zeile("kennzahl", "bilanzrest", k.rest, v.rest);
    var tv = {};
    traeger(vv, vb).forEach(function (e) { tv[e.name] = e.mwh; });
    traeger(von, bis).forEach(function (e) { zeile("erzeugung", e.name, e.mwh, tv[e.name]); });
    var zv = {};
    zonen(vv, vb).forEach(function (e) { zv[e.zone] = e; });
    zonen(von, bis).forEach(function (e) {
      zeile("regelzone_netzlast", e.zone, e.netzlast, zv[e.zone] && zv[e.zone].netzlast);
      zeile("regelzone_erzeugung", e.zone, e.erzeugung, zv[e.zone] && zv[e.zone].erzeugung);
      zeile("regelzone_saldo", e.zone, e.saldo, zv[e.zone] && zv[e.zone].saldo);
    });
    var lv = {};
    laender(vv, vb).forEach(function (e) { lv[e.land] = e; });
    laender(von, bis).forEach(function (e) {
      zeile("import", e.land, e.imp, lv[e.land] && lv[e.land].imp);
      zeile("export", e.land, e.exp, lv[e.land] && lv[e.land].exp);
    });
    return z.join("\n") + "\n";
  }

  function csvHerunterladen(von, bis) {
    var blob = new Blob([csvBauen(von, bis)], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url,
      download: "powerflow-" + (von === bis ? von : von + "_bis_" + bis) + ".csv" });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---- Zeichnen -----------------------------------------------------------

  function zeichnen() {
    var von = Z.von, bis = Z.bis;
    var k = kennzahlen(von, bis);
    var vv = vorjahrstag(von), vb = vorjahrstag(bis);
    var v = kennzahlen(vv, vb) || {};
    var einTag = von === bis;
    var neu = el("div", { "class": "pf-huelle" });

    // --- Kopf ---
    var kopf = el("header", { "class": "pf-kopf" });
    var kopfzeile = el("div", { "class": "pf-kopfzeile" });
    var links = el("div");
    links.appendChild(el("h1", { text: "Deutschland · Stromfluss-Labor" }));
    links.appendChild(el("p", {
      "class": "pf-unterzeile",
      text: "Bilanz des deutschen Stromsystems · " + zeitraumLang(von, bis)
        + ". Alle Zahlen sind gemessen."
    }));
    links.appendChild(el("p", { "class": "pf-bahn", text: "Zufluss · Netz · Abfluss" }));
    kopfzeile.appendChild(links);
    kopf.appendChild(kopfzeile);
    neu.appendChild(kopf);

    // --- Der einzige Regler: der Zeitraum ---
    var regler = el("div", { "class": "pf-regler" });
    var reglerKopf = el("div", { "class": "pf-regler-kopf" });
    // Titel und Info-Knopf gehoeren zusammen; der Themaknopf steht rechts.
    var reglerTitel = el("div", { "class": "pf-regler-titelzeile" });
    reglerTitel.appendChild(el("span", { "class": "pf-regler-titel", text: "Zeitraum" }));
    reglerKopf.appendChild(reglerTitel);
    /* Der Themaknopf sitzt hier und nicht mehr in der Kopfzeile: der
       Zeitraumblock bleibt beim Scrollen oben stehen, der Kopf nicht. Ein
       Knopf, der weggescrollt ist, ist kein Knopf. */
    var themaKnopf = el("button", {
      "class": "pf-thema-knopf", type: "button",
      "aria-label": "Zwischen hellem und dunklem Schema wechseln", text: "Hell / Dunkel"
    });
    themaKnopf.addEventListener("click", function () {
      var jetzt = document.documentElement.getAttribute("data-thema");
      var hell = jetzt === "hell"
        || (!jetzt && window.matchMedia("(prefers-color-scheme: light)").matches);
      document.documentElement.setAttribute("data-thema", hell ? "dunkel" : "hell");
    });
    reglerKopf.appendChild(themaKnopf);
    regler.appendChild(reglerKopf);

    var reihe = el("div", { "class": "pf-regler-reihe" });
    var zurueckKnopf = el("button", { "class": "pf-schritt", type: "button",
      "aria-label": "Einen Zeitraum zurück", text: "‹" });
    var feldVon = el("input", { "class": "pf-tagfeld", type: "date", id: "pf-von",
      value: von, min: Z.minTag, max: Z.maxTag, "aria-label": "Erster Tag" });
    var feldBis = el("input", { "class": "pf-tagfeld", type: "date", id: "pf-bis",
      value: bis, min: Z.minTag, max: Z.maxTag, "aria-label": "Letzter Tag" });
    var vorKnopf = el("button", { "class": "pf-schritt", type: "button",
      "aria-label": "Einen Zeitraum vor", text: "›" });
    var laenge = k ? k.tage : 1;
    zurueckKnopf.disabled = von <= Z.minTag;
    vorKnopf.disabled = bis >= Z.maxTag;
    zurueckKnopf.addEventListener("click", function () {
      zeitraumSetzen(verschoben(von, -laenge), verschoben(bis, -laenge));
    });
    vorKnopf.addEventListener("click", function () {
      zeitraumSetzen(verschoben(von, laenge), verschoben(bis, laenge));
    });
    function ausFeldern() {
      if (feldVon.value && feldBis.value) { zeitraumSetzen(feldVon.value, feldBis.value); }
    }
    feldVon.addEventListener("change", ausFeldern);
    feldBis.addEventListener("change", ausFeldern);
    reihe.appendChild(zurueckKnopf);
    reihe.appendChild(feldVon);
    reihe.appendChild(el("span", { "class": "pf-bis", text: "bis" }));
    reihe.appendChild(feldBis);
    reihe.appendChild(vorKnopf);
    var zurueck = el("button", { "class": "pf-zuruecksetzen", type: "button",
      text: "Zurücksetzen" });
    zurueck.disabled = von === Z.startVon && bis === Z.startBis;
    zurueck.addEventListener("click", function () {
      zeitraumSetzen(Z.startVon, Z.startBis);
    });
    reihe.appendChild(zurueck);
    regler.appendChild(reihe);

    // Schnellwahl. Sie setzt nur denselben Regler -- keine zweite Variable.
    var schnell = el("div", { "class": "pf-schnellwahl" });
    [
      ["Letzter Tag", function () { return [Z.maxTag, Z.maxTag]; }],
      ["Letzte 7 Tage", function () { return [verschoben(Z.maxTag, -6), Z.maxTag]; }],
      ["Letzte 30 Tage", function () { return [verschoben(Z.maxTag, -29), Z.maxTag]; }],
      ["Dieser Monat", function () {
        return [Z.maxTag.slice(0, 8) + "01", Z.maxTag]; }],
      ["Voriger Monat", function () {
        var d = ausIso(Z.maxTag.slice(0, 8) + "01");
        var a = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        var b = new Date(d.getFullYear(), d.getMonth(), 0);
        return [nachIso(a), nachIso(b)]; }],
      ["Dieses Jahr", function () {
        return [Z.maxTag.slice(0, 4) + "-01-01", Z.maxTag]; }]
    ].forEach(function (w) {
      var kn = el("button", { "class": "pf-schnell", type: "button", text: w[0] });
      var ziel = w[1]();
      if (ziel[0] === von && ziel[1] === bis) { kn.setAttribute("data-aktiv", "1"); }
      kn.addEventListener("click", function () {
        var z2 = w[1]();
        zeitraumSetzen(z2[0], z2[1]);
      });
      schnell.appendChild(kn);
    });
    regler.appendChild(schnell);
    /* Die Erlaeuterung steckt im Info-Knopf neben dem Titel und nicht mehr als
       Absatz darunter. Der Block bleibt beim Scrollen oben stehen -- vier
       Zeilen Text, die man einmal liest, kosten dort dauerhaft Hoehe. Der
       Inhalt ist derselbe, er ist nur einen Zeiger weit entfernt. */
    infoKnopf(reglerTitel, {
      wert: "Der Zeitraum ist die einzige freie Variable dieser Seite. Alles Übrige "
        + "kommt aus der Messung — es gibt keinen zweiten Regler.",
      grenzenTitel: "Wählbar und Darstellung",
      grenzen: "Wählbar vom " + datumLang(Z.minTag) + " bis zum " + datumLang(Z.maxTag)
        + ". Ein einzelner Tag wird stündlich gezeigt, ein längerer Zeitraum "
        + "tageweise: eine Woche sind 168 Punkte und noch gut zu lesen, ein Monat in "
        + "Stundenwerten wäre Kammputz. Zurücksetzen stellt den Zeitraum des ersten "
        + "Seitenaufrufs wieder her.",
      quellen: QUELLE_SMARD,
      messung: "Der Bezugswert ist damit fest: derselbe Zeitraum ein Jahr früher, reale "
        + "Messwerte. Kein Monatsmittel, keine geglättete Kurve."
    }, "Zeitraum");
    /* Ohne Abschnittsueberschrift: der Block traegt seinen Titel selbst, und
       eine zweite Zeile "Freie Variable" darueber kostet nur Hoehe -- die
       fehlt oben, wo der Block stehen bleibt. */
    var reglerBox = el("section", { "class": "pf-abschnitt pf-regler-abschnitt" });
    reglerBox.appendChild(regler);
    neu.appendChild(reglerBox);

    if (!k) {
      neu.appendChild(el("div", { "class": "pf-fehler",
        text: "Für diesen Zeitraum liegen keine Daten vor." }));
      Z.wurzel.parentNode.replaceChild(neu, Z.wurzel);
      Z.wurzel = neu;
      return;
    }

    /* Ein Band GANZ OBEN, wenn Tage fehlen. Der ausfuehrliche Hinweis steht
       weiter unten unter "Hinweise zur Datenlage" -- aber wer die Kacheln
       liest, liest sie zuerst, und eine Summe ueber vier von sieben Tagen ohne
       Warnung daneben ist eine Falschaussage. */
    var lueckeOben = luecken(von, bis);
    if (lueckeOben.tage.length) {
      var band = el("p", { "class": "pf-luecke" });
      band.appendChild(el("strong", { text: lueckeOben.tage.length + " von "
        + k.tage + " Tagen ohne Daten" }));
      band.appendChild(document.createTextNode(
        " — " + lueckeOben.tage.map(datumKurz).join(", ")
        + ". Alle Zahlen auf dieser Seite summieren nur die " + k.belegt
        + " belegten Tage. Woran es liegt, steht unter „Hinweise zur Datenlage“."));
      neu.appendChild(band);
    }

    // --- Kennzahlen ---
    var proTag = einTag ? "" : " · " + gwh(k.netzlast / k.belegt, 1) + " GWh je Tag";
    var kacheln = el("div", { "class": "pf-kacheln" });

    kacheln.appendChild(kachel({
      titel: "Netzlast", wert: gwh(k.netzlast, 1), einheit: "GWh", akzent: "violett",
      bezug: bezugstext(k.netzlast, v.netzlast, vv, vb) + proTag,
      info: {
        wert: "SMARD-Filter 410 „Realisierter Stromverbrauch, Gesamt (Netzlast)“, Region DE, "
          + "summiert über " + k.belegt + " Tage. Gegen die eigene Viertelstundenreihe "
          + "geprüft: Abweichung 0,02 MWh.",
        grenzenTitel: "Was die Zahl umfasst",
        grenzen: "Verbrauch im Netz der allgemeinen Versorgung. Der Pumpspeicherverbrauch ist "
          + "darin enthalten — nachgewiesen daran, dass die Bilanz nur so aufgeht. Nicht "
          + "enthalten ist Strom, den Industriebetriebe selbst erzeugen und selbst verbrauchen.",
        quellen: QUELLE_SMARD,
        messung: "Messung. Der Vergleichswert ist derselbe Zeitraum ein Jahr früher, "
          + "reale Messwerte, keine Annahme."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Erzeugung", wert: gwh(k.erzeugung, 1), einheit: "GWh", akzent: "teal",
      bezug: bezugstext(k.erzeugung, v.erzeugung, vv, vb),
      info: {
        wert: "Summe der zwölf SMARD-Erzeugungsreihen für Region DE über den Zeitraum.",
        grenzenTitel: "Kernenergie",
        grenzen: "Die Reihe für Kernenergie (Filter 1224) endet am 15.04.2023 um 23:45 Uhr. "
          + "Für spätere Zeiträume liefert SMARD HTTP 404, nicht den Wert Null.",
        quellen: QUELLE_SMARD, messung: "Messung. Keine Annahme."
      }
    }));

    /* Anteil der Erneuerbaren. Bezugsgroesse ist die NETZLAST, nicht die
       Erzeugung und nicht der Bruttostromverbrauch. Das ist eine Wahl, und sie
       wird benannt: die amtliche Quote von AGEB und UBA rechnet gegen den
       Bruttostromverbrauch und kommt deshalb auf andere Zahlen. Wer beides
       vergleicht, vergleicht zwei verschiedene Groessen. */
    var eeAnteil = (k.ee === null || !k.netzlast) ? null : k.ee / k.netzlast * 100;
    var eeVorher = (v.ee === null || v.ee === undefined || !v.netzlast)
      ? null : v.ee / v.netzlast * 100;
    kacheln.appendChild(kachel({
      titel: "Erneuerbare", akzent: "gruen",
      wert: eeAnteil === null ? "—" : nf1.format(eeAnteil), einheit: "% der Netzlast",
      bezug: (k.ee === null ? "—" : gwh(k.ee, 1) + " GWh") + " · "
        + (eeVorher === null
            ? "kein Vergleichswert für " + zeitraumKurz(vv, vb) + " vorhanden"
            : nf1.format(eeVorher) + " % im Vorjahreszeitraum · "
              + (eeAnteil >= eeVorher ? "+" : "−")
              + nf1.format(Math.abs(eeAnteil - eeVorher)) + " Prozentpunkte"),
      info: {
        wert: "Summe der sechs erneuerbaren SMARD-Reihen — Wind Onshore, Wind "
          + "Offshore, Photovoltaik, Wasserkraft, Biomasse, Sonstige Erneuerbare — "
          + "geteilt durch die Netzlast desselben Zeitraums, mal 100.",
        grenzenTitel: "Warum diese Zahl nicht die amtliche Quote ist",
        grenzen: "Der Nenner ist hier die Netzlast. Die amtliche Quote von AGEB und "
          + "Umweltbundesamt rechnet gegen den Bruttostromverbrauch und liegt deshalb "
          + "anders. Beide Zahlen sind richtig, sie beantworten verschiedene Fragen. "
          + "Pumpspeicher ist nicht enthalten: das ist ein Speicher, kein Erzeuger, "
          + "und der Strom darin wurde vorher schon einmal gezählt. Werte über 100 % "
          + "sind möglich und kein Fehler — dann wurde mehr erneuerbar erzeugt, als "
          + "im Netz verbraucht wurde, und der Rest ging in den Export.",
        quellen: QUELLE_SMARD,
        messung: "Selbst gerechnet aus gemessenen Größen. Die Formel steht oben; die "
          + "Wahl des Nenners ist eine benannte Festlegung, keine Messung. "
          + "Größenordnungsprobe: dieselbe Formel über ganze Kalenderjahre "
          + "gerechnet ergibt 54,9 % (2023), 55,0 % (2024) und 55,3 % (2025). Ein Abgleich "
          + "gegen die amtliche Quote von AGEE-Stat steht aus — sie rechnet gegen den "
          + "Bruttostromverbrauch und ist deshalb keine Gegenprobe, sondern eine andere Frage."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Import", wert: gwh(k.imp, 1), einheit: "GWh", akzent: "teal",
      bezug: bezugstext(k.imp, v.imp, vv, vb),
      info: {
        wert: "Summe der stündlichen SMARD-Importreihen je Nachbarland (physikalischer "
          + "Stromfluss). Die Reihen sind vorzeichenlos positiv.",
        grenzenTitel: "Auflösung und Beleg",
        grenzen: "Der Außenhandel liegt nur stündlich vor, nicht viertelstündlich. Die "
          + "Filter-IDs stehen in keiner Dokumentation; sie wurden empirisch bestimmt und an "
          + "zwei unabhängigen Wochen gegen Energy-Charts geprüft.",
        quellen: QUELLE_SMARD,
        messung: "Messung. Die Zuordnung der Filter-IDs zu den Ländern ist eine belegte "
          + "Herleitung, keine dokumentierte Zusage der Quelle."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Export", wert: gwh(k.exp, 1), einheit: "GWh", akzent: "orange",
      bezug: bezugstext(k.exp, v.exp, vv, vb),
      info: {
        wert: "Summe der stündlichen SMARD-Exportreihen je Nachbarland.",
        grenzenTitel: "Auflösung und Beleg",
        grenzen: "Wie beim Import: stündlich, Filter-IDs empirisch belegt.",
        quellen: QUELLE_SMARD, messung: "Messung. Zuordnung der IDs belegt hergeleitet."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Außensaldo", wert: vz(k.saldo, 1), einheit: "GWh",
      akzent: k.saldo >= 0 ? "teal" : "orange",
      /* Die Vorzeichenregel steht AN der Zahl, nicht nur im Popover. Ein
         Minus bei "Außensaldo" liest sich wie ein Mangel, gemeint ist das
         Gegenteil: mehr ausgefuehrt als eingefuehrt. Die ausgeschriebene
         Rechnung raeumt das in einer Zeile aus. */
      bezug: (k.saldo >= 0 ? "Netto-Zufluss" : "Netto-Abfluss")
        + ": Import − Export = " + gwh(k.imp, 1) + " − " + gwh(k.exp, 1)
        + " · " + bezugstext(k.saldo, v.saldo, vv, vb),
      info: {
        wert: "Import minus Export über alle Nachbarländer im Zeitraum. "
          + "Das Vorzeichen folgt daraus: ein MINUS heißt, dass mehr ausgeführt "
          + "als eingeführt wurde — Deutschland war in diesem Zeitraum "
          + "Nettoexporteur. Ein Plus heiße Nettoimport.",
        grenzenTitel: "Was der Saldo nicht sagt",
        grenzen: "Der Saldo sagt nichts darüber, welchen Weg der Strom im deutschen Netz "
          + "genommen hat. Flüsse zwischen den vier Regelzonen werden nicht veröffentlicht.",
        quellen: QUELLE_SMARD, messung: "Messung."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Bilanzrest", wert: vz(k.rest, 2), einheit: "GWh",
      bezug: (k.rest === null ? "—" : nf2.format(k.rest / k.netzlast * 100) + " % der Netzlast")
        + " · " + bezugstext(k.rest, v.rest, vv, vb),
      marke: "Selbstkontrolle — geht nicht auf null",
      info: {
        wert: "Erzeugung + Import − Export − Netzlast. Rechnet die anderen Kacheln gegen.",
        grenzenTitel: "Was hier hineinläuft",
        grenzen: "Dieser Rest ist nicht null und soll es auch nicht vortäuschen. Über alle "
          + "4.258 belegten Tage gemessen liegt er zwischen −18,8 % und +12,0 %, im Median bei "
          + "−2,6 %. Darin stecken Netzverluste, die unterschiedliche zeitliche Auflösung von "
          + "Erzeugung (Tageswert) und Außenhandel (Stundenwerte) und — vor 2018 deutlich — "
          + "Erfassungslücken der Quelle.",
        quellen: QUELLE_SMARD,
        messung: "Selbst gerechnet aus vier gemessenen Größen. Die Formel steht oben. Eine "
          + "frühere Fassung dieser Seite nannte 0,5 % als Sollwert; das war auf einen "
          + "einzelnen günstigen Tag geeicht und ist zurückgenommen."
      }
    }));
    var rd = redispatch(von, bis);
    var rdV = redispatch(vorjahrstag(von), vorjahrstag(bis));
    if (rd) {
      kacheln.appendChild(kachel({
        titel: "Redispatch", wert: gwh(rd.gesamt, 1), einheit: "GWh",
        bezug: nf2.format(rd.gesamt / k.netzlast * 100) + " % der Netzlast · "
          + bezugstext(rd.gesamt, rdV && rdV.gesamt, vv, vb),
        marke: "Eingriffe und Probebetrieb — kein Lastfluss",
        info: {
          wert: "Summe der Redispatch-Arbeit aus " + rd.massnahmen.toLocaleString("de-DE")
            + " Maßnahmen der vier Übertragungsnetzbetreiber.",
          grenzenTitel: "Was die Zahl bedeutet",
          grenzen: "Redispatch heißt im Regelfall: ein Netzbetreiber greift in den "
            + "Kraftwerkseinsatz ein, weil das Netz den geplanten Transport nicht "
            + "trägt. Die Zahl sagt, wie viel Energie dafür verschoben wurde — "
            + "nicht, wie viel über eine einzelne Leitung floss. Sie umfasst ALLE "
            + "Gründe, die die Quelle nennt, auch angemeldete Probefahrten und "
            + "Gegengeschäfte über eine Kuppelstelle. Der Abschnitt weiter unten "
            + "gliedert das auf. Die Reihe beginnt 2021.",
          quellen: QUELLE_RD,
          messung: "Messung. Die Zuordnung zum Kalendertag ist eine benannte Annahme."
        }
      }));
    }
    neu.appendChild(abschnitt("Kennzahlen · " + zeitraumLang(von, bis), kacheln));

    // --- Warnungen zum Zeitraum ---
    var warnungen = [];
    var lk = luecken(von, bis);
    if (k.belegt < k.tage) {
      var satz = "Von " + k.tage + " Kalendertagen des Zeitraums liegen nur " + k.belegt
        + " mit Daten vor. Die Summen beziehen sich auf die belegten Tage; fehlende werden "
        + "nicht als Null gezählt.";
      if (lk.tage.length && lk.tage.length <= 10) {
        satz += " Es fehlen: " + lk.tage.map(datumKurz).join(", ") + ".";
      }
      if (lk.zonenOhneDaten.length && lk.zonenMitDaten.length) {
        satz += " Die Lücke liegt nicht am Abruf: an genau diesen Tagen meldet die "
          + "Quelle für " + lk.zonenOhneDaten.join(" und ") + " unvollständige "
          + "Stundenwerte, während " + lk.zonenMitDaten.join(", ") + " vollständig "
          + "vorliegen. Die Deutschlandreihe entsteht aus allen vier und fällt "
          + "deshalb ganz aus.";
      }
      warnungen.push(satz);
    }
    jahreImZeitraum(von, bis).forEach(function (jahr) {
      var jd = Z.jahre[jahr];
      (jd && jd.auffaellig ? jd.auffaellig : []).forEach(function (a) {
        if (a.tag < von || a.tag > bis) { return; }
        warnungen.push("Die Quelle liefert für " + a.reihe + " am " + a.tag + " "
          + nf0.format(a.originalwert) + " MWh. Das ist um Größenordnungen zu viel und kann "
          + "nicht stimmen. Der Wert wird hier als fehlend geführt — nicht korrigiert und "
          + "nicht geschätzt. Der Originalwert steht in data/tage/" + jahr + ".json unter "
          + "„auffaellig“.");
      });
    });
    if (von < "2019-01-01") {
      warnungen.push("Für Tage vor 2019 ist die Aufteilung auf die vier Regelzonen in der "
        + "Quelle unvollständig: 2015 fehlen an einzelnen Tagen bis zu 3,4 % der Last. Die "
        + "Zonenwerte dieses Zeitraums sind deshalb mit Vorsicht zu lesen. Die Ursache ist "
        + "nicht geklärt.");
    }
    /* Die Zonensumme wird fuer den gewaehlten Zeitraum nachgerechnet, nicht an
       einer Jahreszahl festgemacht. Sonst faellt durch, dass es auch im
       Dezember 2025 noch Tage mit fast 3 % Abweichung gibt. */
    var zAbw = zonenAbweichung(von, bis);
    if (zAbw !== null && Math.abs(zAbw) > 1) {
      warnungen.push("Die Erzeugung der vier Regelzonen summiert sich in diesem Zeitraum "
        + "auf " + nf2.format(Math.abs(zAbw)) + " % " + (zAbw > 0 ? "mehr" : "weniger")
        + " als die Erzeugung für Deutschland insgesamt. Beide Reihen kommen aus "
        + "derselben Quelle und müssten gleich sein. Größter Einzelposten ist die "
        + "Reihe „Sonstige Konventionelle“, die 2015 in der Zonenaufteilung "
        + "fünfmal so hoch steht wie für Deutschland. Der Abschnitt zu den Regelzonen "
        + "ist für diesen Zeitraum entsprechend unsicher — die Werte werden nicht "
        + "korrigiert und nicht angeglichen.");
    }
    if (k.rest !== null && Math.abs(k.rest / k.netzlast * 100) > 5) {
      warnungen.push("Die Bilanz dieses Zeitraums geht um "
        + nf1.format(Math.abs(k.rest / k.netzlast * 100)) + " % nicht auf. Das liegt über dem "
        + "üblichen Bereich.");
    }
    if (warnungen.length) {
      var warnkasten = el("div", { "class": "pf-kasten" });
      warnkasten.appendChild(el("h3", { text: "Zu diesem Zeitraum" }));
      var wul = el("ul");
      warnungen.forEach(function (w) { wul.appendChild(el("li", { text: w })); });
      warnkasten.appendChild(wul);
      neu.appendChild(abschnitt("Hinweise zur Datenlage", warnkasten));
    }

    // --- Zeitreihe ---
    var stuendlich = anzahlTage(von, bis) <= STUNDEN_BIS_TAGE;
    neu.appendChild(abschnitt(
      "Verlauf · Erzeugung nach Energieträger"
        + (stuendlich ? " · Stundenwerte" : " · Tageswerte"),
      zeitreihenDiagramm(von, bis)));

    // --- Flussbild ---
    var fluss = el("div", { "class": "pf-fluss" });
    var ll = laender(von, bis);

    /* Zufluss ist Erzeugung UND Import. Frueher stand hier nur die Erzeugung,
       waehrend gegenueber der Export stand -- das Bild war unsymmetrisch und
       liess den Import unter den Tisch fallen. Beide Gruppen stehen jetzt in
       derselben Saeule, aber getrennt beschriftet: Energietraeger sind keine
       Nachbarlaender.

       Die Traegerbalken tragen die Traegerfarbe, nicht ein einheitliches Teal.
       Braunkohle ist auf dieser Seite ueberall dieselbe Farbe -- auf der Karte,
       im Verlauf, in den Regelzonen und hier. */
    var tr = traeger(von, bis);
    var zu = ll.filter(function (a) { return a.imp > 0; })
      .map(function (a) { return { name: a.land, mwh: a.imp }; })
      .sort(function (a, b) { return b.mwh - a.mwh; });
    var ab = ll.filter(function (a) { return a.exp > 0; })
      .map(function (a) { return { name: a.land, mwh: a.exp }; })
      .sort(function (a, b) { return b.mwh - a.mwh; });

    /* ZWEI MASSSTAEBE, nicht vier und nicht einer.

       Vorher hatte jede Saeule ihren eigenen: die Einfuhr aus Frankreich mit
       170 GWh war ein kurzer Strich, die Ausfuhr nach Oesterreich mit 278 GWh
       ein voller Balken. Nebeneinander gelesen hiess das: Oesterreich ist ein
       Vielfaches von Frankreich. Es ist das 1,6-fache.

       Einfuhr und Ausfuhr sind dieselbe Groesse in zwei Richtungen und teilen
       sich deshalb jetzt einen Massstab. Die Energietraeger behalten einen
       eigenen -- sie sind eine Groessenordnung groesser, und mit einem
       gemeinsamen Massstab waeren saemtliche Laenderbalken unsichtbar. Damit
       niemand ueber die Saeulengrenze hinweg vergleicht, was nicht
       vergleichbar ist, nennt jede Saeule ihren Massstab. */
    var maxTr = Math.max.apply(null, tr.map(function (e) { return e.mwh; }));
    var maxHandel = Math.max.apply(null,
      zu.map(function (e) { return e.mwh; })
        .concat(ab.map(function (e) { return e.mwh; })).concat([0]));
    var massstabHandel = "Balken bis " + gwh(maxHandel, 1)
      + " GWh — gemeinsamer Maßstab für Import und Export";

    /* Vier Saeulen, nicht drei: der Import ist ein eigener Vorgang und kein
       Anhaengsel der Erzeugung. Energietraeger und Nachbarlaender in eine Liste
       zu schuetten hiesse, zwei verschiedene Dinge in dieselbe Spalte zu
       schreiben. Beide Zufluesse behalten den Teal-Akzent ihrer Richtung.

       Beide Zuflusssaeulen teilen sich denselben Massstab (maxZu). Ein eigener
       Massstab je Saeule liesse 170 GWh Import aus Frankreich so lang aussehen
       wie 2.388 GWh Wind. */
    fluss.appendChild(saeule("zufluss", "Zufluss · Erzeugung",
      gwh(k.erzeugung, 1) + " GWh", balkenliste(tr, null, maxTr, traegerFarbe),
      "Balken bis " + gwh(maxTr, 1) + " GWh — eigener Maßstab"));
    var ahp = aussenhandelspreis(von, bis);
    fluss.appendChild(saeule("zufluss", "Zufluss · Import je Nachbarland",
      gwh(k.imp, 1) + " GWh", balkenliste(zu, "var(--teal)", maxHandel),
      massstabHandel));

    var netzInhalt = el("div");
    var zz = zonen(von, bis).sort(function (a, b) { return b.saldo - a.saldo; });
    var maxAbs = Math.max.apply(null, zz.map(function (x) { return Math.abs(x.saldo); }));
    zz.forEach(function (x) {
      var h = el("div", { "class": "pf-balken" });
      var zeileEl = el("div", { "class": "pf-zeile" });
      zeileEl.appendChild(el("span", { "class": "pf-name", text: x.zone }));
      zeileEl.appendChild(el("span", { "class": "pf-zahl", text: vz(x.saldo, 1) }));
      h.appendChild(zeileEl);
      var schiene = el("div", { "class": "pf-schiene" });
      schiene.appendChild(el("div", { "class": "pf-fuellung",
        style: "width:" + (Math.abs(x.saldo) / maxAbs * 100).toFixed(1) + "%;background:"
          + (x.saldo >= 0 ? "var(--teal)" : "var(--orange)") + ";" }));
      h.appendChild(schiene);
      netzInhalt.appendChild(h);
    });
    netzInhalt.appendChild(el("p", { "class": "pf-bezug",
      text: "Saldo = Erzeugung minus Netzlast je Regelzone, in GWh. Der Austausch mit allen "
        + "Nachbarn zusammen — anderen Regelzonen und Ausland. Kein Fluss von einer Zone in "
        + "eine andere." }));

    /* Die Gleichung, die das Bild zusammenhaelt. Sie steht hier ausgeschrieben,
       damit man die drei Saeulen gegeneinander nachrechnen kann, ohne sie
       abzutippen -- und damit der Rest sichtbar ist, statt in einer Kachel zu
       verschwinden. Er geht nicht auf null auf, und das soll man sehen. */
    if (k.rest !== null) {
      var rechnung = el("div", { "class": "pf-rechnung" });
      rechnung.appendChild(el("p", { "class": "pf-gruppentitel", text: "Die Bilanz" }));
      [["Erzeugung", gwh(k.erzeugung, 1)],
       ["+ Import", gwh(k.imp, 1)],
       ["− Export", gwh(k.exp, 1)],
       ["− Netzlast", gwh(k.netzlast, 1)]].forEach(function (z) {
        var r = el("div", { "class": "pf-rechnung-zeile" });
        r.appendChild(el("span", { text: z[0] }));
        r.appendChild(el("span", { "class": "pf-zahl", text: z[1] }));
        rechnung.appendChild(r);
      });
      var summe = el("div", { "class": "pf-rechnung-zeile pf-rechnung-summe" });
      summe.appendChild(el("span", { text: "= Bilanzrest" }));
      // Zwei Nachkommastellen wie in der Kachel "Bilanzrest" -- wer beide
      // Zahlen nebeneinander liest, soll nicht ueber eine Rundung stolpern.
      summe.appendChild(el("span", { "class": "pf-zahl", text: vz(k.rest, 2) }));
      rechnung.appendChild(summe);
      rechnung.appendChild(el("p", { "class": "pf-bezug",
        text: "Alles in GWh. " + nf2.format(k.rest / k.netzlast * 100) + " % der Netzlast. "
          + "Der Rest geht nicht auf null auf und wird nicht dorthin gerechnet — darin "
          + "stecken Netzverluste und die unterschiedliche zeitliche Auflösung von "
          + "Erzeugung und Außenhandel." }));
      netzInhalt.appendChild(rechnung);
    }
    fluss.appendChild(saeule("netz", "Netz · Regelzonen", gwh(k.netzlast, 1) + " GWh Netzlast",
      netzInhalt));

    fluss.appendChild(saeule("abfluss", "Abfluss · Export je Nachbarland",
      gwh(k.exp, 1) + " GWh", balkenliste(ab, "var(--orange)", maxHandel),
      massstabHandel));
    var flussblock = el("div");
    flussblock.appendChild(fluss);
    if (ahp) {
      /* Der Preis steht als EIGENE ZEILE unter dem ganzen Block, nicht als
         Fussnote in zwei Saeulen. Er gehoert zu beiden Richtungen zugleich:
         die interessante Zahl ist nicht der eine Preis, sondern der Abstand
         zwischen ihnen. Zwei getrennte Zeilen in zwei Spalten haben genau
         diesen Vergleich verhindert. */
      var pz = el("div", { "class": "pf-preiszeile" });
      var diff = ahp.ein - ahp.aus;
      [["Eingeführt zu", nf2.format(ahp.ein), "teal"],
       ["Ausgeführt zu", nf2.format(ahp.aus), "orange"],
       [diff >= 0 ? "Einfuhr teurer um" : "Ausfuhr teurer um",
        nf2.format(Math.abs(diff)), "violett"]].forEach(function (z) {
        var f = el("div", { "class": "pf-preisfeld", "data-akzent": z[2] });
        f.appendChild(el("span", { "class": "pf-titel", text: z[0] }));
        var w = el("p", { "class": "pf-wert", text: z[1] });
        w.appendChild(el("span", { "class": "pf-einheit", text: "€/MWh" }));
        f.appendChild(w);
        pz.appendChild(f);
      });
      flussblock.appendChild(pz);
    }
    neu.appendChild(abschnitt("Zufluss · Netz · Abfluss (GWh im Zeitraum)", flussblock));
    if (ahp) {
      /* Der Vorbehalt gehoert dazu, sonst liest sich die Zahl als Handels-
         spanne. Sie ist keine: es ist der deutsche Preis zur Stunde des
         Flusses, nicht der Preis, zu dem an der Grenze abgerechnet wurde. */
      flussblock.appendChild(el("p", { "class": "pf-bezug pf-ahp-hinweis",
        text: "Beide Preise sind stündlich mengengewichtet, über "
          + nf0.format(ahp.stunden) + " Stunden an " + nf0.format(ahp.tage)
          + " Tagen. Ein Tagesmittel ergäbe etwas anderes, weil an einem Tag zu "
          + "teuren Stunden eingeführt und zu billigen ausgeführt wird. "
          + "WICHTIG: das ist der deutsche Day-Ahead-Preis zur Stunde des "
          + "Flusses — nicht der Preis, zu dem an der Grenze abgerechnet wurde. "
          + "Den führt die Quelle nicht; er wäre der Preis der jeweils "
          + "gekoppelten Gebotszone. Die Differenz ist deshalb keine "
          + "Handelsspanne, sondern zeigt, dass Strom aus billigen in teure "
          + "Stunden fließt." }));
    }

    // --- Regelzonen ---
    neu.appendChild(abschnitt("Regelzonen · Erzeugung nach Energieträger",
      regelzonenAbschnitt(von, bis)));

    // --- Redispatch ---
    neu.appendChild(abschnitt("Redispatch · Eingriffe ins Netz",
      redispatchAbschnitt(von, bis, k.netzlast)));

    // --- Karte ---
    var karteHuelle = el("div", { "class": "pf-karte-huelle" });
    var roll = el("div", { "class": "pf-karte-rollbereich" });
    roll.setAttribute("data-bezug", "1");
    var K = karte(Z.grundkarte, Z.kraftwerke.anlagen, von, bis);
    roll.appendChild(K.svg);
    karteHuelle.appendChild(roll);

    var kbed = el("div", { "class": "pf-kartenbedienung" });
    [["+", "Hineinzoomen", 1 / 1.4], ["−", "Herauszoomen", 1.4]].forEach(function (b) {
      var kn = el("button", { "class": "pf-schritt", type: "button",
        "aria-label": b[1], text: b[0] });
      kn.addEventListener("click", function () {
        var a = Z.karte.sicht;
        K.zoomAn(b[2], a.x + a.w / 2, a.y + a.h / 2);
      });
      kbed.appendChild(kn);
    });
    var kzur = el("button", { "class": "pf-zuruecksetzen", type: "button",
      text: "Ansicht zurücksetzen" });
    kzur.addEventListener("click", function () {
      /* "Ansicht zuruecksetzen" hat frueher nur den Ausschnitt zurueckgesetzt.
         Eine hervorgehobene Regelzone oder ein hervorgehobener Energietraeger
         blieben stehen, und eine angeklickte Anlage blieb ausgewaehlt -- die
         Karte sah danach anders aus als beim ersten Seitenaufruf, obwohl der
         Knopf genau das verspricht.

         NICHT zurueckgesetzt werden die Ebenen. Sie sind keine Ansicht,
         sondern eine Auswahl des Inhalts, und sie stehen als Haekchen
         sichtbar daneben. Wer 5,9 MB Hochspannungsnetz geladen hat, soll es
         nicht durch einen Klick auf "Ansicht" wieder verlieren. */
      K.sichtSetzen({ x: 0, y: 0, w: K.breite, h: K.hoehe });
      hervorheben(null);
      traegerHervor(null);
      Z.karte.auswahl = null;
      auswahlZeigen();
      K.svg.querySelectorAll("[data-gewaehlt]").forEach(function (x) {
        x.removeAttribute("data-gewaehlt");
      });
    });
    kbed.appendChild(kzur);
    kbed.appendChild(el("span", { "class": "pf-kartenhinweis",
      text: "Mausrad oder +/− zoomt, Ziehen verschiebt, Klick wählt aus. "
        + "Mit der Tastatur: anfahren, dann Pfeiltasten und +/−." }));
    // Der Auswahlkasten liegt IN der Karte, nicht darunter: wer auf einen Punkt
    // klickt, schaut auf die Karte und nicht ans Seitenende.
    var auswahlkasten = el("div", { "class": "pf-auswahl", id: "pf-auswahl",
      "aria-live": "polite" });
    auswahlkasten.hidden = true;
    roll.appendChild(auswahlkasten);

    karteHuelle.appendChild(kbed);
    karteHuelle.appendChild(ebenenSchalter());

    /* Legende in drei Zeilen, weil die Karte drei Dinge codiert:
       WER (Regelzone, Leitungsfarbe), WELCHE SPANNUNG (Strichstaerke) und
       WAS FUER EIN KRAFTWERK (Punktfarbe, dieselben Farben wie im Diagramm). */
    var legendeBox = el("div", { "class": "pf-legenden" });

    function legendenzeile(titel) {
      var z = el("div", { "class": "pf-legende" });
      z.appendChild(el("span", { "class": "pf-legende-titel", text: titel }));
      legendeBox.appendChild(z);
      return z;
    }

    /* Regelzonen. Ueberfahren oder anklicken hebt eine Zone hervor und blendet
       den Rest zurueck -- so wird sichtbar, wo ein Netzbetreiber liegt, ohne
       dass dafuer Flaechen erfunden werden muessten. Eine belegbare Geometrie
       der Regelzonen habe ich nicht; was hier leuchtet, sind die tatsaechlich
       diesem Betreiber zugeschriebenen Leitungen und seine Kraftwerke. */
    var zeileZone = legendenzeile("Regelzone:");
    function hervorheben(zone) {
      if (zone) { K.svg.setAttribute("data-hervor", zone); }
      else { K.svg.removeAttribute("data-hervor"); }
      zeileZone.querySelectorAll(".pf-zonenknopf").forEach(function (b) {
        if (b.getAttribute("data-zone") === zone) { b.setAttribute("data-aktiv", "1"); }
        else { b.removeAttribute("data-aktiv"); }
      });
    }
    Object.keys(ZONENFARBE).forEach(function (z) {
      var knopf = el("button", { "class": "pf-zonenknopf", type: "button",
        "data-zone": z, "aria-label": "Regelzone " + z + " hervorheben" });
      knopf.appendChild(el("i", { style: "background:" + ZONENFARBE[z] + ";" }));
      knopf.appendChild(document.createTextNode(z));
      knopf.addEventListener("mouseenter", function () { hervorheben(z); });
      knopf.addEventListener("focus", function () { hervorheben(z); });
      knopf.addEventListener("click", function () {
        hervorheben(K.svg.getAttribute("data-hervor") === z ? null : z);
      });
      zeileZone.appendChild(knopf);
    });
    zeileZone.addEventListener("mouseleave", function () {
      if (!zeileZone.querySelector("[data-aktiv]")) { hervorheben(null); }
    });
    var spU = el("span");
    spU.appendChild(el("i", { style: "background:var(--netz-unbekannt);" }));
    spU.appendChild(document.createTextNode("Betreiber in OpenStreetMap nicht angegeben"));
    zeileZone.appendChild(spU);

    var zeileSpannung = legendenzeile("Spannung:");
    EBENEN.forEach(function (e) {
      var sp = el("span");
      sp.appendChild(el("i", { "class": "pf-strich",
        style: "background:var(--netz-unbekannt);height:"
          + Math.max(1, Math.round(e.breite * 2)) + "px;" }));
      sp.appendChild(document.createTextNode(e.name));
      zeileSpannung.appendChild(sp);
    });

    /* Die Traegerlegende ist zugleich ein Filter. Das ist nicht nur bequem,
       sondern noetig: vier gesaettigte Farbtoene in einem engen
       Helligkeitsband lassen sich nicht so waehlen, dass JEDES Paar auch bei
       Farbsehschwaeche sicher trennt. Der schwaechste Abstand liegt im
       zulaessigen Grenzband; damit die Identitaet trotzdem ohne Farbe
       auffindbar bleibt, hebt das Ueberfahren einen Traeger hervor, und der
       Klick auf einen Punkt nennt ihn im Text. Siehe docs/beleg-verlauf.md. */
    var zeileTraeger = legendenzeile("Kraftwerk:");
    function traegerHervor(name) {
      if (name) { K.svg.setAttribute("data-traeger-hervor", name); }
      else { K.svg.removeAttribute("data-traeger-hervor"); }
      zeileTraeger.querySelectorAll(".pf-zonenknopf").forEach(function (b) {
        if (b.getAttribute("data-traeger") === name) { b.setAttribute("data-aktiv", "1"); }
        else { b.removeAttribute("data-aktiv"); }
      });
    }
    var gesehen = {};
    function traegerKnopf(name, token) {
      if (gesehen[name]) { return; }
      gesehen[name] = true;
      var knopf = el("button", { "class": "pf-zonenknopf", type: "button",
        "data-traeger": name, "aria-label": "Anlagen mit " + name + " hervorheben" });
      knopf.appendChild(el("i", { style: "background:var(" + token + ");" }));
      knopf.appendChild(document.createTextNode(name));
      knopf.addEventListener("mouseenter", function () { traegerHervor(name); });
      knopf.addEventListener("focus", function () { traegerHervor(name); });
      knopf.addEventListener("click", function () {
        traegerHervor(K.svg.getAttribute("data-traeger-hervor") === name ? null : name);
      });
      zeileTraeger.appendChild(knopf);
    }
    Z.kraftwerke.anlagen.forEach(function (a) {
      traegerKnopf(TRAEGERGRUPPE_ANZEIGE[a.energietraeger] || "Sonstige",
                   traegerToken(a.energietraeger));
    });
    /* Wind und Photovoltaik stehen erst in der Legende, wenn ihre Ebene auch
       geladen ist -- ein Knopf fuer etwas, das gerade nicht auf der Karte ist,
       waere eine Behauptung. */
    if (Z.ebenen.mastrwind && Z.netz.mastrwind) { traegerKnopf("Wind", "--tr-wind"); }

    zeileTraeger.addEventListener("mouseleave", function () {
      if (!zeileTraeger.querySelector("[data-aktiv]")) { traegerHervor(null); }
    });
    zeileTraeger.appendChild(el("span", { text: "Punktfläche ∝ Nettoleistung" }));

    var zeilePfeil = legendenzeile("Kuppelstelle:");
    var spI = el("span");
    spI.appendChild(el("i", { style: "background:var(--teal);" }));
    spI.appendChild(document.createTextNode("Pfeil nach innen: Zufluss"));
    zeilePfeil.appendChild(spI);
    var spE = el("span");
    spE.appendChild(el("i", { style: "background:var(--orange);" }));
    spE.appendChild(document.createTextNode("Pfeil nach außen: Abfluss"));
    zeilePfeil.appendChild(spE);
    karteHuelle.appendChild(legendeBox);

    karteHuelle.appendChild(el("p", { "class": "pf-karte-warnung",
      text: "Die Leitungen zeigen Verlauf und Spannungsebene — keinen Lastfluss und keine "
        + "Auslastung. Wie viel Strom über eine einzelne Leitung fließt, wird nach "
        + "§ 23c Abs. 2 EnWG nicht veröffentlicht. Eine Richtung zeigen nur die Pfeile an "
        + "den Kuppelstellen: dort ist sie gemessen. Ihre Lage ist schematisch." }));

    var anzahlen = [];
    if (Z.netz.hoechstspannung) {
      anzahlen.push(nf0.format(Z.netz.hoechstspannung.anzahl) + " Leitungsabschnitte 220/380 kV");
    }
    if (Z.netz.hochspannung) {
      anzahlen.push(nf0.format(Z.netz.hochspannung.anzahl) + " Abschnitte 110 kV");
    }
    if (Z.netz.umspannwerke) {
      anzahlen.push(nf0.format(Z.netz.umspannwerke.anzahl) + " Umspannwerke");
    }
    anzahlen.push(nf0.format(Z.kraftwerke.anzahl) + " Kraftwerke");
    infoKnopf(karteHuelle, {
      wert: anzahlen.join(", ") + ". Kraftwerke aus den SMARD-Stammdaten, jede an ihrer "
        + "tatsächlichen Koordinate. Leitungen und Umspannwerke aus OpenStreetMap. "
        + "Grundkarte: Natural Earth, gemeinfrei, als SVG gezeichnet — es werden keine "
        + "fremden Kartenkacheln geladen.",
      grenzenTitel: "Was die Karte nicht zeigt",
      grenzen: "Keinen Lastfluss und keine Auslastung. OpenStreetMap ist eine "
        + "Gemeinschaftserhebung, keine amtliche Quelle: die Erfassung kann unvollständig "
        + "oder veraltet sein, besonders bei 110 kV. Mittelspannung ist dort kaum erfasst. "
        + "Die Landesgrenzen sind vereinfacht und dienen nur der Orientierung. Die "
        + "Regelzonen sind nicht als Fläche dargestellt — dafür fehlt eine belegbare "
        + "Geometrie; die Farbe der Kraftwerkspunkte nennt die Zone.",
      quellen: QUELLE_SMARD.concat([
        { text: "OpenStreetMap contributors (ODbL)", url: "https://www.openstreetmap.org/copyright" },
        { text: "Natural Earth", url: "https://www.naturalearthdata.com/" }]),
      messung: "Stammdaten und Geografie, keine Messung. Die Karte zeigt, wo etwas steht "
        + "und wofür es gebaut ist — nicht, wohin der Strom fließt."
    }, "Karte des Netzes und der Kraftwerksstandorte");
    neu.appendChild(abschnitt("Karte · Netz und Kraftwerke", karteHuelle));

    // --- Tabelle Aussenhandel ---
    var tabRoll = el("div", { "class": "pf-tabellen-rollbereich" });
    var tab = el("table", { "class": "pf-tabelle" });
    var thead = el("thead"), kopfz = el("tr");
    ["Nachbarland", "Import GWh", "Export GWh", "Saldo GWh", "Saldo Vorjahreszeitraum"]
      .forEach(function (t) { kopfz.appendChild(el("th", { text: t, scope: "col" })); });
    thead.appendChild(kopfz); tab.appendChild(thead);
    var tbody = el("tbody");
    var lv = {};
    laender(vv, vb).forEach(function (e) { lv[e.land] = e; });
    ll.forEach(function (a) {
      var trEl = el("tr");
      trEl.appendChild(el("td", { text: a.land }));
      trEl.appendChild(el("td", { text: gwh(a.imp, 2) }));
      trEl.appendChild(el("td", { text: gwh(a.exp, 2) }));
      trEl.appendChild(el("td", { "class": a.saldo >= 0 ? "pf-plus" : "pf-minus",
        text: vz(a.saldo, 2) }));
      trEl.appendChild(el("td", { "class": "pf-hinweis",
        text: lv[a.land] ? vz(lv[a.land].saldo, 2) : "—" }));
      tbody.appendChild(trEl);
    });
    var summe = el("tr");
    summe.appendChild(el("td", { text: "Summe" }));
    summe.appendChild(el("td", { text: gwh(k.imp, 2) }));
    summe.appendChild(el("td", { text: gwh(k.exp, 2) }));
    summe.appendChild(el("td", { "class": k.saldo >= 0 ? "pf-plus" : "pf-minus",
      text: vz(k.saldo, 2) }));
    summe.appendChild(el("td", { "class": "pf-hinweis", text: vz(v.saldo, 2) }));
    tbody.appendChild(summe);
    tab.appendChild(tbody); tabRoll.appendChild(tab);
    neu.appendChild(abschnitt(
      "Physikalischer Stromfluss je Kuppelstelle (positiv = Zufluss nach Deutschland)",
      tabRoll));

    // --- Grenzen der Quellenlage ---
    var nicht = el("div", { "class": "pf-kasten" });
    nicht.appendChild(el("h3", { text: "Was diese Seite nicht zeigt" }));
    nicht.appendChild(el("p", { "class": "pf-kasten-vor",
      text: "Nicht, weil es fehlt, sondern weil es nicht veröffentlicht wird oder "
        + "nicht erhoben ist. Kein Modell füllt diese Lücken." }));
    var ul = el("ul");
    [
      "Flüsse zwischen den vier Regelzonen. Deutschland und Luxemburg bilden EINE "
        + "Gebotszone; die EU-Verordnung 543/2013 verlangt physikalische Flüsse nur "
        + "zwischen Gebotszonen. Der Zonensaldo ist kein Ersatz — er mischt den "
        + "Austausch mit den anderen Zonen und mit dem Ausland.",
      "Lastfluss und Auslastung einzelner Hoch- und Höchstspannungsleitungen. Nach "
        + "§ 23c Abs. 2 EnWG werden grenzüberschreitende Lastflüsse nur zusammengefasst "
        + "je Kuppelstelle veröffentlicht. Öffentlich sichtbare Leitungsauslastungen "
        + "sind Modellrechnungen.",
      "Wind- und Solarparks als einzelne Anlagen. Die SMARD-Kraftwerksstammdaten "
        + "führen 596 überwiegend konventionelle Anlagen und Speicher; Wind und "
        + "Photovoltaik stehen dort nicht einzeln. Auf der Karte fehlen sie deshalb, "
        + "im Verlauf sind sie vollständig enthalten.",
      "Mittelspannung. In OpenStreetMap kaum erfasst.",
      "Eine Regelzone je Windpark. Das Marktstammdatenregister führt sie nicht. "
        + "Die Parks bleiben deshalb ohne Zonenfarbe und treten zurück, wenn eine "
        + "Zone hervorgehoben wird — statt eine Zugehörigkeit vorzutäuschen, die "
        + "nicht belegt ist.",
      "Redispatch auf der Karte. Geprüft, und es geht nicht: das Feld "
        + "BETROFFENE_ANLAGE nennt 404 verschiedene Bezeichnungen, aber gegen die "
        + "596 Kraftwerke und 5.259 Umspannwerke geprüft bleiben 76,9 % der Arbeit "
        + "ohne Ort. Die unscharfen Treffer sind teils falsch — „Obernburg“ wäre "
        + "„Bernburg“ geworden, zwei verschiedene Orte. 13,3 % der Arbeit laufen "
        + "ohnehin über die Börse und haben gar keinen Ort. Eine Karte daraus wäre "
        + "eine Behauptung.",
      "Der Betreiber von 45,5 % der Höchstspannungsabschnitte. OpenStreetMap kennt "
        + "ihn dort nicht; diese Leitungen bleiben grau statt geraten.",
      "Eine belegte Grenze der Regelzonen. Es gibt keine — OpenStreetMap führt "
        + "keine Grenzrelation dafür, die Bundesnetzagentur veröffentlicht eine "
        + "Netzkarte als PDF. Die Karte kann eine Fläche einblenden, aber die ist "
        + "abgeleitet und keine Grenze: jede Rasterzelle bekommt die Zone ihres "
        + "nächstgelegenen Stützpunktes. Wie gut das trifft, ist gemessen — "
        + "93,3 % der 596 Kraftwerke mit amtlicher Zonenangabe, 40 daneben, vor allem "
        + "am Oberrhein und an der Grenze Bayern/Hessen. Die Ebene ist deshalb "
        + "voreingestellt ausgeschaltet."
    ].forEach(function (t) { ul.appendChild(el("li", { text: t })); });
    nicht.appendChild(ul);
    neu.appendChild(abschnitt("Grenzen", nicht));

    // --- Ab wann welche Reihe beginnt ---
    var beginn = el("div", { "class": "pf-kasten", "data-art": "offen" });
    beginn.appendChild(el("h3", { text: "Ab wann welche Reihe beginnt" }));
    beginn.appendChild(el("p", { "class": "pf-kasten-vor",
      text: "Der Zeitraumregler reicht bis 2015 zurück — aber nicht jede Reihe ist so "
        + "alt. Wer weiter zurückgeht, sieht weniger, und die Seite sagt es dann auch "
        + "an der Stelle." }));
    var brt = el("div", { "class": "pf-tabellen-rollbereich" });
    var btab = el("table", { "class": "pf-tabelle" });
    var bth = el("thead"), bhz = el("tr");
    ["Reihe", "beginnt", "Grund"].forEach(function (h) {
      bhz.appendChild(el("th", { text: h, scope: "col" }));
    });
    bth.appendChild(bhz); btab.appendChild(bth);
    var btb = el("tbody");
    [
      ["Netzlast, Erzeugung, Außenhandel", "01.01.2015", "Beginn der SMARD-Reihen"],
      ["Regelzonen belastbar", "01.01.2019", "davor fehlen bis zu 3,4 % der Last je Tag"],
      ["Großhandelspreis", "01.10.2018", "Teilung der Gebotszone Deutschland-Österreich"],
      ["Redispatch", "01.01.2021", "davor antwortet die Quelle mit HTTP 400"],
      ["Kernenergie", "endet 15.04.2023", "Abschaltung der letzten Kraftwerke"],
      ["Norwegen, Belgien", "2020 bzw. 2021", "NordLink und ALEGrO gingen erst dann ans Netz"]
    ].forEach(function (z) {
      var tr = el("tr");
      tr.appendChild(el("td", { text: z[0] }));
      tr.appendChild(el("td", { text: z[1] }));
      tr.appendChild(el("td", { "class": "pf-hinweis pf-links", text: z[2] }));
      btb.appendChild(tr);
    });
    btab.appendChild(btb); brt.appendChild(btab);
    beginn.appendChild(brt);
    /* Das obere Ende der Reichweite setzt NICHT diese Seite, sondern die
       Quelle. Ohne diesen Satz liest sich ein fehlender Vortag wie ein
       Versaeumnis des Abrufs -- gemessen am 31.08.2026 fehlten in der
       Netzlast des 30.08. vierzehn von vierundzwanzig Stunden, waehrend der
       Grosshandelspreis desselben Tages vollstaendig vorlag. */
    beginn.appendChild(el("p", { "class": "pf-bezug",
      text: "Das obere Ende steht bei " + datumLang(Z.maxTag) + ". Es wird nicht "
        + "hier gesetzt, sondern von der Quelle: die Tageswerte entstehen erst, "
        + "wenn alle Stunden eines Tages vorliegen, und SMARD meldet einzelne "
        + "Stunden verspätet nach. Ein fehlender Vortag ist deshalb in aller Regel "
        + "eine Lücke der Quelle und kein ausgefallener Abruf. Geholt wird täglich "
        + "um 07:12 Uhr; was dann noch fehlt, kommt am nächsten Tag mit." }));
    neu.appendChild(abschnitt("Zeitliche Reichweite", beginn));

    // --- Bekannte Maengel der Daten ---
    var maengel = el("div", { "class": "pf-kasten" });
    maengel.appendChild(el("h3", { text: "Bekannte Mängel der Daten" }));
    maengel.appendChild(el("p", { "class": "pf-kasten-vor",
      text: "Gemessen, benannt und nicht weggeglättet. Wer eine dieser Zahlen "
        + "weiterverwendet, sollte sie kennen." }));
    var ul3 = el("ul");
    [
      "Die Bilanz geht nicht auf null auf. Erzeugung + Import − Export − Netzlast "
        + "liegt über 4.258 Tage zwischen −18,8 % und +12,0 %, im Median bei −2,6 %. "
        + "Darin stecken Netzverluste, unterschiedliche Auflösungen und — vor 2018 "
        + "deutlich — Erfassungslücken der Quelle. Die Ursache der frühen Lücke ist "
        + "nicht geklärt.",
      "Ein Wert der Quelle ist falsch: der Schweiz-Import am 09.02.2015 steht mit "
        + "25.009.206 MWh in den Rohdaten — 25 TWh an einem Tag. Er wird als fehlend "
        + "geführt, nicht korrigiert; der Originalwert bleibt in den Dateien sichtbar.",
      /* Die Spanne wird von validate.py gegen die Jahresdateien nachgerechnet.
         Sie stand hier zweimal falsch: erst mit 3,6 bis 25,4 % aus den durch
         das Dezimalkomma lueckenhaften Zahlen, dann mit 3,2 bis 18,1 % und dem
         Satz "in jedem Jahr" -- der 2026 nicht mehr galt. Wer sie aendert,
         rechnet nach; wer sie nicht aendert, wird vom Tuersteher erinnert. */
      "Beim Redispatch ist das Hochfahren meist größer als das Herunterfahren — "
        + "über die sechs Jahre zwischen −3,2 und +18,1 % der gesamten Arbeit. "
        + "Im laufenden Jahr 2026 ist es bislang umgekehrt. Kein Fehler: bei "
        + "grenzüberschreitenden Maßnahmen wird nur der deutsche Teil "
        + "veröffentlicht.",
      "Eine Redispatch-Maßnahme zählt zum Tag ihres Beginns. Im August 2026 lagen "
        + "22,2 % der Arbeit in Maßnahmen über Mitternacht. Das ist eine Annahme, "
        + "keine Messung.",
      "Die Pfeile an den Kuppelstellen sitzen schematisch. Gemessen sind Richtung "
        + "und Menge, nicht der Ort des Übergangs.",
      "OpenStreetMap ist eine Gemeinschaftserhebung. Die Netzgeometrie kann "
        + "unvollständig oder veraltet sein, besonders auf der 110-kV-Ebene.",
      "Der SMARD-Endpunkt für die Kraftwerksstammdaten ist in keiner Dokumentation "
        + "beschrieben. Er wurde aus dem Frontend rekonstruiert und kann sich ohne "
        + "Ankündigung ändern."
    ].forEach(function (t) { ul3.appendChild(el("li", { text: t })); });
    maengel.appendChild(ul3);
    neu.appendChild(abschnitt("Datenqualität", maengel));

    // --- Was noch fehlt ---
    var offen = el("div", { "class": "pf-kasten", "data-art": "offen" });
    offen.appendChild(el("h3", { text: "Was noch fehlt" }));
    offen.appendChild(el("p", { "class": "pf-kasten-vor",
      text: "Nicht Grenzen der Quellenlage, sondern Arbeit, die noch aussteht." }));
    /* Am 31.08.2026 mit Immo durchgegangen. Die Liste ist keine Halde mehr,
       sondern hat eine Reihenfolge: was oben steht, wird als Naechstes
       angefasst. Vier Eintraege sind dabei weggefallen -- zwei gestrichen
       (kleine Windparks, Solaranlagen) und zwei in den Kasten "Grenzen"
       verschoben, wo sie hingehoeren: eine Grenze der Quelle ist keine
       Aufgabe. */
    var ul2 = el("ul");
    [
      { hoch: true,
        text: "Ob Redispatch auf der Liste frei weiterverwendbarer "
          + "ENTSO-E-Daten steht, ist nicht geprüft — die Seite mit der Liste "
          + "antwortet mit HTTP 403. Das ist die einzige inhaltliche Lücke in "
          + "einer Lizenzkette dieser Seite." },
      { hoch: true,
        text: "Zugang zur ENTSO-E Transparency Platform ist beantragt. Damit "
          + "ließe sich die Lizenzkette des Redispatch von einer Argumentation "
          + "zu einer Zusage machen — und die Frage darüber beantworten." },
      { hoch: true,
        text: "Methodik-PDF, das sich beim Bau selbst aus den Dateien neu "
          + "rechnet." },
      { hoch: false,
        text: "Ein Gesamtlauf über alle Vergleichsjahre als CSV, damit sichtbar "
          + "wird, wie stark das Ergebnis am gewählten Zeitraum hängt." },
      { hoch: false,
        text: "Import und Export im Verlauf — bisher nur als Summe des "
          + "Zeitraums, nicht Stunde für Stunde." },
      { hoch: false,
        text: "Viertelstundenwerte. SMARD hätte sie; als Datei wären sie "
          + "viermal so groß — 48 statt 12 MB, die jeder Besucher mitlädt." },
      { hoch: false,
        text: "1.030 Windenergieanlagen in Betrieb haben im Register keine "
          + "Koordinate und fehlen auf der Karte. Das ist eine Lücke der "
          + "Quelle, keine Auswahl." }
    ].forEach(function (p) {
      var li = el("li");
      if (p.hoch) { li.appendChild(el("b", { text: "Als Nächstes. " })); }
      li.appendChild(document.createTextNode(p.text));
      ul2.appendChild(li);
    });
    offen.appendChild(ul2);
    neu.appendChild(abschnitt("Offene Punkte", offen));

    // --- Quellen und Downloads ---
    var qhuelle = el("div", { "class": "pf-verlauf" });
    if (Z.quellen) {
      qhuelle.appendChild(el("p", { "class": "pf-kasten-vor",
        text: "Jede Zahl auf dieser Seite stammt aus einer der folgenden Dateien. Es "
          + "werden ausschließlich gemessene oder als Stammdatum veröffentlichte Werte "
          + "geführt — nichts modelliert, nichts geschätzt, nichts erfunden. "
          + "Genau eine GEOMETRIE ist abgeleitet, die Fläche der vier Regelzonen; sie "
          + "steht unten unter der eigenen Quelle „abgeleitet — KEINE Messung“ und "
          + "ist auf der Karte voreingestellt ausgeschaltet. "
          + "scripts/quellen.py bricht ab, sobald eine Datei ohne Quellenangabe unter "
          + "data/ auftaucht." }));
      var qroll = el("div", { "class": "pf-tabellen-rollbereich" });
      var qtab = el("table", { "class": "pf-tabelle" });
      var qth = el("thead"), qhz = el("tr");
      ["Datensatz", "Inhalt", "Zeitraum", "Quelle", "Lizenz", "Umfang", "Abzug"]
        .forEach(function (h) { qhz.appendChild(el("th", { text: h, scope: "col" })); });
      qth.appendChild(qhz); qtab.appendChild(qth);
      var qtb = el("tbody");
      Z.quellen.datensaetze.forEach(function (d) {
        var q = Z.quellen.quellen[d.quelle];
        var tr = el("tr");
        tr.appendChild(el("td", { text: d.titel }));
        var tdi = el("td", { "class": "pf-hinweis pf-links" });
        tdi.appendChild(document.createTextNode(d.inhalt));
        if (d.beleg) {
          tdi.appendChild(document.createTextNode(" "));
          tdi.appendChild(el("a", { href: "https://github.com/icrfornax/PowerFlow/blob/main/"
            + d.beleg, target: "_blank", rel: "noopener", text: "Beleg" }));
        }
        tr.appendChild(tdi);
        tr.appendChild(el("td", { "class": "pf-hinweis", text: d.zeitraum || "—" }));
        var tdq = el("td", { "class": "pf-links" });
        tdq.appendChild(el("a", { href: q.url, target: "_blank", rel: "noopener",
          text: q.name }));
        tr.appendChild(tdq);
        var tdl = el("td", { "class": "pf-hinweis pf-links" });
        tdl.appendChild(el("a", { href: q.lizenz_url, target: "_blank", rel: "noopener",
          text: q.lizenz }));
        tr.appendChild(tdl);
        tr.appendChild(el("td", { "class": "pf-hinweis",
          text: (d.dateien > 1 ? d.dateien + " Dateien · " : "")
            + (d.bytes < 1048576 ? nf0.format(d.bytes / 1024) + " kB"
                                 : nf1.format(d.bytes / 1048576) + " MB") }));
        var tda = el("td");
        tda.appendChild(el("a", { "class": "pf-abzug", href: d.abzug, download: "",
          text: d.dateien > 1 ? "Verzeichnis" : "JSON" }));
        if (d.alle) {
          tda.appendChild(el("a", { "class": "pf-abzug", href: d.alle, target: "_blank",
            rel: "noopener", text: "alle" }));
        }
        tr.appendChild(tda);
        qtb.appendChild(tr);
      });
      qtab.appendChild(qtb); qroll.appendChild(qtab);
      qhuelle.appendChild(qroll);
      qhuelle.appendChild(el("p", { "class": "pf-bezug",
        text: Z.quellen.dateien_gesamt + " Dateien, "
          + nf1.format(Z.quellen.bytes_gesamt / 1048576) + " MB insgesamt. "
          + "Namensnennung: " + Object.keys(Z.quellen.quellen).map(function (k) {
              return Z.quellen.quellen[k].namensnennung; }).join(" · ") }));
    }
    var abzuege = el("div", { "class": "pf-abzuege" });
    var csvKnopf = el("button", { "class": "pf-abzug", type: "button",
      text: "Bilanz des gewählten Zeitraums " + zeitraumKurz(von, bis) });
    csvKnopf.appendChild(el("span", { text: "CSV" }));
    csvKnopf.addEventListener("click", function () { csvHerunterladen(von, bis); });
    abzuege.appendChild(csvKnopf);
    /* Das Methodikpapier. Es wird beim Bau aus denselben Dateien neu gerechnet,
       die hier zum Abzug stehen -- eine von Hand gepflegte Fassung liefe der
       Wirklichkeit hinterher. */
    var pdfLink = el("a", { "class": "pf-abzug", href: "methodik.pdf?v=" + VERSION,
      target: "_blank", rel: "noopener",
      text: "Methodik: Leitfrage, Quellen, Formeln, was nicht aufgeht" });
    pdfLink.appendChild(el("span", { text: "PDF" }));
    abzuege.appendChild(pdfLink);
    qhuelle.appendChild(abzuege);
    neu.appendChild(abschnitt("Quellen und Downloads", qhuelle));

    // --- Fussnote ---
    var jahresdatei = Z.jahre[Number(von.slice(0, 4))];
    var fuss = el("footer", { "class": "pf-fussnote" });
    fuss.appendChild(el("p", {
      html: 'Datenquelle: <a href="https://www.smard.de/" target="_blank" rel="noopener">'
        + 'Bundesnetzagentur | SMARD.de</a>, Lizenz '
        + '<a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" '
        + 'rel="noopener">CC BY 4.0</a>. Grundkarte: '
        + '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">'
        + 'Natural Earth</a>, gemeinfrei. Leitungen und Umspannwerke: '
        + '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">'
        + '© OpenStreetMap contributors</a>, Lizenz ODbL 1.0. '
        + 'Gegengeprüft gegen Energy-Charts (Fraunhofer ISE) '
        + '— das ist eine Konsistenzprüfung, keine unabhängige Gegenprobe: beide Quellen gehen '
        + 'auf dieselbe ENTSO-E-Erhebung zurück. Gegenprobe gegen Destatis auf der Jahressumme.'
    }));
    fuss.appendChild(el("p", {
      text: "Daten abgerufen am "
        + (jahresdatei ? jahresdatei.abgerufen.slice(0, 16).replace("T", " um ") : "—")
        + " Uhr. Anzeige deutsch formatiert; die Exporte benutzen den Punkt als "
        + "Dezimaltrennzeichen und erklären das in ihrem Kopf."
    }));
    fuss.appendChild(el("p", { text: "Fassung " + VERSION + ". Belege unter docs/ im Repository." }));
    neu.appendChild(fuss);

    Z.wurzel.parentNode.replaceChild(neu, Z.wurzel);
    Z.wurzel = neu;
    auswahlZeigen();
  }

  function zeitraumSetzen(von, bis) {
    if (von > bis) { var h = von; von = bis; bis = h; }
    if (von < Z.minTag) { von = Z.minTag; }
    if (bis > Z.maxTag) { bis = Z.maxTag; }
    popoverSchliessen();
    var noetig = jahreImZeitraum(von, bis).concat(
      jahreImZeitraum(vorjahrstag(von), vorjahrstag(bis)));
    var auftraege = noetig.map(jahrLaden);
    if (anzahlTage(von, bis) <= STUNDEN_BIS_TAGE) {
      auftraege.push(verlaufLadenZeitraum(von, bis));
    }
    auftraege.push(redispatchLadenZeitraum(von, bis));
    auftraege.push(redispatchLadenZeitraum(vorjahrstag(von), vorjahrstag(bis)));
    Promise.all(auftraege).then(function () {
      Z.von = von; Z.bis = bis;
      zeichnen();
    });
  }

  // ---- Start --------------------------------------------------------------

  function start() {
    var anker = document.getElementById(ANKER);
    if (!anker) { return; }
    Z.wurzel = el("div", { "class": "pf-huelle" }, [
      el("p", { "class": "pf-laden", text: "Daten werden geladen …" })
    ]);
    anker.parentNode.insertBefore(Z.wurzel, anker);

    function hole(pfad) {
      return fetch(pfad + "?v=" + VERSION).then(function (r) {
        if (!r.ok) { throw new Error(pfad + ": HTTP " + r.status); }
        return r.json();
      });
    }

    Promise.all([
      hole("data/tage-verzeichnis.json"),
      hole("data/grundkarte.json"),
      hole("data/kraftwerke.json"),
      hole("data/redispatch-verzeichnis.json"),
      hole("data/quellen.json"),
      // Die voreingestellten Ebenen. Die 110-kV-Ebene wird erst geladen, wenn
      // jemand sie einschaltet -- sie ist 5,9 MB gross.
      netzLaden("hoechstspannung"),
      netzLaden("umspannwerke"),
      /* Die Parkebene darf den Seitenaufbau NICHT aufhalten. Fehlt
         eine Datei -- etwa weil ein Abruf im Workflow gescheitert ist --, wird
         die Ebene still weggelassen; alles andere steht trotzdem. Die
         Alternative waere eine weisse Seite wegen einiger Kartenmarken. */
      netzLaden("mastrwind").catch(function () { Z.ebenen.mastrwind = false; }),
      /* Bausteine fuer den mengengewichteten Aussenhandelspreis. 0,16 MB, und
         die Seite laeuft auch ohne -- dann faellt nur die Preiszeile weg. */
      hole("data/aussenhandel-preis.json").catch(function () { return null; })
    ]).then(function (teile) {
      Z.verzeichnis = teile[0];
      Z.grundkarte = teile[1];
      Z.kraftwerke = teile[2];
      Z.rdVerzeichnis = teile[3];
      Z.quellen = teile[4];
      Z.ahPreis = teile[8] || null;
      var jahre = Z.verzeichnis.jahre;
      Z.minTag = jahre[0].erster_tag;
      var letzte = jahre[jahre.length - 1];
      Z.maxTag = letzte.letzter_belegter_tag || letzte.letzter_tag;
      // Voreinstellung: die letzten sieben belegten Tage. Ein einzelner Tag
      // waere ein Sonderfall und wuerde die Zeitraumwahl verstecken.
      Z.startVon = verschoben(Z.maxTag, -6);
      Z.startBis = Z.maxTag;
      var noetig = jahreImZeitraum(Z.startVon, Z.startBis).concat(
        jahreImZeitraum(vorjahrstag(Z.startVon), vorjahrstag(Z.startBis)));
      return Promise.all(noetig.map(jahrLaden).concat([
        verlaufLadenZeitraum(Z.startVon, Z.startBis),
        redispatchLadenZeitraum(Z.startVon, Z.startBis),
        redispatchLadenZeitraum(vorjahrstag(Z.startVon), vorjahrstag(Z.startBis))]));
    }).then(function () {
      Z.von = Z.startVon;
      Z.bis = Z.startBis;
      zeichnen();
    }).catch(function (fehler) {
      Z.wurzel.textContent = "";
      Z.wurzel.appendChild(el("div", {
        "class": "pf-fehler",
        text: "Die Daten konnten nicht geladen werden: " + fehler.message
          + " — Beim lokalen Öffnen über file:// blockiert der Browser fetch. Die Seite über "
          + "einen Server aufrufen, etwa mit: python -m http.server"
      }));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
