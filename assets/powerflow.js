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
  var VERSION = "20260830-netz";

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
  function vorjahrstag(iso) {
    var t = iso.split("-");
    // Der 29. Februar hat kein Gegenstueck im Vorjahr. Dann gibt es keinen
    // Bezugswert -- der wird als fehlend angezeigt, nicht ersetzt.
    return (Number(t[0]) - 1) + "-" + t[1] + "-" + t[2];
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
    jahre: {},          // Jahr -> geladene Jahresdatei
    tag: null,
    starttag: null,     // fuer den Zuruecksetzen-Knopf
    minTag: null,
    maxTag: null,
    wurzel: null,
    // Netzgeometrie aus OpenStreetMap, ODbL. Wird erst geladen, wenn die
    // zugehoerige Ebene eingeschaltet wird -- die 110-kV-Ebene allein ist
    // 5,9 MB gross.
    netz: {},
    ebenen: {
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
    if (Z.jahre[jahr]) { return Promise.resolve(Z.jahre[jahr]); }
    var eintrag = Z.verzeichnis.jahre.filter(function (j) { return j.jahr === jahr; })[0];
    if (!eintrag) { Z.jahre[jahr] = null; return Promise.resolve(null); }
    return fetch(eintrag.datei + "?v=" + VERSION).then(function (r) {
      if (!r.ok) { throw new Error(eintrag.datei + ": HTTP " + r.status); }
      return r.json();
    }).then(function (d) { Z.jahre[jahr] = d; return d; });
  }

  /* Liest einen Wert aus einer Jahresdatei ueber einen Schluesselpfad. */
  function wert(iso, pfad) {
    var jahr = Number(iso.slice(0, 4));
    var d = Z.jahre[jahr];
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

  function summeUeber(iso, gruppe, unterschluessel) {
    var jahr = Number(iso.slice(0, 4));
    var d = Z.jahre[jahr];
    if (!d) { return null; }
    var i = d.tage.indexOf(iso);
    if (i < 0) { return null; }
    var quelle = d[gruppe];
    var s = 0, gefunden = false;
    Object.keys(quelle).forEach(function (k) {
      var reihe = unterschluessel ? quelle[k][unterschluessel] : quelle[k];
      if (reihe && reihe[i] !== null && reihe[i] !== undefined) {
        s += reihe[i]; gefunden = true;
      }
    });
    return gefunden ? s : null;
  }

  /* Alle Kennzahlen eines Tages an einer Stelle. Wird fuer den gewaehlten Tag
     und fuer den Vorjahrestag mit derselben Funktion gerechnet -- damit kann
     der Vergleich nicht auseinanderlaufen. */
  function kennzahlen(iso) {
    var netzlast = wert(iso, ["netzlast"]);
    if (netzlast === null) { return null; }
    var erzeugung = summeUeber(iso, "erzeugung");
    var imp = summeUeber(iso, "aussenhandel", "import");
    var exp = summeUeber(iso, "aussenhandel", "export");
    var saldo = (imp === null || exp === null) ? null : imp - exp;
    return {
      tag: iso,
      netzlast: netzlast,
      erzeugung: erzeugung,
      residuallast: wert(iso, ["residuallast"]),
      pumpen: wert(iso, ["pumpspeicherverbrauch"]),
      imp: imp,
      exp: exp,
      saldo: saldo,
      rest: (erzeugung === null || saldo === null) ? null : erzeugung + saldo - netzlast,
      leistung: netzlast / 24
    };
  }

  function traeger(iso) {
    var jahr = Number(iso.slice(0, 4));
    var d = Z.jahre[jahr];
    if (!d) { return []; }
    var i = d.tage.indexOf(iso);
    return Object.keys(d.erzeugung).map(function (name) {
      return { name: name, mwh: d.erzeugung[name][i] };
    }).filter(function (e) { return e.mwh !== null; })
      .sort(function (a, b) { return b.mwh - a.mwh; });
  }

  function zonen(iso) {
    var jahr = Number(iso.slice(0, 4));
    var d = Z.jahre[jahr];
    if (!d) { return []; }
    var i = d.tage.indexOf(iso);
    return Object.keys(d.regelzonen).map(function (z) {
      var w = d.regelzonen[z];
      var g = 0, fehlend = [];
      Object.keys(w.erzeugung).forEach(function (t) {
        var v = w.erzeugung[t][i];
        if (v === null || v === undefined) { fehlend.push(t); } else { g += v; }
      });
      return { zone: z, netzlast: w.netzlast[i], erzeugung: g, saldo: g - w.netzlast[i],
               fehlend: fehlend };
    });
  }

  function laender(iso) {
    var jahr = Number(iso.slice(0, 4));
    var d = Z.jahre[jahr];
    if (!d) { return []; }
    var i = d.tage.indexOf(iso);
    return Object.keys(d.aussenhandel).map(function (l) {
      var a = d.aussenhandel[l];
      return { land: l, imp: a["import"][i], exp: a.export[i],
               saldo: (a["import"][i] === null || a.export[i] === null)
                 ? null : a["import"][i] - a.export[i] };
    }).filter(function (x) { return x.saldo !== null; })
      .sort(function (a, b) { return b.saldo - a.saldo; });
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
    k.appendChild(el("p", { "class": "pf-marke", text: o.marke || "kein Regler — gemessener Tageswert" }));
    if (o.info) { infoKnopf(k, o.info, o.titel); }
    return k;
  }

  /* Bezugszeile: derselbe Kalendertag im Vorjahr, realer Messwert. */
  function bezugstext(heute, vorher, iso) {
    if (vorher === null || vorher === undefined) {
      return "kein Vergleichswert für " + vorjahrstag(iso) + " vorhanden";
    }
    var p = prozent(heute, vorher);
    return gwh(vorher, 1) + " GWh am " + vorjahrstag(iso) + " · "
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

  var svgNS = "http://www.w3.org/2000/svg";
  function s(tag, attrs) {
    var n = document.createElementNS(svgNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
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

  function karte(grundkarte, anlagen) {
    var B = 640, H = 800, rand = 16;

    // Rahmen aus der Geometrie der Bundeslaender, nicht aus den Anlagen:
    // die Karte soll Deutschland zeigen, nicht die Huelle der Kraftwerke.
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
    var skala = Math.min((B - 2 * rand) / spanX, (H - 2 * rand) / spanY);
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

    var svg = s("svg", {
      "class": "pf-karte", viewBox: "0 0 " + B + " " + H, role: "img",
      "aria-label": "Karte Deutschlands mit Hoechstspannungsnetz, Umspannwerken und den "
        + "Standorten von " + anlagen.length + " Kraftwerken"
    });

    var gNachbarn = s("g", { "class": "pf-geo-nachbar" });
    grundkarte.nachbarn.forEach(function (n) {
      n.ringe.forEach(function (r) { gNachbarn.appendChild(s("path", { d: ringPfad(r) })); });
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
       Deshalb EIN Pfadelement je Spannungsebene mit vielen Teilzuegen. Preis
       dafuer: kein eigener Tooltip je Leitung. Das ist es wert -- die Leitung
       traegt ohnehin keine Zahl, die man ablesen koennte. */
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
        c.appendChild(s("title")).textContent =
          (w.n || "Umspannwerk") + " · " + e.name + (w.b ? " · " + w.b : "");
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
        c.appendChild(s("title")).textContent =
          (a.ort || "") + " · " + (a.energietraeger || "") + " · " + nf0.format(mw) + " MW · "
          + a.regelzone + (a.staat && a.staat !== "Deutschland" ? " · " + a.staat : "");
        gPunkte.appendChild(c);
      });
      svg.appendChild(gPunkte);
    }
    return svg;
  }

  /* Ebenen-Schalter. Das ist KEIN Regler im Sinne der Datendisziplin: er
     veraendert keine Zahl, sondern nur, was sichtbar ist. Die einzige freie
     Variable bleibt der Kalendertag. */
  function ebenenSchalter() {
    var kasten = el("div", { "class": "pf-ebenen" });
    [
      { schluessel: "kraftwerke", text: "Kraftwerke", geladen: true },
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

  // ---- CSV-Export ---------------------------------------------------------
  // Wird aus dem gewaehlten Tag erzeugt, damit der Abzug immer zu dem passt,
  // was auf der Seite steht.

  function csvBauen(iso) {
    var k = kennzahlen(iso);
    var v = kennzahlen(vorjahrstag(iso));
    var z = [
      "# PowerFlow -- Tagesbilanz des deutschen Stromsystems",
      "# Tag (Ortszeit Europe/Berlin): " + iso,
      "# Vergleichstag: " + vorjahrstag(iso) + " (realer Messwert desselben Kalendertags,",
      "#   kein Monatsmittel und keine geglaettete Kurve)",
      "# Quelle: SMARD, Bundesnetzagentur -- https://www.smard.de/",
      "# Lizenz: CC BY 4.0",
      "# Namensnennung: Bundesnetzagentur | SMARD.de",
      "# Erzeugt: " + new Date().toLocaleString("de-DE"),
      "#",
      "# Einheit: MWh je Tag. Die SMARD-Reihen liefern eine Energiemenge je",
      "# Intervall, keine mittlere Leistung. Nachgewiesen aus den Daten selbst:",
      "# der Stundenwert ist die Summe der vier Viertelstundenwerte.",
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
      "# Freie Variable ist der Kalendertag. Alles Uebrige ist gemessen.",
      "#",
      "gruppe,name,tag,wert_mwh,vergleichstag,wert_mwh_vorjahr"
    ];
    function zeile(gruppe, name, a, b) {
      z.push([gruppe, name, iso, a === null ? "" : a.toFixed(2),
              vorjahrstag(iso), (b === null || b === undefined) ? "" : b.toFixed(2)].join(","));
    }
    zeile("kennzahl", "netzlast", k.netzlast, v && v.netzlast);
    zeile("kennzahl", "erzeugung", k.erzeugung, v && v.erzeugung);
    zeile("kennzahl", "residuallast", k.residuallast, v && v.residuallast);
    zeile("kennzahl", "pumpspeicherverbrauch", k.pumpen, v && v.pumpen);
    zeile("kennzahl", "import", k.imp, v && v.imp);
    zeile("kennzahl", "export", k.exp, v && v.exp);
    zeile("kennzahl", "aussensaldo", k.saldo, v && v.saldo);
    zeile("kennzahl", "bilanzrest", k.rest, v && v.rest);
    var tv = {};
    traeger(vorjahrstag(iso)).forEach(function (e) { tv[e.name] = e.mwh; });
    traeger(iso).forEach(function (e) { zeile("erzeugung", e.name, e.mwh, tv[e.name]); });
    var zv = {};
    zonen(vorjahrstag(iso)).forEach(function (e) { zv[e.zone] = e; });
    zonen(iso).forEach(function (e) {
      zeile("regelzone_netzlast", e.zone, e.netzlast, zv[e.zone] && zv[e.zone].netzlast);
      zeile("regelzone_erzeugung", e.zone, e.erzeugung, zv[e.zone] && zv[e.zone].erzeugung);
      zeile("regelzone_saldo", e.zone, e.saldo, zv[e.zone] && zv[e.zone].saldo);
    });
    var lv = {};
    laender(vorjahrstag(iso)).forEach(function (e) { lv[e.land] = e; });
    laender(iso).forEach(function (e) {
      zeile("import", e.land, e.imp, lv[e.land] && lv[e.land].imp);
      zeile("export", e.land, e.exp, lv[e.land] && lv[e.land].exp);
    });
    return z.join("\n") + "\n";
  }

  function csvHerunterladen(iso) {
    var blob = new Blob([csvBauen(iso)], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url, download: "powerflow-tagesbilanz-" + iso + ".csv" });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---- Zeichnen -----------------------------------------------------------

  function zeichnen() {
    var iso = Z.tag;
    var k = kennzahlen(iso);
    var v = kennzahlen(vorjahrstag(iso)) || {};
    var neu = el("div", { "class": "pf-huelle" });

    // --- Kopf ---
    var kopf = el("header", { "class": "pf-kopf" });
    var kopfzeile = el("div", { "class": "pf-kopfzeile" });
    var links = el("div");
    links.appendChild(el("h1", { text: "Deutschland · Stromfluss-Labor" }));
    links.appendChild(el("p", {
      "class": "pf-unterzeile",
      text: "Tagesbilanz des deutschen Stromsystems am " + datumLang(iso)
        + ". Alle Zahlen sind gemessene Tageswerte."
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

    // --- Der einzige Regler: der Kalendertag ---
    var regler = el("div", { "class": "pf-regler" });
    var reglerKopf = el("div", { "class": "pf-regler-kopf" });
    reglerKopf.appendChild(el("label", {
      "class": "pf-regler-titel", "for": "pf-tagwahl",
      text: "Kalendertag — die einzige freie Variable"
    }));
    regler.appendChild(reglerKopf);

    var reihe = el("div", { "class": "pf-regler-reihe" });
    var zurueckKnopf = el("button", {
      "class": "pf-schritt", type: "button", "aria-label": "Einen Tag zurück", text: "‹"
    });
    var feld = el("input", {
      "class": "pf-tagfeld", type: "date", id: "pf-tagwahl", value: iso,
      min: Z.minTag, max: Z.maxTag
    });
    var vorKnopf = el("button", {
      "class": "pf-schritt", type: "button", "aria-label": "Einen Tag vor", text: "›"
    });
    zurueckKnopf.disabled = iso <= Z.minTag;
    vorKnopf.disabled = iso >= Z.maxTag;
    zurueckKnopf.addEventListener("click", function () { tagSetzen(verschoben(iso, -1)); });
    vorKnopf.addEventListener("click", function () { tagSetzen(verschoben(iso, 1)); });
    feld.addEventListener("change", function () { if (feld.value) { tagSetzen(feld.value); } });
    reihe.appendChild(zurueckKnopf);
    reihe.appendChild(feld);
    reihe.appendChild(vorKnopf);

    var zurueck = el("button", {
      "class": "pf-zuruecksetzen", type: "button",
      text: "Zurücksetzen"
    });
    zurueck.disabled = iso === Z.starttag;
    zurueck.addEventListener("click", function () { tagSetzen(Z.starttag); });
    reihe.appendChild(zurueck);
    regler.appendChild(reihe);
    regler.appendChild(el("p", {
      "class": "pf-regler-fuss",
      text: "Wählbar vom " + datumLang(Z.minTag) + " bis zum " + datumLang(Z.maxTag)
        + ". Zurücksetzen stellt den Tag des ersten Seitenaufrufs wieder her ("
        + datumLang(Z.starttag) + ")."
    }));
    neu.appendChild(abschnitt("Freie Variable", regler));

    // --- Kennzahlen ---
    var kacheln = el("div", { "class": "pf-kacheln" });

    kacheln.appendChild(kachel({
      titel: "Netzlast", wert: gwh(k.netzlast, 1), einheit: "GWh", akzent: "violett",
      bezug: bezugstext(k.netzlast, v.netzlast, iso),
      info: {
        wert: "SMARD-Filter 410 „Realisierter Stromverbrauch, Gesamt (Netzlast)“, Region DE, "
          + "Tageswert in der Auflösung „day“. Gegen die eigene Viertelstundenreihe geprüft: "
          + "Abweichung 0,02 MWh.",
        grenzenTitel: "Was die Zahl umfasst",
        grenzen: "Verbrauch im Netz der allgemeinen Versorgung. Der Pumpspeicherverbrauch ist "
          + "darin enthalten — nachgewiesen daran, dass die Tagesbilanz nur so aufgeht. Nicht "
          + "enthalten ist Strom, den Industriebetriebe selbst erzeugen und selbst verbrauchen.",
        quellen: QUELLE_SMARD,
        messung: "Messung. Der Vergleichswert ist der reale Messwert desselben Kalendertags "
          + "im Vorjahr, keine Annahme."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Erzeugung", wert: gwh(k.erzeugung, 1), einheit: "GWh", akzent: "teal",
      bezug: bezugstext(k.erzeugung, v.erzeugung, iso),
      info: {
        wert: "Summe der elf SMARD-Erzeugungsreihen für Region DE.",
        grenzenTitel: "Was fehlt",
        grenzen: "Kernenergie ist nicht enthalten: die Reihe (Filter 1224) endet am "
          + "15.04.2023 um 23:45 Uhr. Für spätere Zeiträume liefert SMARD HTTP 404, nicht "
          + "den Wert Null.",
        quellen: QUELLE_SMARD, messung: "Messung. Keine Annahme."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Import", wert: gwh(k.imp, 1), einheit: "GWh", akzent: "teal",
      bezug: bezugstext(k.imp, v.imp, iso),
      info: {
        wert: "Summe der stündlichen SMARD-Importreihen je Nachbarland (physikalischer "
          + "Stromfluss), auf den Tag summiert. Die Reihen sind vorzeichenlos positiv.",
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
      bezug: bezugstext(k.exp, v.exp, iso),
      info: {
        wert: "Summe der stündlichen SMARD-Exportreihen je Nachbarland, auf den Tag summiert.",
        grenzenTitel: "Auflösung und Beleg",
        grenzen: "Wie beim Import: stündlich, Filter-IDs empirisch belegt.",
        quellen: QUELLE_SMARD, messung: "Messung. Zuordnung der IDs belegt hergeleitet."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Außensaldo", wert: vz(k.saldo, 1), einheit: "GWh",
      akzent: k.saldo >= 0 ? "teal" : "orange",
      bezug: (k.saldo >= 0 ? "Netto-Zufluss" : "Netto-Abfluss") + " · "
        + bezugstext(k.saldo, v.saldo, iso),
      info: {
        wert: "Import minus Export über alle Nachbarländer.",
        grenzenTitel: "Was der Saldo nicht sagt",
        grenzen: "Der Saldo sagt nichts darüber, welchen Weg der Strom im deutschen Netz "
          + "genommen hat. Flüsse zwischen den vier Regelzonen werden nicht veröffentlicht.",
        quellen: QUELLE_SMARD, messung: "Messung."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Bilanzrest", wert: vz(k.rest, 2), einheit: "GWh",
      bezug: (k.rest === null ? "—" : nf2.format(k.rest / k.netzlast * 100) + " % der Netzlast")
        + " · " + bezugstext(k.rest, v.rest, iso),
      marke: "Selbstkontrolle — geht nicht auf null auf",
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
    neu.appendChild(abschnitt("Kennzahlen des Tages", kacheln));

    // --- Warnungen zum gewaehlten Tag ---
    var warnungen = [];
    var jd = Z.jahre[Number(iso.slice(0, 4))];
    (jd && jd.auffaellig ? jd.auffaellig : []).forEach(function (a) {
      if (a.tag !== iso) { return; }
      warnungen.push("Die Quelle liefert für " + a.reihe + " an diesem Tag "
        + nf0.format(a.originalwert) + " MWh. Das ist um Größenordnungen zu viel und "
        + "kann nicht stimmen. Der Wert wird hier als fehlend geführt — nicht korrigiert "
        + "und nicht geschätzt. Der Originalwert steht in data/tage/"
        + iso.slice(0, 4) + ".json unter „auffaellig“.");
    });
    if (iso < "2019-01-01") {
      warnungen.push("Für Tage vor 2019 ist die Aufteilung auf die vier Regelzonen in der "
        + "Quelle unvollständig: 2015 fehlen an einzelnen Tagen bis zu 3,4 % der Last. Die "
        + "Zonenwerte dieses Tages sind deshalb mit Vorsicht zu lesen. Die Ursache ist nicht "
        + "geklärt.");
    }
    if (k.rest !== null && Math.abs(k.rest / k.netzlast * 100) > 5) {
      warnungen.push("Die Tagesbilanz dieses Tages geht um "
        + nf1.format(Math.abs(k.rest / k.netzlast * 100)) + " % nicht auf. Das liegt über dem "
        + "üblichen Bereich. Erzeugung, Import und Export der Quelle passen an diesem Tag "
        + "nicht zur Netzlast.");
    }
    if (warnungen.length) {
      var warnkasten = el("div", { "class": "pf-kasten" });
      warnkasten.appendChild(el("h3", { text: "Zu diesem Tag" }));
      var wul = el("ul");
      warnungen.forEach(function (w) { wul.appendChild(el("li", { text: w })); });
      warnkasten.appendChild(wul);
      neu.appendChild(abschnitt("Hinweise zur Datenlage", warnkasten));
    }

    // --- Flussbild ---
    var fluss = el("div", { "class": "pf-fluss" });
    var tr = traeger(iso);
    var maxZu = Math.max.apply(null, tr.map(function (e) { return e.mwh; }));
    fluss.appendChild(saeule("zufluss", "Zufluss · Erzeugung", gwh(k.erzeugung, 1) + " GWh",
      balkenliste(tr, "var(--teal)", maxZu)));

    var netzInhalt = el("div");
    var zz = zonen(iso).sort(function (a, b) { return b.saldo - a.saldo; });
    var maxAbs = Math.max.apply(null, zz.map(function (x) { return Math.abs(x.saldo); }));
    zz.forEach(function (x) {
      var h = el("div", { "class": "pf-balken" });
      var zeileEl = el("div", { "class": "pf-zeile" });
      zeileEl.appendChild(el("span", { "class": "pf-name", text: x.zone }));
      zeileEl.appendChild(el("span", { "class": "pf-zahl", text: vz(x.saldo, 1) }));
      h.appendChild(zeileEl);
      var schiene = el("div", { "class": "pf-schiene" });
      schiene.appendChild(el("div", {
        "class": "pf-fuellung",
        style: "width:" + (Math.abs(x.saldo) / maxAbs * 100).toFixed(1) + "%;background:"
          + (x.saldo >= 0 ? "var(--teal)" : "var(--orange)") + ";"
      }));
      h.appendChild(schiene);
      netzInhalt.appendChild(h);
    });
    netzInhalt.appendChild(el("p", {
      "class": "pf-bezug",
      text: "Saldo = Erzeugung minus Netzlast je Regelzone, in GWh. Der Austausch mit allen "
        + "Nachbarn zusammen — anderen Regelzonen und Ausland. Kein Fluss von einer Zone in "
        + "eine andere."
    }));
    fluss.appendChild(saeule("netz", "Netz · Regelzonen", gwh(k.netzlast, 1) + " GWh Netzlast",
      netzInhalt));

    var ll = laender(iso);
    var ab = ll.filter(function (a) { return a.exp > 0; })
      .map(function (a) { return { name: a.land, mwh: a.exp }; })
      .sort(function (a, b) { return b.mwh - a.mwh; });
    var maxAb = Math.max.apply(null, ab.map(function (e) { return e.mwh; }));
    fluss.appendChild(saeule("abfluss", "Abfluss · Export", gwh(k.exp, 1) + " GWh",
      balkenliste(ab, "var(--orange)", maxAb)));
    neu.appendChild(abschnitt("Zufluss · Netz · Abfluss (GWh am Tag)", fluss));

    // --- Karte ---
    var karteHuelle = el("div", { "class": "pf-karte-huelle" });
    var roll = el("div", { "class": "pf-karte-rollbereich" });
    roll.appendChild(karte(Z.grundkarte, Z.kraftwerke.anlagen));
    karteHuelle.appendChild(roll);
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
    legende.appendChild(el("span", { text: "Punktfläche ∝ Nettoleistung" }));
    karteHuelle.appendChild(legende);

    // Dieser Satz steht direkt an der Karte, nicht nur im Popover: eine
    // gezeichnete Leitung soll niemand als Lastfluss lesen.
    karteHuelle.appendChild(el("p", {
      "class": "pf-karte-warnung",
      text: "Die Leitungen zeigen Verlauf und Spannungsebene — keinen Lastfluss und keine "
        + "Auslastung. Wie viel Strom über eine einzelne Leitung fließt, wird nach "
        + "§ 23c Abs. 2 EnWG nicht veröffentlicht."
    }));

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
    ["Nachbarland", "Import GWh", "Export GWh", "Saldo GWh", "Saldo Vorjahrestag"]
      .forEach(function (t) { kopfz.appendChild(el("th", { text: t, scope: "col" })); });
    thead.appendChild(kopfz); tab.appendChild(thead);
    var tbody = el("tbody");
    var lv = {};
    laender(vorjahrstag(iso)).forEach(function (e) { lv[e.land] = e; });
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
      "Redispatch. Noch nicht eingebunden — braucht einen Zugang zur netztransparenz-API."
    ].forEach(function (t) { ul.appendChild(el("li", { text: t })); });
    nicht.appendChild(ul);
    neu.appendChild(abschnitt("Grenzen", nicht));

    var offen = el("div", { "class": "pf-kasten", "data-art": "offen" });
    offen.appendChild(el("h3", { text: "Offene Punkte" }));
    var ul2 = el("ul");
    [
      "Regelzonen als Fläche auf der Karte — dafür fehlt eine belegbare Geometrie.",
      "Mittelspannung — in OpenStreetMap kaum erfasst.",
      "Intraday-Verlauf: die Seite zeigt bisher nur Tagessummen, keine Viertelstundenkurve.",
      "Methodik-PDF und der Gesamtlauf über alle Referenzjahre fehlen noch.",
      "Der Kraftwerks-Endpunkt von SMARD ist undokumentiert und kann sich ohne Ankündigung "
        + "ändern."
    ].forEach(function (t) { ul2.appendChild(el("li", { text: t })); });
    offen.appendChild(ul2);
    neu.appendChild(abschnitt("Was noch fehlt", offen));

    // --- Downloads ---
    var abzuege = el("div", { "class": "pf-abzuege" });
    var csvKnopf = el("button", { "class": "pf-abzug", type: "button",
      text: "Tagesbilanz " + iso });
    csvKnopf.appendChild(el("span", { text: "CSV" }));
    csvKnopf.addEventListener("click", function () { csvHerunterladen(iso); });
    abzuege.appendChild(csvKnopf);
    [
      { d: "data/tage/" + iso.slice(0, 4) + ".json", t: "Tagesreihen " + iso.slice(0, 4), e: "JSON" },
      { d: "data/kraftwerke.json", t: "Kraftwerksstandorte", e: "JSON" },
      { d: "data/grundkarte.json", t: "Grundkarte", e: "JSON" }
    ].forEach(function (a) {
      var link = el("a", { "class": "pf-abzug", href: a.d, download: "", text: a.t });
      link.appendChild(el("span", { text: a.e }));
      abzuege.appendChild(link);
    });
    neu.appendChild(abschnitt("Downloads", abzuege));

    // --- Fussnote ---
    var jahresdatei = Z.jahre[Number(iso.slice(0, 4))];
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
  }

  function tagSetzen(iso) {
    if (iso < Z.minTag) { iso = Z.minTag; }
    if (iso > Z.maxTag) { iso = Z.maxTag; }
    popoverSchliessen();
    var jahr = Number(iso.slice(0, 4));
    Promise.all([jahrLaden(jahr), jahrLaden(jahr - 1)]).then(function () {
      if (kennzahlen(iso) === null) { return; }
      Z.tag = iso;
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
      // Die beiden voreingestellten Netzebenen. Die 110-kV-Ebene wird erst
      // geladen, wenn jemand sie einschaltet -- sie ist 5,9 MB gross.
      netzLaden("hoechstspannung"),
      netzLaden("umspannwerke")
    ]).then(function (teile) {
      Z.verzeichnis = teile[0];
      Z.grundkarte = teile[1];
      Z.kraftwerke = teile[2];
      var jahre = Z.verzeichnis.jahre;
      Z.minTag = jahre[0].erster_tag;
      var letzte = jahre[jahre.length - 1];
      Z.maxTag = letzte.letzter_belegter_tag || letzte.letzter_tag;
      Z.starttag = Z.maxTag;
      var jahr = Number(Z.maxTag.slice(0, 4));
      return Promise.all([jahrLaden(jahr), jahrLaden(jahr - 1)]);
    }).then(function () {
      Z.tag = Z.starttag;
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
