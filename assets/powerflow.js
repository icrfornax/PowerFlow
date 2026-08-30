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
  var VERSION = "20260831-redispatch";

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
  function nachIso(d) {
    function zwei(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + zwei(d.getMonth() + 1) + "-" + zwei(d.getDate());
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
    rdVerzeichnis: null,        // Monat -> geladene Monatsdatei mit Stundenwerten
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
      hochspannung: false
    }
  };

  var NETZDATEI = {
    hoechstspannung: "data/netz-hoechstspannung.json",
    hochspannung: "data/netz-hochspannung.json",
    umspannwerke: "data/netz-umspannwerke.json"
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

  function balkenliste(eintraege, farbe, maxWert) {
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
          + "%;background:" + farbe + ";"
      }));
      liste.appendChild(schiene);
    });
    return liste;
  }

  function saeule(rolle, titel, summeText, inhalt) {
    var s = el("div", { "class": "pf-saeule", "data-rolle": rolle });
    s.appendChild(el("h3", { text: titel }));
    s.appendChild(el("p", { "class": "pf-saeule-summe", text: summeText }));
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

    /* Leitungen. Bei knapp 40.000 Wegen waeren 40.000 SVG-Elemente zu langsam.
       Deshalb EIN Pfadelement je Spannungsebene mit vielen Teilzuegen. */
    function leitungsgruppe(objekte, klasse) {
      var g = s("g", { "class": klasse });
      EBENEN.forEach(function (e) {
        var d = "";
        objekte.forEach(function (o) {
          if (ebeneVon(o.v) !== e) { return; }
          var p = o.p;
          for (var i = 0; i < p.length; i++) {
            d += (i ? "L" : "M") + X(p[i][0]).toFixed(1) + " " + Y(p[i][1]).toFixed(1);
          }
        });
        if (!d) { return; }
        g.appendChild(s("path", {
          d: d, fill: "none", stroke: e.farbe, "stroke-width": e.breite,
          "stroke-linecap": "round", "stroke-linejoin": "round",
          "vector-effect": "non-scaling-stroke"
        }));
      });
      return g;
    }

    if (Z.ebenen.hochspannung && Z.netz.hochspannung) {
      svg.appendChild(leitungsgruppe(Z.netz.hochspannung.objekte, "pf-netz-110"));
    }
    if (Z.ebenen.hoechstspannung && Z.netz.hoechstspannung) {
      svg.appendChild(leitungsgruppe(Z.netz.hoechstspannung.objekte, "pf-netz-hoechst"));
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
        var c = s("circle", {
          cx: X(w.lon).toFixed(1), cy: Y(w.lat).toFixed(1),
          r: (w.v >= 380000 ? 2.1 : w.v >= 220000 ? 1.6 : 1.0).toFixed(1),
          fill: e.farbe
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

    if (Z.ebenen.kraftwerke) {
      var gPunkte = s("g", { "class": "pf-geo-anlage" });
      anlagen.slice().sort(function (a, b) {
        return (a.leistung_mw || 0) - (b.leistung_mw || 0);
      }).forEach(function (a) {
        var mw = a.leistung_mw || 0;
        var farbe = ZONENFARBE[a.regelzone] || "var(--schrift-still)";
        var c = s("circle", {
          cx: X(a.lon).toFixed(1), cy: Y(a.lat).toFixed(1),
          r: Math.max(1.6, Math.sqrt(mw) * 0.30).toFixed(1),
          fill: farbe, stroke: farbe
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
      { schluessel: "hochspannung", text: "Leitungen 110 kV (5,9 MB)", datei: "hochspannung" }
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
    var marken = [], netzlast = [], rohe = {}, tage = [];
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

  function zeitreihenDiagramm(von, bis) {
    var v = zeitreihe(von, bis);
    var huelle = el("div", { "class": "pf-verlauf" });
    if (!v) {
      huelle.appendChild(el("p", { "class": "pf-laden",
        text: "Für diesen Zeitraum liegt noch keine Kurve im Repository." }));
      return huelle;
    }

    // oben 30 statt 16: darunter passt die Einheit ueber die oberste
    // Achsenbeschriftung, ohne sie zu ueberdecken.
    var B = 900, H = 340, links = 52, rechts = 12, oben = 30, unten = 30;
    var n = v.marken.length;
    var innenB = B - links - rechts, innenH = H - oben - unten;

    var stapel = [], laufend = [], maxWert = 0, i;
    for (i = 0; i < n; i++) { laufend.push(0); }
    v.reihen.forEach(function (r) {
      var unterkante = laufend.slice();
      laufend = laufend.map(function (x, k) { return x + r.werte[k]; });
      stapel.push({ reihe: r, unten: unterkante, oben: laufend.slice() });
    });
    laufend.forEach(function (x) { if (x > maxWert) { maxWert = x; } });
    v.netzlast.forEach(function (x) { if (x !== null && x > maxWert) { maxWert = x; } });
    /* Runde Achsenwerte. Ein Viertel der Achse soll auf einer glatten Stufe
       liegen -- 0/20/40/60/80 statt 0/23/45/68/90. */
    var roh = maxWert / v.teiler;
    var stufe = 1;
    var kandidaten = [1, 2, 2.5, 5, 10];
    for (var z = -3; z <= 9 && stufe * 4 < roh; z++) {
      for (var y2 = 0; y2 < kandidaten.length; y2++) {
        stufe = kandidaten[y2] * Math.pow(10, z);
        if (stufe * 4 >= roh) { break; }
      }
    }
    var achse = stufe * 4;

    function X(k) { return links + (n === 1 ? innenB / 2 : k / (n - 1) * innenB); }
    function Y(mwh) { return oben + innenH - (mwh / v.teiler) / achse * innenH; }

    var svg = s("svg", {
      "class": "pf-diagramm", viewBox: "0 0 " + B + " " + H, role: "img",
      tabindex: "0",
      "aria-label": "Erzeugung nach Energieträger, " + zeitraumLang(von, bis)
        + ", gestapelt in " + v.einheit + ", dazu die Netzlast als Linie"
    });

    var gitter = s("g", { "class": "pf-gitter" });
    for (var g = 0; g <= achse + 1e-9; g += stufe) {
      var y = Y(g * v.teiler);
      gitter.appendChild(s("line", { x1: links, x2: B - rechts, y1: y, y2: y }));
      var tx = s("text", { x: links - 6, y: y + 3.5, "text-anchor": "end" });
      tx.textContent = stufe < 1 ? nf1.format(g) : nf0.format(g);
      gitter.appendChild(tx);
    }
    /* Beschriftung der Zeitachse. Bei mehreren Tagen in Stundenaufloesung
       zaehlen die TAGESGRENZEN, nicht die Stundenzahlen -- 168 Zahlen von 00
       bis 23 waeren nur Kammputz. Dann eine senkrechte Trennlinie um
       Mitternacht und das Datum mittig darunter. */
    var wechsel = [];
    if (v.tage) {
      for (var w = 0; w < n; w++) {
        if (w === 0 || v.tage[w] !== v.tage[w - 1]) { wechsel.push(w); }
      }
    }
    if (v.stuendlich && wechsel.length > 1) {
      wechsel.forEach(function (anfang, i) {
        if (i > 0) {
          gitter.appendChild(s("line", { "class": "pf-tagestrenner",
            x1: X(anfang), x2: X(anfang), y1: oben, y2: H - unten }));
        }
        var ende = (i + 1 < wechsel.length) ? wechsel[i + 1] : n;
        var mitte = (X(anfang) + X(Math.max(anfang, ende - 1))) / 2;
        var beschriftung = s("text", { x: mitte, y: H - 8, "text-anchor": "middle" });
        var d = ausIso(v.tage[anfang]);
        beschriftung.textContent = (wechsel.length > 9
          ? d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })
          : d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }));
        gitter.appendChild(beschriftung);
      });
    } else {
      var jeder = Math.max(1, Math.ceil(n / 12));
      for (var h = 0; h < n; h += jeder) {
        var t2 = s("text", { x: X(h), y: H - 8, "text-anchor": "middle" });
        t2.textContent = v.marken[h] + (v.stuendlich ? "" : "");
        gitter.appendChild(t2);
      }
    }
    var einheit = s("text", { x: links - 6, y: oben - 12, "text-anchor": "end",
      "class": "pf-achsentitel" });
    einheit.textContent = v.einheit;
    gitter.appendChild(einheit);
    svg.appendChild(gitter);

    /* Gestapelte Flaechen mit 2 px Fuge in der Flaechenfarbe des Untergrunds,
       damit die Grenze zwischen zwei Baendern sichtbar bleibt. */
    var gFl = s("g", { "class": "pf-flaechen" });
    stapel.forEach(function (b) {
      if (b.reihe.summe <= 0) { return; }
      var d = "M" + X(0).toFixed(1) + " " + Y(b.unten[0]).toFixed(1), k;
      for (k = 0; k < n; k++) { d += "L" + X(k).toFixed(1) + " " + Y(b.oben[k]).toFixed(1); }
      for (k = n - 1; k >= 0; k--) { d += "L" + X(k).toFixed(1) + " " + Y(b.unten[k]).toFixed(1); }
      gFl.appendChild(s("path", {
        d: d + "Z", fill: "var(" + b.reihe.token + ")",
        stroke: "var(--flaeche)", "stroke-width": "2", "stroke-linejoin": "round"
      }));
    });
    svg.appendChild(gFl);

    /* Netzlast als 2-px-Linie in Textfarbe. Sie ist kein Energietraeger und
       bekommt deshalb keinen Traegerfarbton. */
    var dl = "";
    v.netzlast.forEach(function (x, k) {
      if (x === null) { return; }
      dl += (dl ? "L" : "M") + X(k).toFixed(1) + " " + Y(x).toFixed(1);
    });
    if (dl) { svg.appendChild(s("path", { d: dl, "class": "pf-lastlinie", fill: "none" })); }

    var kreuz = s("line", { "class": "pf-kreuz", y1: oben, y2: H - unten, x1: "-99", x2: "-99" });
    svg.appendChild(kreuz);
    huelle.appendChild(svg);

    /* Die Ablesung steht in einem festen Kasten unter dem Bild, nicht in einem
       schwebenden Tooltip: der ist auf dem Handy nicht zu treffen und
       verschwindet, sobald man ihn lesen will. */
    var ablesung = el("div", { "class": "pf-ablesung", role: "status" });
    huelle.appendChild(ablesung);

    var stelle = Math.min(Math.floor(n / 2), n - 1);

    function zeige(k) {
      stelle = k;
      kreuz.setAttribute("x1", X(k));
      kreuz.setAttribute("x2", X(k));
      ablesung.textContent = "";
      ablesung.appendChild(el("strong", {
        text: v.stuendlich
          ? datumLang(v.tage[k]) + ", " + v.marken[k] + ":00 Uhr"
          : datumLang(v.tage[k])
      }));
      var liste = el("div", { "class": "pf-ablesung-liste" });
      if (v.netzlast[k] !== null) {
        var zl = el("span", { "class": "pf-ablesung-zeile" });
        zl.appendChild(el("i", { "class": "pf-strich pf-last" }));
        zl.appendChild(document.createTextNode(
          " Netzlast " + nf1.format(v.netzlast[k] / v.teiler) + " " + v.einheit));
        liste.appendChild(zl);
      }
      v.reihen.slice().reverse().forEach(function (r) {
        if (!r.werte[k]) { return; }
        var z = el("span", { "class": "pf-ablesung-zeile" });
        z.appendChild(el("i", { style: "background:var(" + r.token + ");" }));
        z.appendChild(document.createTextNode(
          " " + r.name + " " + nf1.format(r.werte[k] / v.teiler)));
        liste.appendChild(z);
      });
      ablesung.appendChild(liste);
    }

    function ausPosition(punkt) {
      var kasten = svg.getBoundingClientRect();
      var px = (punkt.clientX - kasten.left) / kasten.width * B;
      var k = Math.round((px - links) / innenB * (n - 1));
      zeige(Math.max(0, Math.min(n - 1, k)));
    }
    svg.addEventListener("mousemove", ausPosition);
    svg.addEventListener("touchmove", function (e) {
      if (e.touches.length) { ausPosition(e.touches[0]); }
    }, { passive: true });
    svg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { zeige(Math.min(n - 1, stelle + 1)); }
      else if (e.key === "ArrowLeft") { zeige(Math.max(0, stelle - 1)); }
      else { return; }
      e.preventDefault();
    });
    zeige(stelle);

    /* Legende. Bei acht Baendern Pflicht; der Anteil steht dabei, damit die
       Identitaet nicht allein an der Farbe haengt. */
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
    huelle.appendChild(legende);

    /* Tabellenansicht. Pflicht, damit die Zahlen auch ohne Farbe lesbar sind --
       und weil der Goldton der Photovoltaik den Kontrastwert 3:1 gegen die
       helle Flaeche nicht erreicht. */
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
  function redispatch(von, bis) {
    var gesamt = 0, hoch = 0, runter = 0, massnahmen = 0;
    var jeUenb = {}, jeArt = {}, mitMassnahme = 0, belegteTage = 0, gefunden = false;
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
    });
    if (!gefunden) { return null; }
    return { gesamt: gesamt, hoch: hoch, runter: runter, massnahmen: massnahmen,
             jeUenb: jeUenb, jeArt: jeArt, tageMitMassnahme: mitMassnahme,
             belegteTage: belegteTage };
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

    var spalten = el("div", { "class": "pf-rd-spalten" });
    spalten.appendChild(balken("Angewiesen von", r.jeUenb, "var(--violett)"));
    spalten.appendChild(balken("Betroffene Erzeugung", r.jeArt, "var(--teal)"));
    huelle.appendChild(spalten);

    huelle.appendChild(el("p", { "class": "pf-karte-warnung",
      text: "Redispatch heißt: ein Netzbetreiber greift in den Kraftwerkseinsatz ein, "
        + "weil das Netz den geplanten Transport nicht trägt. Es sagt, WO das Netz an "
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
    kopfzeile.appendChild(themaKnopf);
    kopf.appendChild(kopfzeile);
    neu.appendChild(kopf);

    // --- Der einzige Regler: der Zeitraum ---
    var regler = el("div", { "class": "pf-regler" });
    regler.appendChild(el("span", { "class": "pf-regler-titel",
      text: "Zeitraum — die einzige freie Variable" }));

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
    regler.appendChild(el("p", { "class": "pf-regler-fuss",
      text: "Wählbar vom " + datumLang(Z.minTag) + " bis zum " + datumLang(Z.maxTag)
        + ". Ein einzelner Tag wird stündlich gezeigt, ein längerer Zeitraum tageweise. "
        + "Zurücksetzen stellt den Zeitraum des ersten Seitenaufrufs wieder her." }));
    neu.appendChild(abschnitt("Freie Variable", regler));

    if (!k) {
      neu.appendChild(el("div", { "class": "pf-fehler",
        text: "Für diesen Zeitraum liegen keine Daten vor." }));
      Z.wurzel.parentNode.replaceChild(neu, Z.wurzel);
      Z.wurzel = neu;
      return;
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
      bezug: (k.saldo >= 0 ? "Netto-Zufluss" : "Netto-Abfluss") + " · "
        + bezugstext(k.saldo, v.saldo, vv, vb),
      info: {
        wert: "Import minus Export über alle Nachbarländer im Zeitraum.",
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
        marke: "Eingriff ins Netz — kein Lastfluss",
        info: {
          wert: "Summe der Redispatch-Arbeit aus " + rd.massnahmen.toLocaleString("de-DE")
            + " Maßnahmen der vier Übertragungsnetzbetreiber.",
          grenzenTitel: "Was die Zahl bedeutet",
          grenzen: "Redispatch heißt: ein Netzbetreiber greift in den Kraftwerkseinsatz "
            + "ein, weil das Netz den geplanten Transport nicht trägt. Die Zahl sagt, "
            + "wie viel Energie dafür verschoben wurde — nicht, wie viel über eine "
            + "einzelne Leitung floss. Die Reihe beginnt 2021.",
          quellen: QUELLE_RD,
          messung: "Messung. Die Zuordnung zum Kalendertag ist eine benannte Annahme."
        }
      }));
    }
    neu.appendChild(abschnitt("Kennzahlen · " + zeitraumLang(von, bis), kacheln));

    // --- Warnungen zum Zeitraum ---
    var warnungen = [];
    if (k.belegt < k.tage) {
      warnungen.push("Von " + k.tage + " Kalendertagen des Zeitraums liegen nur " + k.belegt
        + " mit Daten vor. Die Summen beziehen sich auf die belegten Tage; fehlende werden "
        + "nicht als Null gezählt.");
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
    var tr = traeger(von, bis);
    var maxZu = Math.max.apply(null, tr.map(function (e) { return e.mwh; }));
    fluss.appendChild(saeule("zufluss", "Zufluss · Erzeugung", gwh(k.erzeugung, 1) + " GWh",
      balkenliste(tr, "var(--teal)", maxZu)));

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
    fluss.appendChild(saeule("netz", "Netz · Regelzonen", gwh(k.netzlast, 1) + " GWh Netzlast",
      netzInhalt));

    var ll = laender(von, bis);
    var ab = ll.filter(function (a) { return a.exp > 0; })
      .map(function (a) { return { name: a.land, mwh: a.exp }; })
      .sort(function (a, b) { return b.mwh - a.mwh; });
    var maxAb = Math.max.apply(null, ab.map(function (e) { return e.mwh; }));
    fluss.appendChild(saeule("abfluss", "Abfluss · Export", gwh(k.exp, 1) + " GWh",
      balkenliste(ab, "var(--orange)", maxAb)));
    neu.appendChild(abschnitt("Zufluss · Netz · Abfluss (GWh im Zeitraum)", fluss));

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
      K.sichtSetzen({ x: 0, y: 0, w: K.breite, h: K.hoehe });
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

    var legende = el("div", { "class": "pf-legende" });
    EBENEN.forEach(function (e) {
      var sp = el("span");
      sp.appendChild(el("i", { "class": "pf-strich", style: "background:" + e.farbe + ";" }));
      sp.appendChild(document.createTextNode(e.name));
      legende.appendChild(sp);
    });
    Object.keys(ZONENFARBE).forEach(function (z) {
      var sp = el("span");
      sp.appendChild(el("i", { style: "background:" + ZONENFARBE[z] + ";" }));
      sp.appendChild(document.createTextNode(z));
      legende.appendChild(sp);
    });
    var spI = el("span");
    spI.appendChild(el("i", { style: "background:var(--teal);" }));
    spI.appendChild(document.createTextNode("Pfeil nach innen: Zufluss"));
    legende.appendChild(spI);
    var spE = el("span");
    spE.appendChild(el("i", { style: "background:var(--orange);" }));
    spE.appendChild(document.createTextNode("Pfeil nach außen: Abfluss"));
    legende.appendChild(spE);
    legende.appendChild(el("span", { text: "Punktfläche ∝ Nettoleistung" }));
    karteHuelle.appendChild(legende);

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

    // --- Grenzen ---
    var nicht = el("div", { "class": "pf-kasten" });
    nicht.appendChild(el("h3", { text: "Was diese Seite nicht zeigt" }));
    var ul = el("ul");
    [
      "Flüsse zwischen den vier Regelzonen. Deutschland und Luxemburg bilden EINE Gebotszone; "
        + "die EU-Verordnung 543/2013 verlangt die Veröffentlichung physikalischer Flüsse nur "
        + "zwischen Gebotszonen. Der Zonensaldo ist kein Ersatz.",
      "Flüsse auf einzelnen Hoch- und Höchstspannungsleitungen. Nach § 23c Abs. 2 EnWG werden "
        + "grenzüberschreitende Lastflüsse nur zusammengefasst je Kuppelstelle veröffentlicht. "
        + "Öffentliche Leitungsauslastungen sind Modellrechnungen.",
      "Lastflüsse auf den gezeichneten Leitungen. Die Karte zeigt ihren Verlauf und ihre "
        + "Spannungsebene, mehr gibt die Quellenlage nicht her.",
      "Redispatch auf der Karte. Das Feld BETROFFENE_ANLAGE nennt teilweise "
        + "Blocknamen; eine Zuordnung zu den Kraftwerkskoordinaten steht noch aus."
    ].forEach(function (t) { ul.appendChild(el("li", { text: t })); });
    nicht.appendChild(ul);
    neu.appendChild(abschnitt("Grenzen", nicht));

    var offen = el("div", { "class": "pf-kasten", "data-art": "offen" });
    offen.appendChild(el("h3", { text: "Offene Punkte" }));
    var ul2 = el("ul");
    [
      "Regelzonen als Fläche auf der Karte — dafür fehlt eine belegbare Geometrie.",
      "Richtung des Stromflusses innerhalb Deutschlands. Gezeigt wird sie nur an den "
        + "Kuppelstellen, weil sie nur dort gemessen ist.",
      "Import und Export im Verlauf — bisher nur als Summe des Zeitraums.",
      "Anlagen aus dem Marktstammdatenregister: Wind- und Solarparks fehlen auf der Karte, "
        + "weil die SMARD-Stammdaten sie nicht einzeln führen.",
      "Methodik-PDF und der Gesamtlauf über alle Referenzjahre fehlen noch.",
      "Der Kraftwerks-Endpunkt von SMARD ist undokumentiert und kann sich ohne Ankündigung "
        + "ändern."
    ].forEach(function (t) { ul2.appendChild(el("li", { text: t })); });
    offen.appendChild(ul2);
    neu.appendChild(abschnitt("Was noch fehlt", offen));

    // --- Downloads ---
    var abzuege = el("div", { "class": "pf-abzuege" });
    var csvKnopf = el("button", { "class": "pf-abzug", type: "button",
      text: "Bilanz " + zeitraumKurz(von, bis) });
    csvKnopf.appendChild(el("span", { text: "CSV" }));
    csvKnopf.addEventListener("click", function () { csvHerunterladen(von, bis); });
    abzuege.appendChild(csvKnopf);
    [
      { d: "data/tage/" + von.slice(0, 4) + ".json", t: "Tagesreihen " + von.slice(0, 4), e: "JSON" },
      { d: "data/kraftwerke.json", t: "Kraftwerksstandorte", e: "JSON" },
      { d: "data/grundkarte.json", t: "Grundkarte", e: "JSON" }
    ].forEach(function (a) {
      var link = el("a", { "class": "pf-abzug", href: a.d, download: "", text: a.t });
      link.appendChild(el("span", { text: a.e }));
      abzuege.appendChild(link);
    });
    neu.appendChild(abschnitt("Downloads", abzuege));

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
      // Die beiden voreingestellten Netzebenen. Die 110-kV-Ebene wird erst
      // geladen, wenn jemand sie einschaltet -- sie ist 5,9 MB gross.
      netzLaden("hoechstspannung"),
      netzLaden("umspannwerke")
    ]).then(function (teile) {
      Z.verzeichnis = teile[0];
      Z.grundkarte = teile[1];
      Z.kraftwerke = teile[2];
      Z.rdVerzeichnis = teile[3];
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
