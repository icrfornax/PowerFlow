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
    return document.querySelector(".pf-ablesung").textContent.trim().length;
  })()`);
  pruefe(ablesung > 20, "Fadenkreuz fuellt die Ablesung", `nur ${ablesung} Zeichen`);

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
