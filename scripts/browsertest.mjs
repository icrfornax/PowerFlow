/* Browsertest nach dem Skill `pruefpflichten`.
 *
 * Aufruf:  node scripts/browsertest.mjs [http://127.0.0.1:8080]
 *
 * Steuert einen eigenen Chrome ueber das DevTools-Protokoll. KEINE zusaetzliche
 * Abhaengigkeit: Chrome kann das von Haus aus, und Node bringt seit Version 22
 * einen WebSocket-Client mit. Playwright oder Puppeteer braucht es nicht.
 *
 * Der Chrome laeuft mit einem eigenen, wegwerfbaren Profil in einem temporaeren
 * Verzeichnis. Eine laufende Browsersitzung des Benutzers wird nicht angefasst.
 *
 * Geprueft wird die Pflichtliste:
 *   - dunkles Schema, helles Schema, Mobil bei 390 px
 *   - kein waagerechter Ueberlauf
 *   - keine Konsolenfehler und keine unbehandelten Ausnahmen
 *   - jeder Info-Knopf oeffnet sein Popover und schliesst wieder
 *   - jedes Bedienelement laesst sich anfassen: Zeitraum, Schnellwahl,
 *     Zuruecksetzen, Karte zoomen und auswaehlen, Ebenen, Tabellenschalter
 *   - der CSV-Abzug wird ausgeloest
 *
 * Rueckgabe: Exit-Code 1, sobald eine Pruefung fehlschlaegt. Bildschirmfotos
 * landen in .browsertest/ und werden nicht eingecheckt.
 */

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASIS = process.argv[2] || "http://127.0.0.1:8080";
const PORT = 9333;
const AUSGABE = path.resolve("./.browsertest");

const CHROME_PFADE = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const befunde = [];
function pruefe(bedingung, text, zusatz = "") {
  befunde.push({ ok: !!bedingung, text, zusatz });
  const marke = bedingung ? "ok   " : "FEHLT";
  console.log(`  [${marke}] ${text}${zusatz && !bedingung ? "  -> " + zusatz : ""}`);
}

function schlafen(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---- CCP-Verbindung ---------------------------------------------------- */

class Chrome {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.offen = new Map();
    this.horcher = [];
    ws.addEventListener("message", (e) => {
      const n = JSON.parse(e.data);
      if (n.id && this.offen.has(n.id)) {
        const { auf, ab } = this.offen.get(n.id);
        this.offen.delete(n.id);
        n.error ? ab(new Error(n.error.message)) : auf(n.result);
      } else if (n.method) {
        this.horcher.forEach((h) => h(n));
      }
    });
  }
  senden(method, params = {}, sessionId) {
    const id = ++this.id;
    const nachricht = { id, method, params };
    if (sessionId) { nachricht.sessionId = sessionId; }
    this.ws.send(JSON.stringify(nachricht));
    return new Promise((auf, ab) => {
      this.offen.set(id, { auf, ab });
      setTimeout(() => {
        if (this.offen.has(id)) { this.offen.delete(id); ab(new Error(method + ": Zeitablauf")); }
      }, 30000);
    });
  }
  horchen(fn) { this.horcher.push(fn); }
}

async function holeJson(url, versuche = 40) {
  for (let i = 0; i < versuche; i++) {
    try {
      const a = await fetch(url);
      if (a.ok) { return await a.json(); }
    } catch { /* Chrome ist noch nicht so weit */ }
    await schlafen(250);
  }
  throw new Error("Chrome antwortet nicht auf " + url);
}

/* ---- Ablauf ------------------------------------------------------------ */

const chromePfad = CHROME_PFADE.find((p) => p && existsSync(p));
if (!chromePfad) {
  console.error("Kein Chrome gefunden. Gesucht in:\n  " + CHROME_PFADE.join("\n  "));
  process.exit(2);
}

await mkdir(AUSGABE, { recursive: true });
const profil = await mkdtemp(path.join(tmpdir(), "pf-chrome-"));
const chrome = spawn(chromePfad, [
  "--headless=new",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + profil,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--hide-scrollbars",
  "--window-size=1280,900",
  "about:blank",
], { stdio: "ignore" });

let code = 0;
try {
  const version = await holeJson(`http://127.0.0.1:${PORT}/json/version`);
  console.log("Browser:", version.Browser);
  console.log("Seite  :", BASIS);
  console.log();

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((auf, ab) => {
    ws.addEventListener("open", auf, { once: true });
    ws.addEventListener("error", () => ab(new Error("WebSocket ging nicht auf")), { once: true });
  });
  const c = new Chrome(ws);

  const { targetId } = await c.senden("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await c.senden("Target.attachToTarget", { targetId, flatten: true });

  const fehlermeldungen = [];
  c.horchen((n) => {
    if (n.sessionId !== sessionId) { return; }
    if (n.method === "Runtime.consoleAPICalled" && n.params.type === "error") {
      fehlermeldungen.push("console.error: " + n.params.args
        .map((a) => a.value ?? a.description ?? a.type).join(" "));
    }
    if (n.method === "Runtime.exceptionThrown") {
      const d = n.params.exceptionDetails;
      fehlermeldungen.push("Ausnahme: " + (d.exception?.description || d.text));
    }
    if (n.method === "Log.entryAdded" && n.params.entry.level === "error") {
      fehlermeldungen.push("Log: " + n.params.entry.text
        + (n.params.entry.url ? " (" + n.params.entry.url + ")" : ""));
    }
  });

  await c.senden("Runtime.enable", {}, sessionId);
  await c.senden("Log.enable", {}, sessionId);
  await c.senden("Page.enable", {}, sessionId);

  const js = async (ausdruck) => {
    const r = await c.senden("Runtime.evaluate", {
      expression: ausdruck, returnByValue: true, awaitPromise: true,
    }, sessionId);
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  };

  const masse = async (breite, hoehe, mobil = false) => {
    await c.senden("Emulation.setDeviceMetricsOverride", {
      width: breite, height: hoehe, deviceScaleFactor: 1, mobile: mobil,
    }, sessionId);
  };

  const foto = async (name, auswahl) => {
    // Ein Bildschirmfoto zeigt nur den sichtbaren Ausschnitt. Wer ein Bauteil
    // weiter unten sehen will, muss vorher hinscrollen -- sonst prueft man
    // immer nur den Seitenkopf.
    if (auswahl) {
      await js(`document.querySelector(${JSON.stringify(auswahl)})`
        + `.scrollIntoView({ block: "center", behavior: "instant" })`);
      await schlafen(400);
    }
    const { data } = await c.senden("Page.captureScreenshot", { format: "png" }, sessionId);
    await writeFile(path.join(AUSGABE, name + ".png"), Buffer.from(data, "base64"));
  };

  const wartenAuf = async (auswahl, ms = 30000) => {
    const ende = Date.now() + ms;
    while (Date.now() < ende) {
      if (await js(`!!document.querySelector(${JSON.stringify(auswahl)})`)) { return true; }
      await schlafen(200);
    }
    return false;
  };

  // --- Laden ---
  await masse(1280, 900);
  await c.senden("Page.navigate", { url: BASIS }, sessionId);
  const geladen = await wartenAuf(".pf-kacheln");
  pruefe(geladen, "Seite laedt und baut ihre Kennzahlen auf");
  if (!geladen) { throw new Error("Seite ist nicht fertig geworden."); }
  await schlafen(1500);

  // --- Aufbau ---
  const bausteine = await js(`(function () {
    const q = (s) => document.querySelectorAll(s).length;
    return {
      kacheln: q(".pf-kachel"), infos: q(".pf-info"), datumsfelder: q(".pf-tagfeld"),
      schnell: q(".pf-schnell"), diagramm: q(".pf-diagramm"), karte: q(".pf-karte"),
      ebenen: q(".pf-ebene input"), tabellenschalter: q(".pf-tabellenschalter"),
      abzuege: q(".pf-abzug"), zuruecksetzen: q(".pf-zuruecksetzen"),
      titel: document.title
    };
  })()`);
  pruefe(bausteine.kacheln >= 6, `${bausteine.kacheln} Kennzahlen-Kacheln`);

  /* Der Anteil der Erneuerbaren. Geprueft wird nicht nur, DASS die Kachel da
     ist, sondern dass sie mit der Legende des Verlaufs zusammenpasst -- beide
     rechnen dieselben Reihen, nur gegen verschiedene Nenner. */
  const ee = await js(`(function () {
    const k = [...document.querySelectorAll(".pf-kachel")].find(
      (x) => x.querySelector(".pf-titel").textContent === "Erneuerbare");
    if (!k) { return null; }
    const roh = k.querySelector(".pf-wert").firstChild.textContent;
    return { wert: parseFloat(roh.replace(",", ".")),
             einheit: k.querySelector(".pf-einheit").textContent,
             bezug: k.querySelector(".pf-bezug").textContent };
  })()`);
  pruefe(ee !== null, "Kachel 'Erneuerbare' vorhanden");
  pruefe(ee && ee.wert > 0 && ee.wert < 200,
    `Anteil Erneuerbare ${ee && ee.wert} ${ee && ee.einheit} liegt im moeglichen Bereich`,
    JSON.stringify(ee));
  pruefe(ee && /Prozentpunkte|kein Vergleichswert/.test(ee.bezug),
    "Vergleich in Prozentpunkten, nicht in Prozent vom Prozent", ee && ee.bezug);

  pruefe(bausteine.infos >= 7, `${bausteine.infos} Info-Knoepfe`);
  pruefe(bausteine.datumsfelder === 2, `${bausteine.datumsfelder} Datumsfelder (genau zwei)`);
  pruefe(bausteine.schnell >= 6, `${bausteine.schnell} Schnellwahl-Knoepfe`);
  pruefe(bausteine.diagramm === 1, "Zeitreihen-Diagramm vorhanden");
  pruefe(bausteine.karte === 1, "Karte vorhanden");
  pruefe(bausteine.ebenen >= 4, `${bausteine.ebenen} Ebenenschalter`);

  // Die Voreinstellung ist eine Woche und muss stuendlich laufen.
  const vorgabe = await js(`(function () {
    const v = document.getElementById("pf-von").value, b = document.getElementById("pf-bis").value;
    const kopf = [...document.querySelectorAll(".pf-abschnitt > h2")]
      .map((h) => h.textContent).find((x) => /Verlauf/.test(x)) || "";
    const punkte = document.querySelectorAll(".pf-flaechen path").length;
    const trenner = document.querySelectorAll(".pf-tagestrenner").length;
    return { von: v, bis: b, kopf, punkte, trenner };
  })()`);
  pruefe(/Stundenwerte/.test(vorgabe.kopf),
    `Voreinstellung ${vorgabe.von}..${vorgabe.bis} laeuft stuendlich`, vorgabe.kopf);
  pruefe(vorgabe.trenner >= 5,
    `${vorgabe.trenner} Tagestrenner im Wochenverlauf`);
  await foto("verlauf-woche", ".pf-verlauf");

  /* Zufluss/Abfluss und die Regelzonen. Nachgerechnet wird die Bilanz aus den
     ANGEZEIGTEN Zahlen -- wenn die Saeulen und die Gleichung auseinanderlaufen,
     faellt es hier auf und nicht erst dem Leser. */
  const fluss = await js(`(function () {
    /* ACHTUNG, zweimal hineingelaufen: dieser Ausdruck steht in einem
       Template-Literal. Dort faellt \. zu . zusammen, der regulaere Ausdruck
       loescht dann JEDES Zeichen und parseFloat liefert NaN. Deshalb hier
       split/join statt eines regulaeren Ausdrucks -- ohne Backslash gibt es
       nichts zu verschlucken. */
    const zahl = (s) => parseFloat(
      s.split(".").join("").replace(",", ".").replace("−", "-"));
    const titel = [...document.querySelectorAll(".pf-saeule > h3")].map((x) => x.textContent);
    const gruppen = [...document.querySelectorAll(".pf-saeule .pf-gruppentitel")]
      .map((x) => x.textContent);
    // Beschriftung und Zahl je Zeile, in Reihenfolge -- ein Vergleich auf
    // Zeichenketten mit Minuszeichen und Pluszeichen ist zu heikel.
    const r = [...document.querySelectorAll(".pf-rechnung-zeile")].map((z) => ({
      label: z.firstChild.textContent, wert: zahl(z.lastChild.textContent)
    }));
    return { titel: titel, gruppen: gruppen, rechnung: r,
             zonen: document.querySelectorAll(".pf-zone").length,
             stapel: document.querySelectorAll(".pf-zone-stapel span").length,
             fuss: [...document.querySelectorAll(".pf-zone-fuss")].map((x) => x.textContent) };
  })()`);
  pruefe(fluss.titel.some((x) => /Import/.test(x)),
    "die Zuflusssaeule nennt den Import", fluss.titel.join(" | "));
  pruefe(fluss.gruppen.some((x) => /Import je Nachbarland/.test(x)),
    "Import je Nachbarland ist eigene Gruppe", fluss.gruppen.join(" | "));
  pruefe(fluss.zonen === 4, `vier Regelzonen mit Traegerstapel (${fluss.zonen})`);
  pruefe(fluss.stapel >= 4 * 4,
    `${fluss.stapel} Traegerabschnitte in den vier Stapeln`);
  pruefe(fluss.fuss.every((x) => /Netzlast/.test(x) && /Saldo/.test(x) && /Erneuerbare/.test(x)),
    "jede Zone nennt Netzlast, Saldo und Erneuerbare", fluss.fuss[0]);

  const rechnung = fluss.rechnung;
  // Reihenfolge: Erzeugung, + Import, - Export, - Netzlast, = Bilanzrest.
  const vz = [1, 1, -1, -1];
  const soll = rechnung.slice(0, 4).reduce((a, z, i) => a + vz[i] * z.wert, 0);
  const ist = rechnung[4] ? rechnung[4].wert : null;
  // Die Summanden sind auf eine Nachkommastelle gerundet; vier davon ergeben
  // hoechstens 0,2 GWh Rundungsspiel.
  pruefe(rechnung.length === 5 && ist !== null && Math.abs(soll - ist) <= 0.25,
    `die angezeigte Bilanz geht auf: ${soll.toFixed(1)} gegen `
      + `${ist === null ? "?" : ist.toFixed(1)} GWh`,
    JSON.stringify(rechnung));

  const rd = await js(`(function () {
    const k = [...document.querySelectorAll(".pf-kachel .pf-titel")]
      .map((x) => x.textContent);
    const abschnitte = [...document.querySelectorAll(".pf-abschnitt > h2")]
      .map((x) => x.textContent);
    return {
      kachel: k.includes("Redispatch"),
      abschnitt: abschnitte.some((x) => /Redispatch/.test(x)),
      zahlen: document.querySelectorAll(".pf-rd-zahl").length,
      gruppen: document.querySelectorAll(".pf-rd-gruppe").length,
      uenb: [...document.querySelectorAll(".pf-rd-gruppe .pf-name")].map((x) => x.textContent)
    };
  })()`);
  pruefe(rd.kachel, "Redispatch-Kachel vorhanden");
  pruefe(rd.abschnitt, "Redispatch-Abschnitt vorhanden");
  pruefe(rd.zahlen === 3, `drei Redispatch-Kennzahlen (${rd.zahlen})`);
  pruefe(rd.gruppen === 2, `zwei Balkengruppen (${rd.gruppen})`);
  pruefe(rd.uenb.filter((x) => /50Hertz|Amprion|TenneT|TransnetBW/.test(x)).length === 4,
    `alle vier UeNB im Redispatch (${rd.uenb.join(", ")})`);
  await foto("redispatch", ".pf-rd-kopf");

  // --- Waagerechter Ueberlauf, drei Breiten ---
  for (const [name, breite, hoehe, mobil] of [
    ["gross", 1280, 900, false], ["schmal", 768, 900, false], ["mobil", 390, 844, true],
  ]) {
    await masse(breite, hoehe, mobil);
    await schlafen(700);
    const u = await js(`(function () {
      const d = document.documentElement;
      const schuld = [...document.querySelectorAll("body *")]
        .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 3).map((e) => e.className || e.tagName);
      return { scroll: d.scrollWidth, sicht: window.innerWidth, schuld };
    })()`);
    pruefe(u.scroll <= u.sicht + 1,
      `kein waagerechter Ueberlauf bei ${breite} px`,
      `scrollWidth ${u.scroll} > ${u.sicht}, u.a. ${JSON.stringify(u.schuld)}`);
    await foto("breite-" + name);
    await foto("breite-" + name + "-karte", ".pf-karte-huelle");
  }
  await masse(1280, 900);
  await schlafen(400);

  // --- Beide Farbschemata ---
  for (const thema of ["dunkel", "hell"]) {
    await js(`document.documentElement.setAttribute("data-thema", ${JSON.stringify(thema)})`);
    await schlafen(400);
    const f = await js(`(function () {
      const s = getComputedStyle(document.body);
      const k = getComputedStyle(document.querySelector(".pf-karte-huelle"));
      return { grund: s.backgroundColor, schrift: s.color, karte: k.backgroundColor };
    })()`);
    pruefe(f.grund !== f.schrift && f.grund !== "rgba(0, 0, 0, 0)",
      `Schema ${thema}: Grund ${f.grund}, Schrift ${f.schrift}, Karte ${f.karte}`);
    await foto("thema-" + thema);
  }
  await js(`document.documentElement.setAttribute("data-thema", "dunkel")`);

  // --- Info-Popover ---
  const popover = await js(`(async function () {
    const knoepfe = [...document.querySelectorAll(".pf-info")];
    let auf = 0, zu = 0, ohneMessung = [];
    for (const k of knoepfe) {
      k.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      const p = document.querySelector(".pf-popover");
      if (p) {
        auf++;
        if (!p.querySelector(".pf-messung")) { ohneMessung.push(k.getAttribute("aria-label")); }
      }
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await new Promise((r) => setTimeout(r, 40));
      if (!document.querySelector(".pf-popover")) { zu++; }
    }
    return { gesamt: knoepfe.length, auf, zu, ohneMessung };
  })()`);
  pruefe(popover.auf === popover.gesamt,
    `alle ${popover.gesamt} Info-Popover oeffnen`, `nur ${popover.auf} gingen auf`);
  pruefe(popover.zu === popover.gesamt, "alle Popover schliessen mit Escape");
  pruefe(popover.ohneMessung.length === 0,
    "jedes Popover sagt, was Messung und was Annahme ist",
    JSON.stringify(popover.ohneMessung));

  // --- Zeitraum: Schnellwahl, Schritt, Zuruecksetzen ---
  const start = await js(`document.getElementById("pf-von").value + ".." + document.getElementById("pf-bis").value`);
  await js(`[...document.querySelectorAll(".pf-schnell")].find((b) => b.textContent === "Voriger Monat").click()`);
  await schlafen(2500);
  const monat = await js(`document.getElementById("pf-von").value + ".." + document.getElementById("pf-bis").value`);
  pruefe(monat !== start, `Schnellwahl "Voriger Monat" wirkt: ${start} -> ${monat}`);
  const tagesansicht = await js(`document.querySelector(".pf-abschnitt h2").textContent`);
  await foto("zeitraum-monat", ".pf-verlauf");

  await js(`[...document.querySelectorAll(".pf-schnell")].find((b) => b.textContent === "Letzter Tag").click()`);
  await schlafen(2500);
  const einTag = await js(`(function () {
    const v = document.getElementById("pf-von").value, b = document.getElementById("pf-bis").value;
    const marken = [...document.querySelectorAll(".pf-gitter text")].map((t) => t.textContent);
    return { gleich: v === b, hatUhrzeit: marken.some((m) => /^\\d\\d$/.test(m)) };
  })()`);
  pruefe(einTag.gleich, "Schnellwahl 'Letzter Tag' setzt von = bis");
  pruefe(einTag.hatUhrzeit, "Einzeltag wird stuendlich gezeigt");
  const letzterTag = await js(`document.getElementById("pf-von").value`);
  await foto("zeitraum-tag", ".pf-verlauf");

  await js(`document.querySelector(".pf-schritt[aria-label='Einen Zeitraum zurück']").click()`);
  await schlafen(2500);
  const zurueck = await js(`document.getElementById("pf-von").value`);
  // Ein Tag zurueck heisst: das Datum wird kleiner. Der erste Anlauf verglich
  // hier ein Datum mit einem Wahrheitswert -- der Test war Unsinn, die Seite
  // in Ordnung.
  pruefe(zurueck < letzterTag, `Schritt zurueck wirkt: ${letzterTag} -> ${zurueck}`,
    `unveraendert bei ${zurueck}`);

  await js(`document.querySelector(".pf-regler .pf-zuruecksetzen").click()`);
  await schlafen(2500);
  const nachReset = await js(`document.getElementById("pf-von").value + ".." + document.getElementById("pf-bis").value`);
  pruefe(nachReset === start,
    `Zuruecksetzen stellt den Anfangszustand her (${nachReset})`, `erwartet ${start}`);

  // --- Diagramm: Ablesung und Tabelle ---
  const ablesung = await js(`(function () {
    const svg = document.querySelector(".pf-diagramm");
    const r = svg.getBoundingClientRect();
    svg.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, clientX: r.left + r.width * 0.4, clientY: r.top + r.height / 2 }));
    const g = document.querySelector(".pf-ablesung-svg");
    return { zeilen: g.querySelectorAll("text").length,
             kasten: g.querySelectorAll("rect.pf-ablesung-grund").length,
             text: (document.querySelector(".pf-ablesung-text") || {}).textContent || "" };
  })()`);
  pruefe(ablesung.zeilen >= 8 && ablesung.kasten === 1,
    `Ablesung steht IM Bild (${ablesung.zeilen} Textzeilen)`);
  pruefe(/Netzlast/.test(ablesung.text) && /deckung/.test(ablesung.text),
    "Ablesung nennt Netzlast und Ueber-/Unterdeckung", ablesung.text.slice(0, 80));

  /* Gedaempfte Flaechen, Oberkante statt Umrandung, Preisstreifen.
     Die frueheren Pruefungen verlangten hier eine Schraffur auf jeder Flaeche.
     Diese Gestaltung ist zurueckgenommen -- dauerhafte Textur ist selbst eine
     Stoerung. Geprueft wird jetzt das Gegenteil: KEIN Muster, gedaempfte
     Fuellung, und die Trennung ueber eine haarduenne Oberkante. */
  const feinheit = await js(`(function () {
    const flaechen = [...document.querySelectorAll(".pf-flaechen path")];
    const deck = (p) => parseFloat(getComputedStyle(p).fillOpacity);
    return {
      flaechen: flaechen.length,
      gemustert: flaechen.filter((p) => (p.getAttribute("fill") || "").indexOf("url(") === 0).length,
      gedaempft: flaechen.filter((p) => deck(p) > 0 && deck(p) <= 0.4).length,
      umrandet: flaechen.filter((p) => p.getAttribute("stroke")).length,
      musterdefs: document.querySelectorAll("pattern[id^=pf-muster-]").length,
      kanten: document.querySelectorAll(".pf-kanten path.pf-kante").length,
      preis: document.querySelectorAll(".pf-preis-pos, .pf-preis-neg").length,
      preiskante: document.querySelectorAll(".pf-preis-kante").length,
      deckung: document.querySelectorAll(".pf-deckung path").length
    };
  })()`);
  pruefe(feinheit.gemustert === 0, "keine Flaeche traegt mehr eine Musterfuellung",
    `${feinheit.gemustert} gemustert`);
  pruefe(feinheit.musterdefs === 0, "keine Musterdefinition mehr im Dokument",
    `${feinheit.musterdefs} uebrig`);
  pruefe(feinheit.gedaempft === feinheit.flaechen,
    `alle ${feinheit.flaechen} Flaechen sind gedaempft (fill-opacity <= 0,4)`,
    `${feinheit.gedaempft} von ${feinheit.flaechen}`);
  pruefe(feinheit.umrandet === 0, "keine Flaeche traegt mehr eine Umrandung",
    `${feinheit.umrandet} umrandet`);
  pruefe(feinheit.kanten === feinheit.flaechen,
    `jedes Band hat eine Oberkante (${feinheit.kanten})`);
  pruefe(feinheit.preis >= 1, "Preisstreifen vorhanden");
  pruefe(feinheit.preiskante === 1, "Preis als durchgezogene Treppe");
  pruefe(feinheit.deckung >= 1, "Ueber-/Unterdeckung ist getoent");

  // Netzlast in eigener Farbe -- nicht in der Textfarbe, nicht in Windblau.
  const lastfarbe = await js(`(function () {
    const w = getComputedStyle(document.documentElement);
    const l = getComputedStyle(document.querySelector(".pf-lastlinie")).stroke;
    return { linie: l, wind: w.getPropertyValue("--tr-wind").trim(),
             schrift: w.getPropertyValue("--schrift").trim(),
             token: w.getPropertyValue("--last-linie").trim() };
  })()`);
  pruefe(lastfarbe.token !== "" && lastfarbe.token !== lastfarbe.wind,
    `Netzlast hat eine eigene Farbe (${lastfarbe.token}), nicht die von Wind`,
    JSON.stringify(lastfarbe));

  /* Das Band unter dem Zeiger wird angehoben -- genau eines, nie mehrere.
     Gefahren wird mitten durch das Bild, dorthin wo sicher ein Band liegt. */
  const anheben = await js(`(function () {
    const svg = document.querySelector(".pf-diagramm");
    const r = svg.getBoundingClientRect();
    const schick = (x, y) => svg.dispatchEvent(new MouseEvent("mousemove",
      { clientX: x, clientY: y, bubbles: true }));
    schick(r.left + r.width * 0.5, r.top + r.height * 0.55);
    const hell = document.querySelectorAll(".pf-band.pf-band-hell").length;
    const aktiv = document.querySelectorAll(".pf-ablesung-aktiv").length;
    svg.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    const nachher = document.querySelectorAll(".pf-band.pf-band-hell").length;
    return { hell: hell, aktiv: aktiv, nachher: nachher };
  })()`);
  pruefe(anheben.hell === 1, "genau ein Band wird beim Ueberfahren angehoben",
    `${anheben.hell} angehoben`);
  pruefe(anheben.aktiv >= 1, "die Ablesung markiert denselben Traeger",
    `${anheben.aktiv} markiert`);
  pruefe(anheben.nachher === 0, "das Anheben endet, wenn der Zeiger das Bild verlaesst",
    `${anheben.nachher} bleiben hell`);

  // Preisachse: fester Rahmen -100 bis 400, aber nie ein Wert abgeschnitten.
  const preisachse = await js(`(function () {
    const t = [...document.querySelectorAll(".pf-verlauf .pf-gitter text")]
      .map((e) => e.textContent.replace("−", "-").split(".").join(""));
    const zahlen = t.map(Number).filter((x) => !isNaN(x));
    return { unten: Math.min(...zahlen), oben: Math.max(...zahlen), marken: t };
  })()`);
  pruefe(preisachse.unten <= -100 && preisachse.oben >= 400,
    `Preisachse deckt mindestens -100 bis 400 EUR/MWh ab`,
    JSON.stringify(preisachse.marken));

  await js(`document.querySelector(".pf-tabellenschalter").click()`);
  await schlafen(500);
  const tabelle = await js(`(function () {
    const t = document.querySelectorAll(".pf-verlauf table.pf-tabelle tbody tr").length;
    return { zeilen: t, beschriftung: document.querySelector(".pf-tabellenschalter").textContent };
  })()`);
  pruefe(tabelle.zeilen > 5, `Tabellenansicht zeigt ${tabelle.zeilen} Zeilen`);
  pruefe(/ausblenden/i.test(tabelle.beschriftung), "Tabellenschalter beschriftet sich um");

  // --- Karte: Zoom, Auswahl, Ebenen ---
  const vorZoom = await js(`document.querySelector(".pf-karte").getAttribute("viewBox")`);
  await js(`document.querySelector(".pf-kartenbedienung .pf-schritt[aria-label='Hineinzoomen']").click()`);
  await schlafen(400);
  const nachZoom = await js(`document.querySelector(".pf-karte").getAttribute("viewBox")`);
  pruefe(vorZoom !== nachZoom, `Karte zoomt (${vorZoom} -> ${nachZoom})`);
  await js(`document.querySelector(".pf-kartenbedienung .pf-zuruecksetzen").click()`);
  await schlafen(300);
  pruefe(await js(`document.querySelector(".pf-karte").getAttribute("viewBox")`) === vorZoom,
    "Ansicht zuruecksetzen stellt den Kartenausschnitt wieder her");

  const auswahl = await js(`(function () {
    const k = document.querySelector(".pf-geo-anlage circle[tabindex]");
    if (!k) { return "kein Kraftwerkspunkt gefunden"; }
    k.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return document.getElementById("pf-auswahl").textContent.trim().slice(0, 60);
  })()`);
  pruefe(!/Nichts ausgewählt|kein Kraftwerkspunkt/.test(auswahl),
    "Klick auf ein Kraftwerk fuellt den Auswahlkasten", auswahl);

  const pfeil = await js(`(function () {
    const p = document.querySelector(".pf-kuppel .pf-pfeil-ziel");
    if (!p) { return "kein Kuppelstellen-Pfeil"; }
    p.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return document.getElementById("pf-auswahl").textContent.trim().slice(0, 80);
  })()`);
  pruefe(/Kuppelstelle/.test(pfeil), "Klick auf eine Kuppelstelle zeigt Richtung und Menge", pfeil);
  await masse(1280, 1500);
  await schlafen(500);
  await foto("karte-auswahl", ".pf-karte");

  // Farbgebung und Hervorheben
  const farben = await js(`(function () {
    const punkte = [...document.querySelectorAll(".pf-geo-anlage circle")];
    const nachTraeger = {};
    punkte.forEach((p) => {
      const t = p.getAttribute("data-traeger");
      (nachTraeger[t] = nachTraeger[t] || new Set()).add(p.getAttribute("fill"));
    });
    const mehrdeutig = Object.entries(nachTraeger)
      .filter(([, s]) => s.size > 1).map(([t]) => t);
    const zonen = new Set(punkte.map((p) => p.getAttribute("data-zone")));
    return { traeger: Object.keys(nachTraeger), mehrdeutig, zonen: [...zonen],
             leitungszonen: document.querySelectorAll(".pf-netz-hoechst path[data-zone]").length };
  })()`);
  pruefe(farben.mehrdeutig.length === 0,
    `jeder Energietraeger hat genau EINE Farbe (${farben.traeger.join(", ")})`,
    `mehrdeutig: ${farben.mehrdeutig.join(", ")}`);
  pruefe(farben.leitungszonen >= 8,
    `${farben.leitungszonen} Leitungspfade nach Betreiber gefaerbt`);

  const hervor = await js(`(function () {
    const b = [...document.querySelectorAll(".pf-zonenknopf[data-zone]")]
      .find((x) => x.getAttribute("data-zone") === "Amprion");
    b.click();
    const svg = document.querySelector(".pf-karte");
    return svg.getAttribute("data-hervor");
  })()`);
  pruefe(hervor === "Amprion", "Klick auf eine Regelzone hebt sie hervor", String(hervor));
  await foto("karte-zone-amprion", ".pf-karte");
  await js(`document.querySelector('.pf-zonenknopf[data-zone="Amprion"]').click()`);
  await masse(1280, 900);

  const ebene = await js(`(function () {
    const b = document.getElementById("pf-ebene-kraftwerke");
    b.click();
    return { an: b.checked, punkte: document.querySelectorAll(".pf-geo-anlage circle").length };
  })()`);
  pruefe(ebene.an === false && ebene.punkte === 0,
    "Ebenenschalter blendet die Kraftwerke aus",
    `checked=${ebene.an}, Punkte=${ebene.punkte}`);
  await js(`document.getElementById("pf-ebene-kraftwerke").click()`);
  await schlafen(300);

  // --- CSV-Abzug ---
  await c.senden("Browser.setDownloadBehavior", {
    behavior: "allow", downloadPath: AUSGABE, eventsEnabled: true,
  }).catch(() => {});
  const abzug = await js(`(function () {
    let geklickt = false;
    const alt = URL.createObjectURL;
    URL.createObjectURL = function (b) { geklickt = b.size; return alt.call(URL, b); };
    document.querySelector("button.pf-abzug").click();
    URL.createObjectURL = alt;
    return geklickt;
  })()`);
  pruefe(abzug > 500, `CSV-Abzug erzeugt ${abzug} Bytes`);

  // Quellenverzeichnis und die vier Hinweiskaesten
  const qu = await js(`(function () {
    const kopf = [...document.querySelectorAll(".pf-abschnitt > h2")].map((h) => h.textContent);
    const zeilen = [...document.querySelectorAll(".pf-abschnitt table.pf-tabelle tbody tr")];
    const quellenTab = zeilen.filter((r) => r.cells.length === 7);
    const quellenNamen = new Set(quellenTab.map((r) => r.cells[3].textContent));
    const lizenzen = new Set(quellenTab.map((r) => r.cells[4].textContent));
    return {
      kaesten: kopf.filter((x) => /Grenzen|Reichweite|Datenqualit|Offene Punkte/.test(x)),
      quellenAbschnitt: kopf.some((x) => /Quellen und Downloads/.test(x)),
      datensaetze: quellenTab.length,
      quellen: [...quellenNamen], lizenzen: [...lizenzen],
      abzuege: document.querySelectorAll(".pf-abschnitt table.pf-tabelle .pf-abzug").length
    };
  })()`);
  pruefe(qu.kaesten.length === 4,
    `vier Hinweiskaesten: ${qu.kaesten.join(" | ")}`);
  pruefe(qu.quellenAbschnitt, "Abschnitt Quellen und Downloads vorhanden");
  pruefe(qu.datensaetze >= 10, `${qu.datensaetze} Datensaetze im Quellenverzeichnis`);
  pruefe(qu.quellen.length === 5, `fuenf Quellen genannt: ${qu.quellen.join(" | ")}`);
  pruefe(qu.lizenzen.length >= 3, `${qu.lizenzen.length} verschiedene Lizenzen genannt`);
  pruefe(qu.abzuege >= 12, `${qu.abzuege} Abzugsknoepfe im Verzeichnis`);
  await foto("quellen", ".pf-abschnitt:last-of-type");

  // --- Konsole ---
  await schlafen(800);
  const echte = fehlermeldungen.filter((m) => !/favicon/i.test(m));
  pruefe(echte.length === 0, "keine Konsolenfehler", echte.slice(0, 4).join(" | "));

  await c.senden("Target.closeTarget", { targetId });
  ws.close();
} catch (fehler) {
  console.log(`  [FEHLT] Browsertest abgebrochen: ${fehler.message}`);
  befunde.push({ ok: false, text: "Browsertest lief durch" });
} finally {
  chrome.kill();
  await rm(profil, { recursive: true, force: true }).catch(() => {});
}

const schlecht = befunde.filter((b) => !b.ok);
console.log();
if (schlecht.length) {
  console.log(`${schlecht.length} von ${befunde.length} Pruefungen fehlgeschlagen.`);
  code = 1;
} else {
  console.log(`Alle ${befunde.length} Browserpruefungen bestanden.`);
}
console.log(`Bildschirmfotos: ${AUSGABE}`);
process.exit(code);
