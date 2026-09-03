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
  /* FEHLENDE STUNDEN SIND KEINE NULLEN. Am 30.08.2026 lieferte SMARD nur einen
     Teil der Stunden; der Verlauf zeichnete die fehlenden als 0 und zeigte
     einen Einbruch der Erzeugung auf null. Das las sich wie eine Flaute und war
     eine Meldeluecke. Geprueft wird die BEDINGUNG: gibt es Fehlstellen, muessen
     die Flaechen dort getrennt sein und die Stelle markiert. */
  const deckung = await js(`(function () {
    const svg = document.querySelector(".pf-diagramm");
    const baender = [...svg.querySelectorAll(".pf-band")];
    const teile = (d) => (d.match(/M/g) || []).length;
    const last = svg.querySelector(".pf-lastlinie");
    const text = (document.querySelector(".pf-deckungstext") || {}).textContent || "";
    const legende = [...document.querySelectorAll(".pf-legende span")]
      .map((x) => x.textContent).join(" | ");
    return {
      fehlstellen: svg.querySelectorAll(".pf-fehlstelle").length,
      bandTeile: baender.length ? Math.max(...baender.map((b) => teile(b.getAttribute("d")))) : 0,
      lastTeile: last ? teile(last.getAttribute("d")) : 0,
      einfuhrband: svg.querySelectorAll(".pf-einfuhrband").length,
      text: text,
      legende: legende
    };
  })()`);
  if (deckung.fehlstellen) {
    pruefe(deckung.bandTeile > 1,
      "bei einer Fehlstelle sind die Traegerflaechen getrennt, nicht ueber null gezogen",
      `${deckung.bandTeile} Teilpfade`);
    /* Die Netzlastlinie bricht dort, wo die NETZLAST fehlt -- nicht dort, wo
       die Erzeugung fehlt. Am 30.08.2026 lieferte SMARD einzelne Stunden mit
       Netzlast, aber ohne Erzeugung; die Linie ist dort zu Recht durchgezogen.
       Geprueft wird das deshalb weiter unten in der Tagesansicht, wo drei
       ganze Tage ohne Netzlast liegen. */
    pruefe(/keine Daten der Quelle/.test(deckung.legende),
      "die Fehlstelle ist in der Legende benannt");
  } else {
    pruefe(deckung.bandTeile === 1, "ohne Fehlstelle ist jede Flaeche ein Pfad");
  }
  pruefe(deckung.einfuhrband >= 0 && /Einfuhr \(netto\), gemessen/.test(deckung.legende),
    "die gemessene Nettoeinfuhr steht als eigene Flaeche in der Legende");
  pruefe(/Wie die Lücke gedeckt wird|keine Lücke zu decken/.test(deckung.text),
    "unter dem Verlauf steht, wie die Unterdeckung ausgeglichen wird",
    deckung.text.slice(0, 90));
  pruefe(!deckung.text || /Netzverluste/.test(deckung.text) === /Übrig bleiben/.test(deckung.text),
    "und was danach uebrig bleibt, wird benannt statt weggerechnet");

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
    // NUR die Bilanz im Flussbild. Der Kostenblock im Redispatch benutzt
    // dieselbe Darstellung fuer etwas anderes.
    const r = [...document.querySelectorAll(
      ".pf-rechnung:not(.pf-rechnung-kosten) .pf-rechnung-zeile")].map((z) => ({
      label: z.firstChild.textContent, wert: zahl(z.lastChild.textContent)
    }));
    return { titel: titel, gruppen: gruppen, rechnung: r,
             zonen: document.querySelectorAll(".pf-zone").length,
             stapel: document.querySelectorAll(".pf-zone-stapel span").length,
             fuss: [...document.querySelectorAll(".pf-zone-fuss")].map((x) => x.textContent) };
  })()`);
  pruefe(fluss.titel.some((x) => /Import/.test(x)),
    "die Zuflusssaeule nennt den Import", fluss.titel.join(" | "));
  pruefe(fluss.titel.filter((x) => /Import je Nachbarland/.test(x)).length === 1,
    "Import ist eine eigene Saeule, kein Anhaengsel", fluss.titel.join(" | "));
  pruefe(fluss.titel.length === 4, `vier Saeulen im Flussbild (${fluss.titel.length})`,
    fluss.titel.join(" | "));
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
      gruppen: [...document.querySelectorAll(".pf-rd-gruppe")].map(
        (g) => g.querySelector("h4").textContent),
      angewiesen: [...document.querySelectorAll(".pf-rd-gruppe")]
        .filter((g) => /Angewiesen/.test(g.querySelector("h4").textContent))
        .flatMap((g) => [...g.querySelectorAll(".pf-name")].map((x) => x.textContent)),
      grundgruppen: [...document.querySelectorAll(".pf-rd-grund .pf-name")]
        .map((x) => x.textContent),
      streifen: document.querySelectorAll(".pf-rd-streifen span").length,
      roh: [...document.querySelectorAll(".pf-rd-roh")].map((x) => x.textContent),
      warnung: [...document.querySelectorAll(".pf-rd-gruende .pf-karte-warnung")]
        .map((x) => x.textContent).join(" "),
      ausland: [...document.querySelectorAll(".pf-verlauf .pf-bezug")]
        .map((x) => x.textContent).filter((x) => /ausl/i.test(x)).join(" ")
    };
  })()`);
  pruefe(rd.kachel, "Redispatch-Kachel vorhanden");
  pruefe(rd.abschnitt, "Redispatch-Abschnitt vorhanden");
  pruefe(rd.zahlen === 3, `drei Redispatch-Kennzahlen (${rd.zahlen})`);
  // Fuenf seit dem 03.09.2026: "Kosten je Regelzone" ist dazugekommen.
  pruefe(rd.gruppen.length === 5, `fuenf Balkengruppen (${rd.gruppen.join(" | ")})`);
  pruefe(rd.angewiesen.filter((x) => /^(50Hertz|Amprion|TenneT DE|TransnetBW)$/.test(x)).length === 4,
    `alle vier UeNB unter "Angewiesen von" (${rd.angewiesen.join(", ")})`);
  pruefe(rd.gruppen.some((x) => /Angefordert/.test(x))
    && rd.gruppen.some((x) => /Dauer/.test(x)),
    "Angefordert-von und Dauer sind eigene Gruppen", rd.gruppen.join(" | "));

  /* Die Trennung des Probebetriebs ist der Kern dieser Ergaenzung: nicht jede
     Redispatch-Massnahme ist ein Eingriff im Notfall. Geprueft wird, dass die
     Gruppe da ist, dass der Streifen die Anteile zeigt und dass der Wortlaut
     der Quelle mitsteht -- ohne den waere die Einteilung eine Behauptung. */
  pruefe(rd.grundgruppen.length >= 2,
    `Gruende sind aufgegliedert (${rd.grundgruppen.join(" | ")})`);
  pruefe(rd.streifen === rd.grundgruppen.length,
    `der Streifen zeigt jede Gruppe (${rd.streifen} zu ${rd.grundgruppen.length})`);
  pruefe(rd.roh.length === rd.grundgruppen.length
    && rd.roh.every((x) => /In der Quelle:/.test(x)),
    "jede Gruppe nennt den Wortlaut der Quelle", rd.roh[0]);
  pruefe(/Probebetrieb ist kein Notfall|keinen Probebetrieb/.test(rd.warnung),
    "der Probebetrieb wird ausdruecklich vom Notfall getrennt",
    rd.warnung.slice(0, 90));
  /* KOSTEN DES ENGPASSMANAGEMENTS. Die Quelle ist MONATLICH -- der Zeitraum
     taggenau. Geprueft wird deshalb beides: dass der Block bei vollen Monaten
     eine Summe zeigt, und dass er bei einem kuerzeren Zeitraum KEINE zeigt,
     sondern sagt warum. Eine Summe ueber angebrochene Monate waere eine
     Falschaussage. */
  const kosten = await js(`(function () {
    const k = document.querySelector(".pf-rd-kosten");
    if (!k) { return null; }
    const stapel = [...k.querySelectorAll(".pf-kosten-stapel")];
    return {
      da: true,
      titel: (k.querySelector("h4") || {}).textContent || "",
      monate: stapel.length,
      teile: Math.max(0, ...stapel.map((s) => s.querySelectorAll("i").length)),
      massstab: [...k.querySelectorAll(".pf-saeule-massstab")]
        .map((x) => x.textContent).join(" | "),
      summe: [...k.querySelectorAll(".pf-rd-zahl .pf-titel")].map((x) => x.textContent),
      warnung: [...k.querySelectorAll(".pf-karte-warnung")].map((x) => x.textContent).join(" "),
      text: k.textContent,
      infoknopf: k.querySelectorAll(".pf-info").length
    };
  })()`);
  pruefe(kosten && kosten.da, "der Kostenblock steht im Redispatch-Abschnitt");
  if (kosten) {
    pruefe(/Was es kostet/.test(kosten.titel), "er heisst 'Was es kostet'", kosten.titel);
    pruefe(kosten.monate >= 6, `er zeigt ${kosten.monate} Monatsbalken`);
    pruefe(kosten.teile >= 2,
      "die Balken sind nach Posten gestapelt, nicht einfarbig", String(kosten.teile));
    pruefe(/Balken bis/.test(kosten.massstab),
      "jede Balkengruppe nennt ihren Massstab", kosten.massstab.slice(0, 80));
    pruefe(kosten.infoknopf === 1, "es gibt genau einen Info-Knopf dazu");
    pruefe(/Monat/.test(kosten.text),
      "die Monatsaufloesung wird benannt");
    // Der Zeitraum des Tests ist eine Woche -- also KEIN voller Monat.
    pruefe(kosten.summe.length === 0,
      "ohne vollen Monat im Zeitraum steht keine Kostensumme da",
      kosten.summe.join(", "));
    pruefe(/keinen vollen Monat/.test(kosten.warnung),
      "und es steht da, warum nicht", kosten.warnung.slice(0, 90));
  }
  await foto("kosten", ".pf-rd-kosten");

  /* Und die Gegenprobe: ein VOLLER Monat muss eine Summe ergeben. Ohne diesen
     Fall prueft der Test nur, dass nie eine Summe erscheint. */
  await js(`document.getElementById("pf-von").value = "2025-06-01";`
    + `document.getElementById("pf-von").dispatchEvent(new Event("change", { bubbles: true }));`);
  await schlafen(600);
  await js(`document.getElementById("pf-bis").value = "2025-06-30";`
    + `document.getElementById("pf-bis").dispatchEvent(new Event("change", { bubbles: true }));`);
  await schlafen(2500);
  const kostenVoll = await js(`(function () {
    const k = document.querySelector(".pf-rd-kosten");
    if (!k) { return null; }
    const zahl = (t) => {
      const f = [...k.querySelectorAll(".pf-rd-zahl")]
        .find((x) => new RegExp(t).test(x.textContent));
      return f ? f.querySelector(".pf-wert").textContent : "";
    };
    return {
      gesamt: zahl("Kosten gesamt"),
      redispatch: zahl("davon Redispatch"),
      bezug: [...k.querySelectorAll(".pf-bezug")].map((x) => x.textContent).join(" "),
      warnung: [...k.querySelectorAll(".pf-karte-warnung")].map((x) => x.textContent).join(" ")
    };
  })()`);
  if (kostenVoll) {
    pruefe(/€/.test(kostenVoll.gesamt) && /€/.test(kostenVoll.redispatch),
      `bei einem vollen Monat steht die Summe da (${kostenVoll.gesamt})`);
    pruefe(/volle[nr]? Monat/.test(kostenVoll.bezug),
      "und es steht dabei, ueber wie viele volle Monate summiert wurde");
    pruefe(/ct je kWh/.test(kostenVoll.bezug),
      "die Umrechnung auf eine menschliche Bezugsgroesse steht dabei");
    pruefe(/Netzentgeltrecht/.test(kostenVoll.bezug),
      "mit dem Vorbehalt, dass es nicht der Betrag auf der Stromrechnung ist");
    pruefe(!/keinen vollen Monat/.test(kostenVoll.warnung),
      "und die Warnung fuer angebrochene Monate steht dann NICHT da");
  }
  await foto("kosten-monat", ".pf-rd-kosten");
  await js(`[...document.querySelectorAll(".pf-schnell")].find((b) => b.textContent === "Letzte 7 Tage").click()`);
  await schlafen(2500);

  await foto("redispatch", ".pf-rd-kopf");
  await foto("redispatch-zeit", ".pf-rd-gruende");

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
  /* Die Tagesansicht ueber 30 Tage enthaelt die drei Tage ohne Netzlast. Dort
     MUSS die Linie unterbrochen sein -- eine gerade Strecke ueber ein Loch ist
     eine Behauptung ueber nie gemessene Werte. */
  /* Der Zeitraum muss die Luecke UMSCHLIESSEN. Im vorigen Monat liegen die
     fehlenden Tage am Ende -- dort hoert die Linie einfach auf, und das ist
     kein Bruch. Erst wenn Daten davor UND danach stehen, muss sie zweiteilig
     sein. */
  await js(`document.getElementById("pf-von").value = "2026-08-20";`
    + `document.getElementById("pf-von").dispatchEvent(new Event("change", { bubbles: true }));`);
  await schlafen(600);
  await js(`document.getElementById("pf-bis").value = "2026-09-02";`
    + `document.getElementById("pf-bis").dispatchEvent(new Event("change", { bubbles: true }));`);
  await schlafen(2500);
  const linie = await js(`(function () {
    const l = document.querySelector(".pf-diagramm .pf-lastlinie");
    const svg = document.querySelector(".pf-diagramm");
    return {
      teile: l ? (l.getAttribute("d").match(/M/g) || []).length : 0,
      fehlstellen: svg ? svg.querySelectorAll(".pf-fehlstelle").length : 0
    };
  })()`);
  if (linie.fehlstellen) {
    pruefe(linie.teile > 1,
      "in der Tagesansicht ist die Netzlastlinie an der Luecke unterbrochen",
      `${linie.teile} Teilpfade bei ${linie.fehlstellen} Fehlstellen`);
  } else {
    pruefe(linie.teile === 1, "ohne Luecke ist die Netzlastlinie durchgezogen");
  }

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

  /* Die abgeleitete Regelzonenflaeche. Geprueft wird ausdruecklich, dass sie
     AUS ist, wenn niemand sie einschaltet -- das ist eine Auflage aus
     docs/beleg-regelzonenflaeche.md und keine Geschmacksfrage. */
  const zf = await js(`(function () {
    const b = document.getElementById("pf-ebene-zonenflaeche");
    if (!b) { return { fehlt: true }; }
    const vorher = { an: b.checked,
                     pfade: document.querySelectorAll(".pf-zonenflaeche path").length };
    b.click();
    return { vorher: vorher, beschriftung: b.parentNode.textContent.trim() };
  })()`);
  pruefe(!zf.fehlt, "Ebene fuer die Regelzonenflaeche vorhanden");
  pruefe(zf.vorher && zf.vorher.an === false && zf.vorher.pfade === 0,
    "die abgeleitete Flaeche ist voreingestellt AUS", JSON.stringify(zf.vorher));
  pruefe(/abgeleitet/.test(zf.beschriftung || ""),
    "die Ebene heisst ausdruecklich 'abgeleitet'", zf.beschriftung);
  await schlafen(2000);
  const zfAn = await js(`(function () {
    const p = [...document.querySelectorAll(".pf-zonenflaeche path")];
    return { pfade: p.length, zonen: p.map((x) => x.getAttribute("data-zone")),
             deckung: p.length ? getComputedStyle(p[0]).fillOpacity : null,
             titel: p.length ? p[0].querySelector("title").textContent : "" };
  })()`);
  pruefe(zfAn.pfade === 4, `eingeschaltet zeichnet sie vier Zonen (${zfAn.pfade})`,
    JSON.stringify(zfAn.zonen));
  pruefe(parseFloat(zfAn.deckung) <= 0.25,
    `die Flaeche bleibt blass (fill-opacity ${zfAn.deckung})`);
  pruefe(/keine amtliche Grenze/.test(zfAn.titel),
    "die Flaeche sagt im Titel, dass sie keine amtliche Grenze ist", zfAn.titel);
  await js(`document.getElementById("pf-ebene-zonenflaeche").click()`);
  await schlafen(400);

  // Der Zeitraumblock bleibt oben stehen, und der Themaknopf sitzt darin.
  const kleber = await js(`(function () {
    const drin = !!document.querySelector(".pf-regler .pf-thema-knopf");
    window.scrollTo(0, 1400);
    const r = document.querySelector(".pf-regler-abschnitt").getBoundingClientRect();
    const ueberschriften = [...document.querySelectorAll(".pf-abschnitt > h2")]
      .map((x) => x.textContent);
    window.scrollTo(0, 0);
    return { knopfDrin: drin, oben: Math.round(r.top),
             freieVariable: ueberschriften.some((x) => /Freie Variable/.test(x)) };
  })()`);
  pruefe(kleber.knopfDrin, "der Hell/Dunkel-Knopf sitzt im Zeitraumblock");
  pruefe(kleber.oben >= -2 && kleber.oben < 60,
    `der Zeitraumblock bleibt beim Scrollen oben stehen (top ${kleber.oben})`);
  pruefe(!kleber.freieVariable,
    "keine Abschnittsueberschrift 'Freie Variable' mehr");
  await schlafen(300);

  /* Der mengengewichtete Aussenhandelspreis. Geprueft wird nicht nur, DASS er
     dasteht, sondern dass der Vorbehalt mitsteht -- ohne ihn liest sich die
     Differenz als Handelsspanne, und das waere falsch. */
  const ahp = await js(`(function () {
    // Die Preise stehen als EIGENE Zeile unter dem ganzen Flussblock, nicht
    // mehr als Fussnote in zwei Saeulen. Sie standen dort nebeneinander, ohne
    // vergleichbar zu sein -- deswegen wurden sie herausgeloest.
    const felder = [...document.querySelectorAll(".pf-preisfeld")];
    const hinweis = document.querySelector(".pf-ahp-hinweis");
    // Ohne regulaeren Ausdruck: in einem Template-Literal faellt jeder
    // Backslash zusammen, und die Zeichenklasse ist danach kaputt. Das ist
    // hier schon zweimal passiert.
    const zahl = (f) => {
      if (!f) { return null; }
      const w = f.querySelector(".pf-wert");
      if (!w) { return null; }
      const roh = w.textContent.split("€")[0].trim()
        .split(".").join("").replace(",", ".");
      const x = parseFloat(roh);
      return isNaN(x) ? null : x;
    };
    const nach = (s) => felder.find(
      (f) => (f.querySelector(".pf-titel") || {}).textContent
        && f.querySelector(".pf-titel").textContent.indexOf(s) >= 0);
    const flussblock = document.querySelector(".pf-fluss");
    return {
      felder: felder.length,
      ein: zahl(nach("Eingef")),
      aus: zahl(nach("Ausgef")),
      // Steht die Zeile wirklich UNTER dem Block und nicht darin?
      inSaeule: felder.some((f) => f.closest(".pf-saeule") !== null),
      unterBlock: flussblock && felder.length
        ? flussblock.getBoundingClientRect().bottom
          <= felder[0].getBoundingClientRect().top + 1
        : false,
      hinweis: hinweis ? hinweis.textContent : ""
    };
  })()`);
  pruefe(ahp.ein !== null && ahp.aus !== null,
    `Ein- und Ausfuhrpreis stehen da (${ahp.ein} / ${ahp.aus} EUR/MWh)`);
  pruefe(ahp.felder === 3,
    "drei Preisfelder: Einfuhr, Ausfuhr, Abstand", String(ahp.felder));
  pruefe(!ahp.inSaeule && ahp.unterBlock,
    "die Preiszeile steht unter dem ganzen Block, nicht in einer Saeule");
  pruefe(ahp.ein > 0 && ahp.ein < 1000 && ahp.aus > -100 && ahp.aus < 1000,
    "beide Preise liegen im moeglichen Bereich", `${ahp.ein} / ${ahp.aus}`);
  pruefe(ahp.hinweis.indexOf("an der Grenze abgerechnet") >= 0,
    "der Vorbehalt zum Grenzabrechnungspreis steht dabei",
    ahp.hinweis.slice(0, 90));
  pruefe(ahp.hinweis.indexOf("mengengewichtet") >= 0,
    "und dass stuendlich gewichtet wird, nicht ueber Tagesmittel");

  /* DER MASSSTAB DER SAEULEN. Anlass ist ein echter Fehler: Import und Export
     hatten getrennte Massstaebe, und 170 GWh aus Frankreich standen als
     kurzer Strich neben 278 GWh nach Oesterreich als vollem Balken. Geprueft
     wird beides -- dass jede Saeule ihren Massstab nennt, und dass Import und
     Export denselben haben. */
  const skala = await js(`(function () {
    const s = [...document.querySelectorAll(".pf-saeule")];
    const nimm = (t) => s.find(
      (x) => x.querySelector("h3").textContent.indexOf(t) >= 0);
    const txt = (x) => {
      const m = x && x.querySelector(".pf-saeule-massstab");
      return m ? m.textContent : "";
    };
    const laenge = (x) => {
      const f = x && x.querySelector(".pf-fuellung");
      return f ? parseFloat(f.style.width) : null;
    };
    const imp = nimm("Import"), exp = nimm("Export"), erz = nimm("Erzeugung");
    return {
      imp: txt(imp), exp: txt(exp), erz: txt(erz),
      // Der laengste Balken in genau einer der beiden Handelssaeulen muss auf
      // 100 % stehen -- in der anderen kuerzer. Bei getrennten Massstaeben
      // waeren es zwei Hundertprozenter.
      impErster: laenge(imp), expErster: laenge(exp)
    };
  })()`);
  pruefe(skala.erz && skala.imp && skala.exp,
    "jede Saeule nennt ihren Massstab", skala.imp);
  pruefe(skala.imp === skala.exp && skala.imp.indexOf("gemeinsamer") >= 0,
    "Import und Export teilen einen Massstab", `${skala.imp} | ${skala.exp}`);
  pruefe(skala.erz !== skala.imp,
    "die Erzeugung hat einen eigenen -- sonst waeren alle Laender unsichtbar");
  pruefe(Math.abs(Math.max(skala.impErster, skala.expErster) - 100) < 0.5
    && Math.min(skala.impErster, skala.expErster) < 100,
    "genau einer der beiden laengsten Laenderbalken fuellt die Schiene",
    `${skala.impErster} / ${skala.expErster}`);

  /* LUECKEN IM ZEITRAUM. Anlass: vom 30.08. bis 01.09.2026 fehlt die
     Deutschlandreihe, weil 50Hertz unvollstaendige Stundenwerte meldet -- die
     drei anderen Zonen liegen vor. Eine Summe ueber vier von sieben Tagen ohne
     Warnung daneben ist eine Falschaussage.

     Geprueft wird eine BEDINGUNG, keine Datumsangabe: wenn Tage fehlen, muss
     das Band vor den Kacheln stehen, die fehlenden Tage nennen und mit dem
     ausfuehrlichen Hinweis uebereinstimmen. Fuellt die Quelle die Luecke
     spaeter nach, bleibt die Pruefung gueltig. */
  await js(`document.getElementById("pf-von").value = "2026-08-28";`
    + `document.getElementById("pf-von").dispatchEvent(new Event("change", { bubbles: true }));`);
  await schlafen(600);
  await js(`document.getElementById("pf-bis").value = "2026-09-02";`
    + `document.getElementById("pf-bis").dispatchEvent(new Event("change", { bubbles: true }));`);
  await schlafen(2500);
  const luecke = await js(`(function () {
    const band = document.querySelector(".pf-luecke");
    const kacheln = document.querySelector(".pf-kacheln");
    const hinweise = [...document.querySelectorAll(".pf-kasten li")]
      .map((x) => x.textContent).join(" ");
    // Datumsangaben der Form 30.08.2026 einsammeln -- ohne Zeichenklasse mit
    // Backslash, die faellt im Template-Literal zusammen.
    const daten = (s) => (s.match(/[0-9][0-9][.][0-9][0-9][.]20[0-9][0-9]/g) || []);
    return {
      band: !!band,
      text: band ? band.textContent : "",
      vorKacheln: band && kacheln
        ? !!(band.compareDocumentPosition(kacheln) & Node.DOCUMENT_POSITION_FOLLOWING)
        : null,
      bandDaten: band ? daten(band.textContent) : [],
      hinweisDaten: daten((hinweise.split("Es fehlen:")[1] || "").split(".")[0]
        ? hinweise.split("Es fehlen:")[1].split("Die Lücke")[0] : ""),
      nenntZone: /50Hertz/.test(hinweise) && /Abruf/.test(hinweise),
      hinweisText: hinweise
    };
  })()`);
  if (luecke.band) {
    pruefe(luecke.vorKacheln === true,
      "das Luecken-Band steht VOR den Kennzahlen, nicht darunter");
    pruefe(luecke.bandDaten.length > 0,
      `es nennt die fehlenden Tage (${luecke.bandDaten.join(", ")})`);
    pruefe(/ohne Daten/.test(luecke.text),
      "und sagt, wie viele von wie vielen Tagen fehlen", luecke.text.slice(0, 70));
    pruefe(luecke.hinweisDaten.join(",") === luecke.bandDaten.join(","),
      "Band und ausfuehrlicher Hinweis nennen dieselben Tage",
      `${luecke.bandDaten.join(",")} gegen ${luecke.hinweisDaten.join(",")}`);
    pruefe(luecke.nenntZone,
      "der Hinweis nennt die Regelzone und sagt, dass es kein Abrufausfall ist",
      luecke.hinweisText.slice(0, 120));
  } else {
    pruefe(!/liegen nur/.test(luecke.hinweisText),
      "ohne Band meldet auch der Hinweis keine fehlenden Tage");
  }
  await foto("luecke", ".pf-luecke");
  await js(`[...document.querySelectorAll(".pf-schnell")].find((b) => b.textContent === "Letzte 7 Tage").click()`);
  await schlafen(2500);

  /* DAS ZEITPROFIL DES REDISPATCH -- neu gebaut am 31.08.2026.

     Die erste Fassung war 24 graue Saeulen mit einem title-Attribut. Sie
     beantwortete keine Anschlussfrage. Jetzt ist die Saeule nach dem Grund
     gestapelt, und beim Zeigen oeffnet sich eine echte Ablesung. Geprueft wird
     genau das: die Stapelung, die Ablesung und ihr Inhalt. */
  const rdzeit = await js(`(function () {
    const spalten = [...document.querySelectorAll(".pf-rd-spalte")];
    const stapel = spalten.map((x) => x.querySelector(".pf-rd-stapel"));
    const h = stapel.map((x) => (x ? parseFloat(x.style.height) : 0));
    const teile = stapel.map((x) => (x ? x.querySelectorAll(".pf-rd-teil").length : 0));
    const p = document.querySelector(".pf-rd-gruende .pf-bezug");
    return {
      n: spalten.length,
      voll: h.filter((x) => x > 99.5).length,
      spanne: h.length ? Math.max.apply(null, h) - Math.min.apply(null, h) : 0,
      mehrfarbig: teile.filter((x) => x > 1).length,
      // Summe der Stueckhoehen je Saeule: muss 100 % ergeben, sonst fehlt eine
      // Gruppe im Stapel.
      summen: stapel.map((x) => {
        if (!x) { return 0; }
        let s = 0;
        x.querySelectorAll(".pf-rd-teil").forEach((i) => {
          s += parseFloat(i.style.height);
        });
        return Math.round(s);
      }).filter((s) => s > 0),
      text: p ? p.textContent : "",
      titel: (document.querySelector(".pf-rd-gruende h4") || {}).textContent || ""
    };
  })()`);
  pruefe(rdzeit.n === 24, "24 Saeulen -- eine je Stunde des Tages",
    String(rdzeit.n));
  // Nicht "genau eine": bei kurzen Zeitraeumen koennen zwei Stunden gleichauf
  // liegen, und das ist kein Fehler. Geprueft wird, dass ueberhaupt eine Saeule
  // die volle Hoehe hat und das Profil nicht flach ist.
  pruefe(rdzeit.voll >= 1 && rdzeit.voll <= 3 && rdzeit.spanne > 5,
    "eine Stunde fuellt die Hoehe, und das Profil ist nicht flach",
    `voll ${rdzeit.voll}, Spanne ${rdzeit.spanne}`);
  pruefe(rdzeit.mehrfarbig >= 1,
    "die Saeulen sind nach dem Grund gestapelt, nicht einfarbig",
    `${rdzeit.mehrfarbig} von 24 mit mehr als einem Stueck`);
  pruefe(rdzeit.summen.every((s) => s === 100),
    "jeder Stapel geht auf 100 % auf -- keine Gruppe faellt heraus",
    `${rdzeit.summen.filter((s) => s !== 100).length} Abweichungen`);
  pruefe(/Wann und warum/.test(rdzeit.titel),
    "ein Block statt zweier: Wann UND warum", rdzeit.titel);
  pruefe(rdzeit.text.indexOf("nicht, wie") >= 0
    && rdzeit.text.indexOf("Stufe") >= 0,
    "die Unterschrift sagt, was gezaehlt wird und was die Quelle nicht hat");

  /* DIE ABLESUNG. Der eigentliche Anlass des Umbaus: beim Zeigen kam vorher
     nur der title-Text. Geprueft wird, dass ein echtes Element aufgeht, dass
     es die vier Aufgliederungen fuehrt und dass es die Tastatur bedient. */
  const rdInfo = await js(`(function () {
    const spalten = [...document.querySelectorAll(".pf-rd-spalte")];
    const info = document.querySelector(".pf-rd-info");
    const vorher = info ? info.hasAttribute("hidden") : null;
    // Die Stunde mit dem hoechsten Stapel -- dort ist sicher etwas zu sehen.
    let beste = 0, hoch = -1;
    spalten.forEach((sp, i) => {
      const s = sp.querySelector(".pf-rd-stapel");
      const v = s ? parseFloat(s.style.height) : 0;
      if (v > hoch) { hoch = v; beste = i; }
    });
    spalten[beste].dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    const titel = [...document.querySelectorAll(".pf-rd-info-liste dt.pf-rd-info-titel")]
      .map((x) => x.textContent).filter((x) => x);
    const ergebnis = {
      vorherVersteckt: vorher,
      offen: info && !info.hasAttribute("hidden"),
      uhr: (document.querySelector(".pf-rd-info-uhr") || {}).textContent || "",
      wert: (document.querySelector(".pf-rd-info-wert") || {}).textContent || "",
      abschnitte: titel,
      zeilen: document.querySelectorAll(".pf-rd-info-liste dd").length,
      markiert: document.querySelectorAll(".pf-rd-spalte[data-aktiv]").length,
      farbtupfer: document.querySelectorAll(".pf-rd-info-liste dt i").length
    };
    // Tastatur: Pfeil nach rechts muss eine Stunde weiterruecken.
    const flaeche = document.querySelector(".pf-rd-flaeche");
    flaeche.dispatchEvent(new KeyboardEvent("keydown",
      { key: "ArrowRight", bubbles: true, cancelable: true }));
    ergebnis.nachPfeil = (document.querySelector(".pf-rd-info-uhr") || {}).textContent || "";
    flaeche.dispatchEvent(new KeyboardEvent("keydown",
      { key: "Escape", bubbles: true, cancelable: true }));
    ergebnis.nachEscape = info.hasAttribute("hidden");
    return ergebnis;
  })()`);
  pruefe(rdInfo.vorherVersteckt === true && rdInfo.offen === true,
    "die Ablesung ist zu und geht beim Zeigen auf");
  pruefe(/\d\d:00 bis \d\d:00 Uhr/.test(rdInfo.uhr),
    "sie nennt die Uhrzeit von und bis", rdInfo.uhr);
  pruefe(rdInfo.wert.indexOf("gleichzeitig") >= 0,
    "und den Mittelwert gleichzeitig laufender Massnahmen", rdInfo.wert);
  pruefe(rdInfo.abschnitte.length === 4,
    `vier Aufgliederungen (${rdInfo.abschnitte.join(" | ")})`);
  pruefe(/Regelzone/.test(rdInfo.abschnitte.join(" ")),
    "das WO wird ueber die Regelzone beantwortet, nicht ueber einen Ort");
  pruefe(rdInfo.zeilen >= 8,
    `die Ablesung fuehrt ${rdInfo.zeilen} Zeilen, nicht eine`);
  pruefe(rdInfo.farbtupfer >= 3,
    "Gruende und Richtungen tragen ihre Farbe auch in der Ablesung",
    String(rdInfo.farbtupfer));
  pruefe(rdInfo.markiert === 1,
    "die abgelesene Saeule ist markiert", String(rdInfo.markiert));
  pruefe(rdInfo.nachPfeil !== rdInfo.uhr && rdInfo.nachPfeil !== "",
    "die Pfeiltaste rueckt eine Stunde weiter",
    `${rdInfo.uhr} -> ${rdInfo.nachPfeil}`);
  pruefe(rdInfo.nachEscape === true, "Escape schliesst sie wieder");

  /* Ein Bild MIT geoeffneter Ablesung -- und um 60 px hoeher gescrollt, damit
     der oben klebende Zeitraumblock nicht die Spitze der Saeulen verdeckt. Das
     ist beim ersten Anlauf passiert: die Grafik sah gestutzt aus, war es aber
     nicht. Die Bildschirmfotos werden angesehen, nicht nur gezaehlt. */
  await js(`document.querySelector(".pf-rd-rahmen")`
    + `.scrollIntoView({ block: "center", behavior: "instant" });`
    + `window.scrollBy(0, -70);`);
  await schlafen(350);
  await js(`document.querySelectorAll(".pf-rd-spalte")[11]`
    + `.dispatchEvent(new MouseEvent("mouseenter"))`);
  await schlafen(250);
  await foto("redispatch-ablesung");

  await foto("fluss", ".pf-fluss");
  await foto("fluss-preis", ".pf-preiszeile");

  /* Windparks aus dem Marktstammdatenregister. Auf der Karte steht bewusst
     eine AUSWAHL: alle Parks auf See und die 20 groessten an Land. Die Datei
     unter data/ bleibt vollstaendig. */
  const parks = await js(`(function () {
    const svg = document.querySelector(".pf-karte");
    const w = [...svg.querySelectorAll(".pf-park-wind circle")];
    const legende = [...document.querySelectorAll(".pf-zonenknopf[data-traeger]")]
      .map((x) => x.getAttribute("data-traeger"));
    return {
      wind: w.length,
      windTraeger: w.length ? w[0].getAttribute("data-traeger") : null,
      legende: legende,
      radiusGesetzt: w.every((c) => parseFloat(c.style.getPropertyValue("--r")) > 0)
    };
  })()`);
  pruefe(parks.wind > 40 && parks.wind < 120,
    `Windparks auf der Karte: ${parks.wind} (alle auf See plus 20 an Land)`);
  pruefe(parks.windTraeger === "Wind",
    "Parks tragen ihren Energietraeger als Merkmal", String(parks.windTraeger));
  pruefe(parks.legende.includes("Wind"),
    "Wind steht in der Traegerlegende", parks.legende.join(" | "));
  pruefe(parks.radiusGesetzt, "auch die Parkmarken tragen ihren Grundradius als --r");

  const parkAuswahl = await js(`(function () {
    document.querySelector(".pf-park-wind circle").dispatchEvent(
      new MouseEvent("click", { bubbles: true }));
    const k = document.getElementById("pf-auswahl");
    return k ? k.textContent : "";
  })()`);
  pruefe(/Marktstammdatenregister/.test(parkAuswahl),
    "die Auswahl eines Parks nennt das Marktstammdatenregister",
    parkAuswahl.slice(0, 120));
  pruefe(/Windpark/.test(parkAuswahl), "und sagt, dass es ein Windpark ist",
    parkAuswahl.slice(0, 80));

  /* Reihenfolge und Zoomverhalten der Marken. Beides war ein echter Mangel:
     der groesste Kreis lag oben und verdeckte alles darunter, und weil die
     Radien mitskalierten, half auch Zoomen nichts. */
  const marken = await js(`(function () {
    const svg = document.querySelector(".pf-karte");
    const kw = [...svg.querySelectorAll(".pf-geo-anlage circle")];
    const r = kw.map((c) => parseFloat(c.style.getPropertyValue("--r")));
    let absteigend = true;
    for (let i = 1; i < r.length; i++) { if (r[i] > r[i - 1] + 1e-9) { absteigend = false; } }
    const px = (c) => c.getBoundingClientRect().width / 2;
    const groesste = kw.reduce((a, b) => (px(b) > px(a) ? b : a), kw[0]);
    return { anzahl: kw.length, absteigend: absteigend,
             groesstePx: px(groesste), varianteGesetzt: r.every((x) => x > 0) };
  })()`);
  pruefe(marken.varianteGesetzt, "jede Kraftwerksmarke traegt ihren Grundradius als --r");
  pruefe(marken.absteigend,
    "Kraftwerke werden absteigend nach Leistung gezeichnet, der kleine Kreis liegt oben");

  const gezoomt = await js(`(function () {
    const plus = [...document.querySelectorAll(".pf-kartenbedienung button")]
      .find((x) => x.textContent.trim() === "+");
    for (let i = 0; i < 3; i++) { plus.click(); }
    const svg = document.querySelector(".pf-karte");
    const kw = [...svg.querySelectorAll(".pf-geo-anlage circle")];
    const px = (c) => c.getBoundingClientRect().width / 2;
    const groesste = kw.reduce((a, b) => (px(b) > px(a) ? b : a), kw[0]);
    return { px: px(groesste),
             faktor: parseFloat(getComputedStyle(svg).getPropertyValue("--pf-zoom")) };
  })()`);
  pruefe(gezoomt.faktor < 0.6,
    `dreimal Zoomen verkleinert den Markenfaktor auf ${gezoomt.faktor}`);
  pruefe(Math.abs(gezoomt.px - marken.groesstePx) < 2,
    "die groesste Marke behaelt beim Zoomen ihre Bildschirmgroesse "
      + `(${marken.groesstePx.toFixed(1)} px -> ${gezoomt.px.toFixed(1)} px)`,
    "so und nur so loest ein Zoom eine Haeufung auf");
  await js(`[...document.querySelectorAll(".pf-kartenbedienung button")]
    .find((x) => /zur/i.test(x.textContent)).click()`);
  await schlafen(400);

  /* "Ansicht zuruecksetzen" muss ALLES zuruecksetzen, was die Ansicht
     ausmacht -- Ausschnitt, hervorgehobene Zone, hervorgehobener Traeger und
     die Auswahl. Frueher blieb alles ausser dem Ausschnitt stehen. */
  const ansichtZurueck = await js(`(function () {
    const svg = document.querySelector(".pf-karte");
    document.querySelector('.pf-zonenknopf[data-zone="TenneT"]').click();
    document.querySelector(".pf-geo-anlage circle").dispatchEvent(
      new MouseEvent("click", { bubbles: true }));
    const t = [...document.querySelectorAll(".pf-zonenknopf[data-traeger]")][0];
    if (t) { t.click(); }
    const vorher = {
      zone: svg.getAttribute("data-hervor"),
      traeger: svg.getAttribute("data-traeger-hervor"),
      gewaehlt: svg.querySelectorAll("[data-gewaehlt]").length,
      kasten: !document.getElementById("pf-auswahl").hidden
    };
    [...document.querySelectorAll(".pf-kartenbedienung button")]
      .find((x) => /Ansicht/.test(x.textContent)).click();
    return { vorher: vorher, nachher: {
      zone: svg.getAttribute("data-hervor"),
      traeger: svg.getAttribute("data-traeger-hervor"),
      gewaehlt: svg.querySelectorAll("[data-gewaehlt]").length,
      kasten: !document.getElementById("pf-auswahl").hidden,
      sicht: svg.getAttribute("viewBox")
    } };
  })()`);
  pruefe(ansichtZurueck.vorher.zone || ansichtZurueck.vorher.traeger || ansichtZurueck.vorher.gewaehlt,
    "Voraussetzung: vor dem Zuruecksetzen ist etwas hervorgehoben oder gewaehlt",
    JSON.stringify(ansichtZurueck.vorher));
  pruefe(!ansichtZurueck.nachher.zone && !ansichtZurueck.nachher.traeger,
    "Zuruecksetzen loescht Regelzone und Energietraeger",
    JSON.stringify(ansichtZurueck.nachher));
  pruefe(ansichtZurueck.nachher.gewaehlt === 0 && !ansichtZurueck.nachher.kasten,
    "Zuruecksetzen hebt auch die Auswahl auf", JSON.stringify(ansichtZurueck.nachher));
  pruefe(ansichtZurueck.nachher.sicht === "0 0 1000 780",
    `Zuruecksetzen stellt den Ausschnitt her (${ansichtZurueck.nachher.sicht})`);
  await schlafen(300);

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
  /* Die Liste "Was noch fehlt" ist am 31.08.2026 durchgegangen worden und hat
     seither eine Reihenfolge: was oben steht, wird als Naechstes angefasst.
     Geprueft wird, dass die Markierung da ist und dass die beiden gestrichenen
     Punkte nicht zurueckkommen. */
  const offen = await js(`(function () {
    const kasten = [...document.querySelectorAll(".pf-kasten")].find(
      (k) => /Offene Punkte|Was noch fehlt/.test(k.querySelector("h3").textContent));
    if (!kasten) { return null; }
    const li = [...kasten.querySelectorAll("li")];
    // Der Kasten heisst "Was diese Seite nicht zeigt"; die Ueberschrift des
    // Abschnitts darueber heisst "Grenzen".
    const grenzen = [...document.querySelectorAll(".pf-kasten")].find(
      (k) => /nicht zeigt/.test(k.querySelector("h3").textContent));
    return {
      anzahl: li.length,
      hoch: li.filter((x) => x.querySelector("b")).length,
      erste: li[0] ? li[0].textContent.slice(0, 60) : "",
      texte: li.map((x) => x.textContent).join(" "),
      grenzen: grenzen ? grenzen.textContent : ""
    };
  })()`);
  pruefe(offen && offen.anzahl === 6,
    `sechs offene Punkte (${offen && offen.anzahl})`);
  pruefe(offen && offen.hoch === 1,
    `einer davon ist als "Als Naechstes" markiert (${offen && offen.hoch})`);
  pruefe(offen && /Als N/.test(offen.erste),
    "die Liste beginnt mit einem Punkt hoher Prioritaet", offen && offen.erste);
  pruefe(offen && !/Solaranlagen|Kleine Windparks/.test(offen.texte),
    "die zwei gestrichenen Punkte stehen nicht mehr in der Liste");
  /* ERLEDIGTES DARF NICHT IN DER LISTE STEHEN. Drei Punkte standen dort noch
     als "Als Naechstes", obwohl zwei davon laengst lagen -- das Methodik-PDF
     seit Tagen, Import und Export im Verlauf seit dem 31.08. Eine Liste, in der
     Erledigtes stehen bleibt, glaubt irgendwann niemand mehr. */
  /* Der Bilanzrest ist am 03.09.2026 untersucht worden. Zwei frueher genannte
     Ursachen sind widerlegt und muessen von der Seite verschwunden sein --
     Netzverluste (falsches Vorzeichen) und Pumpspeicherbezug (steckt schon in
     der Netzlast). Geprueft wird beides am tatsaechlich angezeigten Text. */
  const rest = await js(`(function () {
    const maengel = [...document.querySelectorAll(".pf-kasten li")]
      .map((x) => x.textContent).join(" ");
    const kachel = [...document.querySelectorAll(".pf-kachel")]
      .find((x) => /Bilanzrest/.test(x.textContent));
    return {
      maengel: maengel,
      nenntRedispatch: /Redispatch erklärt den Rest NICHT/.test(maengel),
      nenntErdgas: /Erdgas, von 25,6 auf 42,9/.test(maengel),
      nimmtZurueck: /falsche Vorzeichen/.test(maengel),
      nenntResiduallast: /Residuallast/.test(maengel),
      kachelDa: !!kachel
    };
  })()`);
  pruefe(rest.nenntRedispatch,
    "die Seite sagt ausdruecklich, dass Redispatch den Bilanzrest nicht erklaert");
  pruefe(rest.nenntErdgas,
    "und benennt den Bruch von 2018 als Erfassungsluecke bei Erdgas");
  pruefe(rest.nimmtZurueck,
    "die zwei widerlegten Ursachen werden ausdruecklich zurueckgenommen");
  pruefe(rest.nenntResiduallast,
    "und es steht da, woran der Rest stattdessen haengt");
  pruefe(!/Darin stecken Netzverluste/.test(rest.maengel),
    "die alte Erklaerung steht nicht mehr in den Maengeln");

  /* Die Maengelliste traegt jetzt die Untersuchung. Sie wird fotografiert,
     nicht nur geprueft -- drei echte Maengel dieses Projekts sind ausschliesslich
     beim Hinsehen aufgefallen. */
  // Der Kasten wird ueber seine UEBERSCHRIFT gesucht, nicht ueber die Stelle in
  // der Liste -- "Zu diesem Zeitraum" steht je nach Datenlage davor oder nicht.
  await js(`(function () {
    const k = [...document.querySelectorAll(".pf-kasten")]
      .find((x) => /Bekannte M/.test((x.querySelector("h3") || {}).textContent || ""));
    if (k) { k.scrollIntoView({ block: "start", behavior: "instant" });
             window.scrollBy(0, -180); }
  })()`);
  await schlafen(350);
  await foto("bilanzrest-maengel");
  await js(`(function () {
    const k = [...document.querySelectorAll(".pf-kachel")]
      .find((x) => /Bilanzrest/.test(x.textContent));
    if (!k) { return; }
    k.scrollIntoView({ block: "center", behavior: "instant" });
    window.scrollBy(0, -60);
    // Geoeffnet wird ueber mouseenter, nicht ueber click -- ein Klick HEFTET
    // das Popover nur an, siehe die Regel dazu in CLAUDE.md.
    const knopf = k.querySelector(".pf-info");
    if (knopf) { knopf.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })); }
  })()`);
  await schlafen(400);
  const restText = await js(`(function () {
    const p = document.querySelector(".pf-popover");
    return p ? p.textContent : "";
  })()`);
  pruefe(restText.indexOf("Residuallast") >= 0 && restText.indexOf("Redispatch") >= 0,
    "das Popover der Bilanzrest-Kachel nennt den Befund", restText.slice(0, 90));
  pruefe(restText.indexOf("falsche Vorzeichen") >= 0,
    "und die Ruecknahme der Netzverlust-Erklaerung");
  await foto("bilanzrest-popover");
  await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
  await schlafen(200);

  pruefe(offen && !/HTTP 403/.test(offen.texte),
    "die beantwortete Lizenzfrage steht nicht mehr als offener Punkt");
  pruefe(offen && !/Methodik-PDF, das sich beim Bau/.test(offen.texte),
    "das gelieferte Methodik-PDF steht nicht mehr als offener Punkt");
  pruefe(offen && !/bisher nur als Summe des/.test(offen.texte),
    "Import und Export im Verlauf stehen nicht mehr als offener Punkt");

  /* DER VORJAHRESVERGLEICH BEI UNGLEICH VIELEN TAGEN. Vom 30.08. bis
     01.09.2026 fehlen drei Tage; die Seite zeigte daraufhin "3.520,9 GWh gegen
     6.955,4 GWh im Vorjahreszeitraum, -49,4 %". Das waren drei Tage gegen
     sechs. Geprueft wird die BEDINGUNG: sind die Zeitraeume ungleich belegt,
     darf keine Prozentzahl aus zwei Summen dastehen. */
  await js(`document.getElementById("pf-von").value = "2026-08-28";`
    + `document.getElementById("pf-von").dispatchEvent(new Event("change", { bubbles: true }));`);
  await schlafen(600);
  await js(`document.getElementById("pf-bis").value = "2026-09-02";`
    + `document.getElementById("pf-bis").dispatchEvent(new Event("change", { bubbles: true }));`);
  await schlafen(2500);
  const vergleich = await js(`(function () {
    const band = document.querySelector(".pf-luecke");
    const bezuege = [...document.querySelectorAll(".pf-kachel .pf-bezug")]
      .map((x) => x.textContent);
    return {
      luecke: !!band,
      // Bei ungleicher Belegung muss "je belegtem Tag" dastehen ...
      jeTag: bezuege.filter((x) => x.indexOf("Je belegtem Tag") >= 0).length,
      // ... und der Hinweis, dass die Summen nicht vergleichbar sind.
      warnung: bezuege.filter((x) => x.indexOf("nicht vergleichbar") >= 0).length,
      gesamt: bezuege.length,
      beispiel: bezuege[0] || ""
    };
  })()`);
  if (vergleich.luecke) {
    pruefe(vergleich.jeTag >= 4,
      `bei ungleich belegten Zeitraeumen wird je belegtem Tag verglichen (${vergleich.jeTag} Kacheln)`,
      vergleich.beispiel);
    pruefe(vergleich.warnung === vergleich.jeTag,
      "und jede dieser Kacheln sagt, dass die Summen nicht vergleichbar sind");
  } else {
    pruefe(true, "keine Luecke im Zeitraum -- Vergleich der Summen ist zulaessig");
  }
  /* Und der Anteil, der zwei verschieden lange Zeitraeume durcheinander
     teilt: Redispatch liegt fuer alle Tage vor, die Netzlast nicht. "263,9 GWh
     = 7,49 % der Netzlast" waeren sechs Tage geteilt durch drei gewesen. */
  const anteil = await js(`(function () {
    const k = [...document.querySelectorAll(".pf-kachel")]
      .find((x) => /Redispatch/.test(x.textContent));
    const abschnitt = document.querySelector(".pf-rd-kopf")
      ? document.querySelector(".pf-rd-kopf").parentNode.querySelector(".pf-bezug")
      : null;
    return {
      kachel: k ? k.querySelector(".pf-bezug").textContent : "",
      abschnitt: abschnitt ? abschnitt.textContent : "",
      luecke: !!document.querySelector(".pf-luecke")
    };
  })()`);
  if (anteil.luecke) {
    pruefe(!/% der Netzlast/.test(anteil.kachel),
      "kein Netzlastanteil, solange Redispatch mehr Tage abdeckt als die Netzlast",
      anteil.kachel.slice(0, 100));
    pruefe(/nicht angebbar/.test(anteil.kachel),
      "und die Kachel sagt, warum", anteil.kachel.slice(0, 100));
    pruefe(/irreführend/.test(anteil.abschnitt),
      "derselbe Vorbehalt im Redispatch-Abschnitt", anteil.abschnitt.slice(0, 110));
  } else {
    pruefe(/% der Netzlast/.test(anteil.kachel),
      "bei gleich langen Zeitraeumen steht der Netzlastanteil da");
  }
  await foto("vorjahresvergleich", ".pf-kacheln");
  await js(`[...document.querySelectorAll(".pf-schnell")].find((b) => b.textContent === "Letzte 7 Tage").click()`);
  await schlafen(2500);
  pruefe(offen && /Regelzone je Windpark/.test(offen.grenzen)
    && /Redispatch auf der Karte/.test(offen.grenzen),
    "die zwei verschobenen Punkte stehen jetzt unter Grenzen");

  /* Das Methodikpapier muss von der Seite aus erreichbar sein -- und
     erreichbar heisst: der Server liefert es wirklich aus, nicht nur der
     Verweis steht da. */
  const methodik = await js(`(async function () {
    const a = [...document.querySelectorAll(".pf-abzug")].find(
      (x) => /Methodik/.test(x.textContent));
    if (!a) { return { fehlt: true }; }
    const antwort = await fetch(a.getAttribute("href"));
    const kopf = await antwort.clone().arrayBuffer();
    return {
      text: a.textContent, ziel: a.getAttribute("href"),
      status: antwort.status,
      typ: antwort.headers.get("content-type"),
      bytes: kopf.byteLength,
      magisch: new TextDecoder().decode(new Uint8Array(kopf).slice(0, 5))
    };
  })()`);
  pruefe(!methodik.fehlt, "Verweis auf das Methodik-PDF vorhanden");
  pruefe(methodik.status === 200,
    `das PDF wird ausgeliefert (HTTP ${methodik.status})`, methodik.ziel);
  pruefe(methodik.magisch === "%PDF-",
    "und ist wirklich ein PDF", String(methodik.magisch));
  pruefe(methodik.bytes > 4000,
    `${methodik.bytes} Bytes -- kein leeres Papier`);

  // Acht seit dem 03.09.2026: die ENTSO-E Transparency Platform liefert die
  // Kosten des Engpassmanagements und ist damit eine eigene Quelle.
  pruefe(qu.quellen.length === 8, `acht Quellen genannt: ${qu.quellen.join(" | ")}`);
  // Die abgeleitete Flaeche muss im Verzeichnis als solche kenntlich sein und
  // darf nicht neben den Messungen stehen.
  pruefe(qu.quellen.some((x) => /KEINE Messung/.test(x)),
    "die abgeleitete Geometrie ist im Verzeichnis als KEINE Messung ausgewiesen",
    qu.quellen.join(" | "));
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
