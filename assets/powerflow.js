/* PowerFlow -- Stromfluss-Labor.
 *
 * Ein einziges Modul als IIFE. Es erzeugt sein Markup selbst und haengt es
 * VOR dem Anker #powerflow-anker in der index.html ein. Keine globalen
 * Bindungen: alles liegt im Funktionsraum der IIFE, kein Top-Level-const,
 * das mit einem anderen Skript derselben Seite kollidieren koennte.
 *
 * Kein localStorage. Aller Zustand kommt aus den Dateien unter data/.
 * Datum wird immer lokal formatiert, nie ueber toISOString().
 */
(function () {
  "use strict";

  var ANKER = "powerflow-anker";
  var VERSION = "20260830-rumpf";

  // ---- Formatierung -------------------------------------------------------
  // Anzeige deutsch. Die CSV-Dateien benutzen bewusst den Punkt als
  // Dezimaltrennzeichen; der Unterschied ist in deren Kommentarkopf erklaert.
  var nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function gwh(mwh, stellen) {
    var f = stellen === 2 ? nf2 : stellen === 0 ? nf0 : nf1;
    return f.format(mwh / 1000);
  }

  // Lokale Datumsformatierung. toISOString() waere hier falsch: es rechnet
  // nach UTC und verschiebt in Europa jeden Tag um eins.
  function datumLang(iso) {
    var t = iso.split("-");
    var d = new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]));
    return d.toLocaleDateString("de-DE", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
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

  // ---- Info-Popover -------------------------------------------------------
  // Verhalten laut Nachweispflicht: oeffnet beim Ueberfahren, schliesst beim
  // Wegbewegen des Zeigers, aber NICHT beim Scrollen, solange der zugehoerige
  // Knopf sichtbar bleibt. Klick heftet an, Escape schliesst.

  var offenesPopover = null;
  var offenerKnopf = null;
  var angeheftet = false;

  function popoverSchliessen() {
    if (offenesPopover && offenesPopover.parentNode) {
      offenesPopover.parentNode.removeChild(offenesPopover);
    }
    if (offenerKnopf) { offenerKnopf.setAttribute("aria-expanded", "false"); }
    offenesPopover = null;
    offenerKnopf = null;
    angeheftet = false;
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
    // Dieser Satz fehlt in keinem Popover.
    box.appendChild(el("p", { "class": "pf-messung", text: inhalt.messung }));
    return box;
  }

  function infoKnopf(traeger, inhalt, beschriftung) {
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
      traeger.appendChild(offenesPopover);
    }

    knopf.addEventListener("mouseenter", oeffnen);
    knopf.addEventListener("focus", oeffnen);
    traeger.addEventListener("mouseleave", function () {
      if (!angeheftet && offenerKnopf === knopf) { popoverSchliessen(); }
    });
    knopf.addEventListener("click", function (e) {
      e.stopPropagation();
      if (offenerKnopf === knopf && angeheftet) { popoverSchliessen(); }
      else { oeffnen(); angeheftet = true; }
    });
    traeger.appendChild(knopf);
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
  // Beim Scrollen bleibt das Popover offen, solange sein Knopf sichtbar ist.
  window.addEventListener("scroll", function () {
    if (!offenerKnopf) { return; }
    var r = offenerKnopf.getBoundingClientRect();
    var sichtbar = r.bottom > 0 && r.top < (window.innerHeight || 0);
    if (!sichtbar) { popoverSchliessen(); }
  }, { passive: true });

  // ---- Bausteine ----------------------------------------------------------

  function kachel(o) {
    var k = el("div", { "class": "pf-kachel" });
    if (o.akzent) { k.setAttribute("data-akzent", o.akzent); }
    k.appendChild(el("p", { "class": "pf-titel", text: o.titel }));
    var w = el("p", { "class": "pf-wert", text: o.wert });
    if (o.einheit) { w.appendChild(el("span", { "class": "pf-einheit", text: o.einheit })); }
    k.appendChild(w);
    if (o.bezug) { k.appendChild(el("p", { "class": "pf-bezug", text: o.bezug })); }
    // Gemessenes bekommt keinen Regler, sondern diesen Hinweis.
    k.appendChild(el("p", { "class": "pf-marke", text: o.marke || "kein Regler — gemessener Tageswert" }));
    if (o.info) { infoKnopf(k, o.info, o.titel); }
    return k;
  }

  function balkenliste(eintraege, farbe, maxWert) {
    var liste = el("div", { "class": "pf-balken" });
    eintraege.forEach(function (e) {
      var zeile = el("div", { "class": "pf-zeile" });
      zeile.appendChild(el("span", { "class": "pf-name", text: e.name, title: e.name }));
      zeile.appendChild(el("span", { "class": "pf-zahl", text: gwh(e.mwh, 1) }));
      liste.appendChild(zeile);
      var schiene = el("div", { "class": "pf-schiene" });
      var breite = maxWert > 0 ? Math.max(0, (e.mwh / maxWert) * 100) : 0;
      schiene.appendChild(el("div", {
        "class": "pf-fuellung",
        style: "width:" + breite.toFixed(2) + "%;background:" + farbe + ";"
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
  // Einfache Plattkarten-Projektion auf den Rahmen der Anlagenkoordinaten.
  // Es gibt bewusst noch KEINE Grundkarte: eine Umrissgeometrie muesste erst
  // mit geklaerter Lizenz belegt werden. Die 596 Anlagen stehen an ihren
  // tatsaechlichen Koordinaten.

  var ZONENFARBE = {
    "50Hertz": "var(--teal)",
    "TenneT": "var(--violett)",
    "Amprion": "var(--orange)",
    "TransnetBW": "var(--gruen)"
  };

  function karte(anlagen) {
    var B = 620, H = 800, rand = 18;
    var lats = anlagen.map(function (a) { return a.lat; });
    var lons = anlagen.map(function (a) { return a.lon; });
    var latMin = Math.min.apply(null, lats), latMax = Math.max.apply(null, lats);
    var lonMin = Math.min.apply(null, lons), lonMax = Math.max.apply(null, lons);
    // Laengengrade auf der Breite Deutschlands stauchen, damit die Form stimmt.
    var mittlereBreite = (latMin + latMax) / 2 * Math.PI / 180;
    var kx = Math.cos(mittlereBreite);
    var spanX = (lonMax - lonMin) * kx, spanY = latMax - latMin;
    var skala = Math.min((B - 2 * rand) / spanX, (H - 2 * rand) / spanY);
    var versatzX = (B - spanX * skala) / 2, versatzY = (H - spanY * skala) / 2;

    function px(a) { return versatzX + (a.lon - lonMin) * kx * skala; }
    function py(a) { return versatzY + (latMax - a.lat) * skala; }

    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "pf-karte");
    svg.setAttribute("viewBox", "0 0 " + B + " " + H);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label",
      "Standorte von " + anlagen.length + " Kraftwerken in Deutschland, eingefaerbt nach Regelzone");

    anlagen.forEach(function (a) {
      var mw = a.leistung_mw || 0;
      var r = Math.max(1.7, Math.sqrt(mw) * 0.30);
      var c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", px(a).toFixed(1));
      c.setAttribute("cy", py(a).toFixed(1));
      c.setAttribute("r", r.toFixed(1));
      c.setAttribute("fill", ZONENFARBE[a.regelzone] || "var(--schrift-still)");
      c.setAttribute("fill-opacity", "0.62");
      c.setAttribute("stroke", ZONENFARBE[a.regelzone] || "var(--schrift-still)");
      c.setAttribute("stroke-width", "0.7");
      var t = document.createElementNS("http://www.w3.org/2000/svg", "title");
      t.textContent = (a.ort || "") + " · " + (a.energietraeger || "") + " · "
        + nf0.format(mw) + " MW · " + a.regelzone;
      c.appendChild(t);
      svg.appendChild(c);
    });
    return svg;
  }

  // ---- Aufbau -------------------------------------------------------------

  function aufbauen(bilanz, kraftwerke) {
    var wurzel = el("div", { "class": "pf-huelle" });

    // Kopf
    var kopf = el("header", { "class": "pf-kopf" });
    var kopfzeile = el("div", { "class": "pf-kopfzeile" });
    var links = el("div");
    links.appendChild(el("h1", { text: "Deutschland · Stromfluss-Labor" }));
    links.appendChild(el("p", {
      "class": "pf-unterzeile",
      text: "Tagesbilanz des deutschen Stromsystems am " + datumLang(bilanz.tag)
        + ". Alle Zahlen sind gemessene Tageswerte."
    }));
    links.appendChild(el("p", { "class": "pf-bahn", text: "Zufluss · Netz · Abfluss" }));
    kopfzeile.appendChild(links);

    var themaKnopf = el("button", {
      "class": "pf-thema-knopf", type: "button",
      "aria-label": "Zwischen hellem und dunklem Schema wechseln",
      text: "Hell / Dunkel"
    });
    themaKnopf.addEventListener("click", function () {
      var jetzt = document.documentElement.getAttribute("data-thema");
      var hellAktiv = jetzt === "hell"
        || (!jetzt && window.matchMedia("(prefers-color-scheme: light)").matches);
      document.documentElement.setAttribute("data-thema", hellAktiv ? "dunkel" : "hell");
    });
    kopfzeile.appendChild(themaKnopf);
    kopf.appendChild(kopfzeile);
    wurzel.appendChild(kopf);

    // --- Kennzahlen ---
    var quelleSmard = [{ text: "SMARD, Bundesnetzagentur", url: "https://www.smard.de/" }];
    var stunden = bilanz.netzlast_mwh / bilanz.mittlere_leistung_mw;
    var kacheln = el("div", { "class": "pf-kacheln" });

    kacheln.appendChild(kachel({
      titel: "Netzlast", wert: gwh(bilanz.netzlast_mwh, 1), einheit: "GWh",
      akzent: "violett",
      bezug: "mittlere Leistung " + nf1.format(bilanz.mittlere_leistung_mw / 1000) + " GW über "
        + nf0.format(stunden) + " Stunden",
      info: {
        wert: "SMARD-Filter 410 „Realisierter Stromverbrauch, Gesamt (Netzlast)“, Region DE, "
          + "Summe der Viertelstundenwerte des lokalen Kalendertags.",
        grenzenTitel: "Was die Zahl umfasst",
        grenzen: "Die Netzlast ist der Verbrauch im Netz der allgemeinen Versorgung. Der "
          + "Pumpspeicherverbrauch ist darin enthalten — nachgewiesen daran, dass die "
          + "Tagesbilanz nur so aufgeht. Nicht enthalten ist Strom, den Industriebetriebe "
          + "selbst erzeugen und selbst verbrauchen.",
        quellen: quelleSmard,
        messung: "Messung. Keine Annahme."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Erzeugung", wert: gwh(bilanz.erzeugung_mwh, 1), einheit: "GWh",
      akzent: "teal",
      bezug: nf1.format(bilanz.erzeugung_mwh / bilanz.netzlast_mwh * 100)
        + " % der Netzlast, aus 11 Energieträgern",
      info: {
        wert: "Summe der elf SMARD-Erzeugungsreihen für Region DE.",
        grenzenTitel: "Was fehlt",
        grenzen: "Kernenergie ist nicht enthalten: die Reihe (Filter 1224) endet am "
          + "15.04.2023 um 23:45 Uhr. Für spätere Zeiträume liefert SMARD HTTP 404, "
          + "nicht den Wert Null.",
        quellen: quelleSmard,
        messung: "Messung. Keine Annahme."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Import", wert: gwh(bilanz.import_mwh, 1), einheit: "GWh",
      akzent: "teal",
      bezug: "physikalischer Zufluss aus 11 Nachbarländern",
      info: {
        wert: "Summe der stündlichen SMARD-Importreihen je Nachbarland (physikalischer "
          + "Stromfluss). Die Reihen sind vorzeichenlos positiv.",
        grenzenTitel: "Auflösung und Beleg",
        grenzen: "Der Außenhandel liegt nur stündlich vor, nicht viertelstündlich. Die "
          + "Filter-IDs stehen in keiner Dokumentation; sie wurden empirisch bestimmt und "
          + "an zwei unabhängigen Wochen gegen Energy-Charts geprüft.",
        quellen: quelleSmard,
        messung: "Messung. Die Zuordnung der Filter-IDs zu den Ländern ist eine belegte "
          + "Herleitung, keine dokumentierte Zusage der Quelle."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Export", wert: gwh(bilanz.export_mwh, 1), einheit: "GWh",
      akzent: "orange",
      bezug: "physikalischer Abfluss in 11 Nachbarländer",
      info: {
        wert: "Summe der stündlichen SMARD-Exportreihen je Nachbarland.",
        grenzenTitel: "Auflösung und Beleg",
        grenzen: "Wie beim Import: stündlich, Filter-IDs empirisch belegt.",
        quellen: quelleSmard,
        messung: "Messung. Zuordnung der IDs belegt hergeleitet."
      }
    }));

    var saldoAkzent = bilanz.aussensaldo_mwh >= 0 ? "teal" : "orange";
    kacheln.appendChild(kachel({
      titel: "Außensaldo", wert: (bilanz.aussensaldo_mwh >= 0 ? "+" : "−")
        + gwh(Math.abs(bilanz.aussensaldo_mwh), 1), einheit: "GWh",
      akzent: saldoAkzent,
      bezug: (bilanz.aussensaldo_mwh >= 0 ? "Netto-Zufluss" : "Netto-Abfluss") + ", "
        + nf1.format(Math.abs(bilanz.aussensaldo_mwh) / bilanz.netzlast_mwh * 100)
        + " % der Netzlast",
      info: {
        wert: "Import minus Export über alle Nachbarländer.",
        grenzenTitel: "Was der Saldo nicht sagt",
        grenzen: "Der Saldo sagt nichts darüber, welchen Weg der Strom im deutschen Netz "
          + "genommen hat. Flüsse zwischen den vier Regelzonen werden nicht veröffentlicht.",
        quellen: quelleSmard,
        messung: "Messung."
      }
    }));

    kacheln.appendChild(kachel({
      titel: "Bilanzrest", wert: (bilanz.bilanzrest_mwh >= 0 ? "+" : "−")
        + gwh(Math.abs(bilanz.bilanzrest_mwh), 2), einheit: "GWh",
      bezug: nf2.format(bilanz.bilanzrest_prozent) + " % der Netzlast",
      marke: "Selbstkontrolle — muss klein bleiben",
      info: {
        wert: "Erzeugung + Import − Export − Netzlast. Rechnet die anderen Kacheln gegen.",
        grenzenTitel: "Was hier hineinläuft",
        grenzen: "Netzverluste, unterschiedliche zeitliche Auflösung von Erzeugung "
          + "(viertelstündlich) und Außenhandel (stündlich), sowie Rundung. Läuft dieser "
          + "Wert auseinander, ist ein Fehler in den anderen Kacheln sichtbar.",
        quellen: quelleSmard,
        messung: "Selbst gerechnet aus vier gemessenen Größen. Die Formel steht oben."
      }
    }));
    wurzel.appendChild(abschnitt("Kennzahlen des Tages", kacheln));

    // --- Regler-Platzhalter ---
    var platz = el("div", { "class": "pf-regler-platz" });
    platz.appendChild(el("p", {
      html: "<strong>Hier kommt der einzige Regler hin.</strong> Die freie Variable ist "
        + "noch nicht entschieden — Referenzjahr oder Kalendertag. Bis dahin gibt es "
        + "bewusst kein Bedienelement: alles auf dieser Seite ist gemessen."
    }));
    wurzel.appendChild(abschnitt("Freie Variable", platz));

    // --- Flussbild ---
    var fluss = el("div", { "class": "pf-fluss" });

    var zuflussEintraege = bilanz.erzeugung.map(function (e) {
      return { name: e.traeger, mwh: e.mwh };
    });
    var maxZu = Math.max.apply(null, zuflussEintraege.map(function (e) { return e.mwh; }));
    fluss.appendChild(saeule("zufluss", "Zufluss · Erzeugung",
      gwh(bilanz.erzeugung_mwh, 1) + " GWh",
      balkenliste(zuflussEintraege, "var(--teal)", maxZu)));

    var netzInhalt = el("div");
    var zonen = bilanz.regelzonen.slice().sort(function (a, b) { return b.saldo_mwh - a.saldo_mwh; });
    var maxAbs = Math.max.apply(null, zonen.map(function (z) { return Math.abs(z.saldo_mwh); }));
    zonen.forEach(function (z) {
      var zeile = el("div", { "class": "pf-zeile" });
      zeile.appendChild(el("span", { "class": "pf-name", text: z.zone }));
      zeile.appendChild(el("span", {
        "class": "pf-zahl",
        text: (z.saldo_mwh >= 0 ? "+" : "−") + gwh(Math.abs(z.saldo_mwh), 1)
      }));
      var schiene = el("div", { "class": "pf-schiene" });
      schiene.appendChild(el("div", {
        "class": "pf-fuellung",
        style: "width:" + (Math.abs(z.saldo_mwh) / maxAbs * 100).toFixed(1) + "%;background:"
          + (z.saldo_mwh >= 0 ? "var(--teal)" : "var(--orange)") + ";"
      }));
      var h = el("div", { "class": "pf-balken" });
      h.appendChild(zeile); h.appendChild(schiene);
      netzInhalt.appendChild(h);
    });
    netzInhalt.appendChild(el("p", {
      "class": "pf-bezug",
      text: "Saldo = Erzeugung minus Netzlast je Regelzone, in GWh. Der Austausch mit "
        + "allen Nachbarn zusammen — anderen Regelzonen und Ausland. Kein Fluss von "
        + "einer Zone in eine andere."
    }));
    fluss.appendChild(saeule("netz", "Netz · Regelzonen",
      gwh(bilanz.netzlast_mwh, 1) + " GWh Netzlast", netzInhalt));

    var abflussEintraege = bilanz.aussenhandel
      .filter(function (a) { return a.export_mwh > 0; })
      .map(function (a) { return { name: a.land, mwh: a.export_mwh }; })
      .sort(function (a, b) { return b.mwh - a.mwh; });
    var maxAb = Math.max.apply(null, abflussEintraege.map(function (e) { return e.mwh; }));
    fluss.appendChild(saeule("abfluss", "Abfluss · Export",
      gwh(bilanz.export_mwh, 1) + " GWh",
      balkenliste(abflussEintraege, "var(--orange)", maxAb)));

    wurzel.appendChild(abschnitt("Zufluss · Netz · Abfluss (GWh am Tag)", fluss));

    // --- Karte ---
    var karteHuelle = el("div", { "class": "pf-karte-huelle" });
    var rollbereich = el("div", { "class": "pf-karte-rollbereich" });
    rollbereich.appendChild(karte(kraftwerke.anlagen));
    karteHuelle.appendChild(rollbereich);
    var legende = el("div", { "class": "pf-legende" });
    Object.keys(ZONENFARBE).forEach(function (z) {
      var s = el("span");
      s.appendChild(el("i", { style: "background:" + ZONENFARBE[z] + ";" }));
      s.appendChild(document.createTextNode(z));
      legende.appendChild(s);
    });
    legende.appendChild(el("span", { text: "Punktfläche ∝ Nettoleistung" }));
    karteHuelle.appendChild(legende);
    infoKnopf(karteHuelle, {
      wert: kraftwerke.anzahl + " Anlagen aus den SMARD-Kraftwerksstammdaten, jede an ihrer "
        + "tatsächlichen Koordinate. Farbe nach Regelzone, Fläche nach Nettoleistung.",
      grenzenTitel: "Was noch fehlt",
      grenzen: "Es gibt noch keine Grundkarte: eine Umrissgeometrie muss erst mit geklärter "
        + "Lizenz belegt werden. Leitungen und Umspannwerke fehlen ebenfalls noch. Die "
        + "Stammdaten enthalten überwiegend konventionelle Anlagen und Speicher — Wind- und "
        + "Solarparks sind darin nicht einzeln geführt.",
      quellen: quelleSmard,
      messung: "Stammdaten, keine Messung. Die tatsächliche Erzeugung liegt nur für 211 "
        + "Blöcke vor und ist hier noch nicht dargestellt."
    }, "Karte der Kraftwerksstandorte");
    wurzel.appendChild(abschnitt(
      "Karte · " + kraftwerke.anzahl + " Kraftwerksstandorte", karteHuelle));

    // --- Tabelle Aussenhandel ---
    var tabRoll = el("div", { "class": "pf-tabellen-rollbereich" });
    var tab = el("table", { "class": "pf-tabelle" });
    var thead = el("thead");
    var kopfz = el("tr");
    ["Nachbarland", "Import GWh", "Export GWh", "Saldo GWh"].forEach(function (t) {
      kopfz.appendChild(el("th", { text: t, scope: "col" }));
    });
    thead.appendChild(kopfz); tab.appendChild(thead);
    var tbody = el("tbody");
    bilanz.aussenhandel.forEach(function (a) {
      var tr = el("tr");
      tr.appendChild(el("td", { text: a.land }));
      tr.appendChild(el("td", { text: gwh(a.import_mwh, 2) }));
      tr.appendChild(el("td", { text: gwh(a.export_mwh, 2) }));
      tr.appendChild(el("td", {
        "class": a.saldo_mwh >= 0 ? "pf-plus" : "pf-minus",
        text: (a.saldo_mwh >= 0 ? "+" : "−") + gwh(Math.abs(a.saldo_mwh), 2)
      }));
      tbody.appendChild(tr);
    });
    var summe = el("tr");
    summe.appendChild(el("td", { text: "Summe" }));
    summe.appendChild(el("td", { text: gwh(bilanz.import_mwh, 2) }));
    summe.appendChild(el("td", { text: gwh(bilanz.export_mwh, 2) }));
    summe.appendChild(el("td", {
      "class": bilanz.aussensaldo_mwh >= 0 ? "pf-plus" : "pf-minus",
      text: (bilanz.aussensaldo_mwh >= 0 ? "+" : "−") + gwh(Math.abs(bilanz.aussensaldo_mwh), 2)
    }));
    tbody.appendChild(summe);
    tab.appendChild(tbody); tabRoll.appendChild(tab);
    wurzel.appendChild(abschnitt(
      "Physikalischer Stromfluss je Kuppelstelle (positiv = Zufluss nach Deutschland)", tabRoll));

    // --- Was diese Seite nicht zeigt ---
    var nicht = el("div", { "class": "pf-kasten" });
    nicht.appendChild(el("h3", { text: "Was diese Seite nicht zeigt" }));
    var ul = el("ul");
    [
      "Flüsse zwischen den vier Regelzonen. Deutschland und Luxemburg bilden EINE "
        + "Gebotszone; die EU-Verordnung 543/2013 verlangt die Veröffentlichung "
        + "physikalischer Flüsse nur zwischen Gebotszonen. Der Zonensaldo ist kein Ersatz.",
      "Flüsse auf einzelnen Hoch- und Höchstspannungsleitungen. Nach § 23c Abs. 2 EnWG "
        + "werden grenzüberschreitende Lastflüsse nur zusammengefasst je Kuppelstelle "
        + "veröffentlicht. Öffentliche Leitungsauslastungen sind Modellrechnungen.",
      "Leitungen und Umspannwerke. Ihre Geografie ist noch nicht belegt und noch nicht "
        + "mit geklärter Lizenz eingebunden.",
      "Redispatch. Noch nicht eingebunden — braucht einen Zugang zur netztransparenz-API."
    ].forEach(function (t) { ul.appendChild(el("li", { text: t })); });
    nicht.appendChild(ul);
    wurzel.appendChild(abschnitt("Grenzen", nicht));

    // --- Offene Punkte ---
    var offen = el("div", { "class": "pf-kasten", "data-art": "offen" });
    offen.appendChild(el("h3", { text: "Offene Punkte" }));
    var ul2 = el("ul");
    [
      "Die freie Variable ist nicht entschieden: Referenzjahr oder Kalendertag. Genau eine "
        + "davon darf es werden.",
      "Grundkarte mit Umriss und Bundesländern — Quelle und Lizenz noch zu klären.",
      "Leitungen und Umspannwerke — Quelle noch zu belegen.",
      "Methodik-PDF und der Gesamtlauf über alle Referenzjahre fehlen noch.",
      "Der Kraftwerks-Endpunkt von SMARD ist undokumentiert und kann sich ohne Ankündigung "
        + "ändern."
    ].forEach(function (t) { ul2.appendChild(el("li", { text: t })); });
    offen.appendChild(ul2);
    wurzel.appendChild(abschnitt("Was noch fehlt", offen));

    // --- Downloads ---
    var abzuege = el("div", { "class": "pf-abzuege" });
    [
      { d: "data/erzeugung-" + bilanz.tag + ".csv", t: "Erzeugung nach Energieträger", e: "CSV" },
      { d: "data/regelzonen-" + bilanz.tag + ".csv", t: "Regelzonen", e: "CSV" },
      { d: "data/aussenhandel-" + bilanz.tag + ".csv", t: "Außenhandel je Land", e: "CSV" },
      { d: "data/tagesbilanz.json", t: "Tagesbilanz", e: "JSON" },
      { d: "data/kraftwerke.json", t: "Kraftwerksstandorte", e: "JSON" }
    ].forEach(function (a) {
      var link = el("a", { "class": "pf-abzug", href: a.d, download: "", text: a.t });
      link.appendChild(el("span", { text: a.e }));
      abzuege.appendChild(link);
    });
    wurzel.appendChild(abschnitt("Downloads", abzuege));

    // --- Fussnote ---
    var fuss = el("footer", { "class": "pf-fussnote" });
    fuss.appendChild(el("p", {
      html: 'Datenquelle: <a href="https://www.smard.de/" target="_blank" rel="noopener">'
        + 'Bundesnetzagentur | SMARD.de</a>, Lizenz '
        + '<a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" '
        + 'rel="noopener">CC BY 4.0</a>. Gegengeprüft gegen Energy-Charts (Fraunhofer ISE) '
        + '— das ist eine Konsistenzprüfung, keine unabhängige Gegenprobe: beide Quellen '
        + 'gehen auf dieselbe ENTSO-E-Erhebung zurück.'
    }));
    fuss.appendChild(el("p", {
      text: "Daten abgerufen am " + bilanz.abgerufen.slice(0, 16).replace("T", " um ")
        + " Uhr. Anzeige deutsch formatiert; die CSV-Dateien benutzen den Punkt als "
        + "Dezimaltrennzeichen und erklären das in ihrem Kopf."
    }));
    fuss.appendChild(el("p", {
      text: "Rumpf-Fassung " + VERSION + ". Belege unter docs/ im Repository."
    }));
    wurzel.appendChild(fuss);

    return wurzel;
  }

  // ---- Start --------------------------------------------------------------

  function start() {
    var anker = document.getElementById(ANKER);
    if (!anker) { return; }
    var laden = el("div", { "class": "pf-huelle" }, [
      el("p", { "class": "pf-laden", text: "Daten werden geladen …" })
    ]);
    anker.parentNode.insertBefore(laden, anker);

    Promise.all([
      fetch("data/tagesbilanz.json?v=" + VERSION).then(function (r) {
        if (!r.ok) { throw new Error("data/tagesbilanz.json: HTTP " + r.status); }
        return r.json();
      }),
      fetch("data/kraftwerke.json?v=" + VERSION).then(function (r) {
        if (!r.ok) { throw new Error("data/kraftwerke.json: HTTP " + r.status); }
        return r.json();
      })
    ]).then(function (teile) {
      var neu = aufbauen(teile[0], teile[1]);
      laden.parentNode.replaceChild(neu, laden);
    }).catch(function (fehler) {
      laden.textContent = "";
      laden.appendChild(el("div", {
        "class": "pf-fehler",
        text: "Die Daten konnten nicht geladen werden: " + fehler.message
          + " — Beim lokalen Öffnen über file:// blockiert der Browser fetch. "
          + "Die Seite über einen Server aufrufen, etwa mit: python -m http.server"
      }));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
