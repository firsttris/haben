/*
 * Ausgabenbelege aus FastBill für den Umzug nach Haben, die die API nicht herausgibt.
 *
 * Bei manchen Ausgaben liefert DOCUMENT_URL die Datei nur, wenn man im Browser bei FastBill angemeldet ist; der Abruf in
 * Haben bekommt dort eine leere Antwort und merkt die Ausgabe als „wartet auf Beleg“ vor. Haben setzt beim Kopieren
 * unten die Liste dieser Ausgaben ein (ID und Download-Adresse aus der API).
 *
 * Ausführen: In my.fastbill.com anmelden, die Entwicklerwerkzeuge öffnen (F12), in der Konsole dieses Skript einfügen und
 * mit Enter starten. Es lädt mit deiner Anmeldung genau diese Dateien und gibt sie als ZIP-Dateien zurück (je höchstens
 * etwa 50 MB). Diese lädst du in Haben unter Archiv → Umzug → Umzug aus FastBill hoch. Das Skript liest nur.
 *
 * Inhalt jeder ZIP-Datei:
 *   manifest.json             Format, Version, Teil, Zeitpunkt, IDs ohne Datei
 *   belege/<INVOICE_ID>.<ext> die Datei der Ausgabe, benannt nach ihrer ID in FastBill
 */
(async (LISTE) => {
  const FORMAT = "haben-fastbill-belege";
  const VERSION = 1;
  const PART_LIMIT = 50 * 1024 * 1024;
  const PAUSE_MS = 150;
  const MAX_RETRIES = 5;
  const EXTENSIONS = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

  if (location.hostname !== "my.fastbill.com") {
    throw new Error("Bitte in my.fastbill.com ausführen, angemeldet, in der Konsole der Entwicklerwerkzeuge.");
  }
  if (!Array.isArray(LISTE) || LISTE.length === 0) {
    throw new Error("Die Liste der Belege ist leer. Kopiere das Skript in Haben über „Skript kopieren“, nicht aus der Datei.");
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const log = (...args) => console.log("[Haben-FastBill]", ...args);
  const encoder = new TextEncoder();

  // ------------------------------------------------------------------ HTTP

  /** Ein Abruf mit Pause davor; bei 429, 502–504 und Netzwerkfehlern mit wachsender Wartezeit wiederholt. */
  async function request(url) {
    for (let attempt = 0; ; attempt++) {
      await sleep(PAUSE_MS);
      let response;
      try {
        response = await fetch(url, { credentials: "include" });
      } catch (error) {
        if (attempt >= MAX_RETRIES) throw error;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if ([429, 502, 503, 504].includes(response.status) && attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return response;
    }
  }

  /** Datei einer Ausgabe oder null, wenn FastBill keine liefert (leere oder HTML-Antwort, etwa abgemeldet) */
  async function receipt(entry) {
    const url = new URL(entry.url);
    if (url.host !== location.host) return null;
    const response = await request(url);
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || type.includes("html")) return null;
    const disposition = response.headers.get("content-disposition") ?? "";
    const fromName = /\.([a-z0-9]{2,5})"?\s*$/i.exec(disposition)?.[1]?.toLowerCase();
    return { bytes, ext: EXTENSIONS[type] ?? fromName ?? "bin" };
  }

  // ------------------------------------------------------------------ ZIP (ohne Kompression, wie lexware-sicherung.js)

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Sammelt Einträge und baut daraus eine ZIP-Datei (Methode „stored“, Dateinamen in UTF-8) */
  function zipWriter() {
    const chunks = [];
    const central = [];
    let offset = 0;
    const header = (size) => {
      const buffer = new Uint8Array(size);
      return { buffer, view: new DataView(buffer.buffer) };
    };
    return {
      get size() {
        return offset;
      },
      add(name, bytes) {
        const nameBytes = encoder.encode(name);
        const crc = crc32(bytes);
        const local = header(30 + nameBytes.length);
        local.view.setUint32(0, 0x04034b50, true);
        local.view.setUint16(4, 20, true);
        local.view.setUint16(6, 0x0800, true);
        local.view.setUint32(14, crc, true);
        local.view.setUint32(18, bytes.length, true);
        local.view.setUint32(22, bytes.length, true);
        local.view.setUint16(26, nameBytes.length, true);
        local.buffer.set(nameBytes, 30);
        const entry = header(46 + nameBytes.length);
        entry.view.setUint32(0, 0x02014b50, true);
        entry.view.setUint16(4, 20, true);
        entry.view.setUint16(6, 20, true);
        entry.view.setUint16(8, 0x0800, true);
        entry.view.setUint32(16, crc, true);
        entry.view.setUint32(20, bytes.length, true);
        entry.view.setUint32(24, bytes.length, true);
        entry.view.setUint16(28, nameBytes.length, true);
        entry.view.setUint32(42, offset, true);
        entry.buffer.set(nameBytes, 46);
        chunks.push(local.buffer, bytes);
        central.push(entry.buffer);
        offset += local.buffer.length + bytes.length;
      },
      finish() {
        const centralSize = central.reduce((sum, c) => sum + c.length, 0);
        const end = header(22);
        end.view.setUint32(0, 0x06054b50, true);
        end.view.setUint16(8, central.length, true);
        end.view.setUint16(10, central.length, true);
        end.view.setUint32(12, centralSize, true);
        end.view.setUint32(16, offset, true);
        return new Blob([...chunks, ...central, end.buffer], { type: "application/zip" });
      },
    };
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // ------------------------------------------------------------------ Ablauf

  const createdAt = new Date().toISOString();
  const stamp = createdAt.slice(0, 10);
  log(`${LISTE.length} Belege. Das dauert etwa ${Math.max(1, Math.ceil((LISTE.length * (PAUSE_MS + 300)) / 60000))} Minuten.`);

  let part = 0;
  let zip = null;
  let inPart = 0;
  let found = 0;
  const missing = [];

  const finishPart = () => {
    if (!zip || inPart === 0) return;
    zip.add("manifest.json", encoder.encode(JSON.stringify({ format: FORMAT, version: VERSION, part, createdAt, count: inPart, missing })));
    const name = `fastbill-belege-${stamp}-teil-${part}.zip`;
    download(zip.finish(), name);
    log(`${name} heruntergeladen (${inPart} Belege).`);
    zip = null;
    inPart = 0;
  };

  for (const [index, entry] of LISTE.entries()) {
    const file = await receipt(entry);
    if (!file) {
      missing.push(entry.id);
    } else {
      if (zip && zip.size + file.bytes.length > PART_LIMIT) finishPart();
      if (!zip) {
        zip = zipWriter();
        part += 1;
      }
      zip.add(`belege/${entry.id}.${file.ext}`, file.bytes);
      inPart += 1;
      found += 1;
    }
    if ((index + 1) % 25 === 0) log(`${index + 1} / ${LISTE.length}`);
  }
  finishPart();

  log(`Fertig: ${found} Belege in ${part} ZIP-Datei(en).`);
  if (missing.length) {
    log(
      `${missing.length} ohne Datei: FastBill liefert dort auch angemeldet nichts. Gibt es in FastBill wirklich keinen Beleg, übernimm diese Ausgaben in Haben „ohne Beleg“.`,
    );
  }
})(/*HABEN_LISTE*/ []);
