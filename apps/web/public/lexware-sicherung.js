/*
 * Sicherung aus Lexware Office für den Umzug nach Haben, ohne Public API (Tarife S, M und L).
 *
 * Ausführen: In app.lexware.de anmelden, die Entwicklerwerkzeuge öffnen (F12), in der Konsole dieses Skript
 * einfügen und mit Enter starten. Es liest mit deiner Anmeldung, was die Web-Oberfläche selbst anzeigt, und
 * lädt das Ergebnis als ZIP-Dateien herunter (je höchstens etwa 50 MB). Diese Dateien lädst du in Haben unter
 * Archiv → Umzug hoch. Das Skript ändert nichts in Lexware Office: Es ruft nur lesende Endpunkte auf (die
 * Kontaktsuche ist technisch ein POST, liest aber nur).
 *
 * Die Endpunkte sind nicht dokumentiert; sie sind die, die die Web-Oberfläche im November 2026 aufruft.
 * Welche das sind und wie Haben sie liest, steht in docs/lexoffice.md („Umzug über die Web-Oberfläche“).
 *
 * Inhalt jeder ZIP-Datei:
 *   manifest.json            Format, Version, Teil, Zeitpunkt
 *   kontakte.json            alle Kontakte (in jedem Teil, damit jeder Teil für sich übernommen werden kann)
 *   belege/<id>.json         je Beleg die Antworten der Web-Oberfläche und die Liste seiner Dateien; auch je
 *                            Buchung ohne Beleg (direkt auf einen Bankumsatz gebucht) mit den Bankumsätzen dazu
 *   dateien/<id>/<name>      Original-PDF bzw. E-Rechnungs-XML
 */
(async () => {
  const FORMAT = "haben-lexware-web";
  const VERSION = 2;
  const PART_LIMIT = 50 * 1024 * 1024;
  const PAUSE_MS = 150;
  const MAX_RETRIES = 5;
  /** Gleichzeitige Abfragen bei den Bankumsätzen: es sind oft Tausende, nacheinander dauerte das eine halbe Stunde */
  const PARALLEL = 4;
  const SALES_TYPES = ["Invoice", "CreditNote", "DownPaymentInvoice"];
  const BOOKKEEPING_TYPES = ["SalesInvoice", "SalesCreditNote", "PurchaseInvoice", "PurchaseCreditNote"];
  const NO_FILE = [204, 400, 404, 406];

  if (!/^app\.lex(ware|office)\.de$/.test(location.hostname)) {
    throw new Error("Bitte in app.lexware.de ausführen, angemeldet, in der Konsole der Entwicklerwerkzeuge.");
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const log = (...args) => console.log("[Haben-Sicherung]", ...args);
  const encoder = new TextEncoder();

  // ------------------------------------------------------------------ HTTP

  /** Ein Request mit Pause davor; bei 429, 502–504 und Netzwerkfehlern mit wachsender Wartezeit wiederholt. */
  async function request(path, init = {}) {
    for (let attempt = 0; ; attempt++) {
      await sleep(PAUSE_MS);
      let response;
      try {
        response = await fetch(path, { credentials: "include", ...init });
      } catch (error) {
        if (attempt >= MAX_RETRIES) throw error;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if ([429, 502, 503, 504].includes(response.status) && attempt < MAX_RETRIES) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (response.status === 401) throw new Error("Nicht mehr angemeldet. Bitte neu anmelden und das Skript erneut starten.");
      return response;
    }
  }

  /** JSON; `accepted` sind die Status, deren Antwort gilt (papyrus liefert abgeschlossene Rechnungen mit 423). */
  async function json(path, init = {}, accepted = [200]) {
    const response = await request(path, { ...init, headers: { accept: "application/json", ...(init.headers ?? {}) } });
    if (!accepted.includes(response.status)) throw new Error(`HTTP ${response.status} bei ${path}`);
    return response.json();
  }

  /** Datei oder null, wenn es keine gibt */
  async function file(path) {
    const response = await request(path);
    if (NO_FILE.includes(response.status)) return null;
    if (response.status !== 200) throw new Error(`HTTP ${response.status} bei ${path}`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType: (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase(),
      filename: filenameFrom(response.headers.get("content-disposition")),
    };
  }

  function filenameFrom(disposition) {
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? "");
    if (!match) return null;
    let name = match[1];
    try {
      name = decodeURIComponent(name);
    } catch {
      // nicht kodiert
    }
    return name.replace(/[/\\]/g, "_").trim() || null;
  }

  // ------------------------------------------------------------------ Daten

  async function contacts() {
    const byId = new Map();
    for (const archived of [false, true]) {
      for (let firstRow = 0; ; firstRow += 100) {
        const page = await json("/desmos-rest/contacts/v1/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            search: null,
            tags: null,
            firstRow,
            numRows: 100,
            customer: null,
            vendor: null,
            archived,
            format: "FULL",
            sortBy: "NAME",
            sortDirection: "ASCENDING",
            includeTurnover: false,
          }),
        });
        for (const contact of page.elements ?? []) byId.set(contact.id, contact);
        if ((page.elements ?? []).length < 100) break;
      }
    }
    return [...byId.values()];
  }

  /** Belegliste, nicht archiviert und archiviert; Angebote, Aufträge, Lieferscheine und Entwürfe bleiben draußen */
  async function voucherList() {
    const byId = new Map();
    for (const archived of ["", "&archived=true"]) {
      for (let firstRow = 0; ; firstRow += 500) {
        const page = await json(
          `/grld-rest/voucherservice/1/v200/vouchers?ascending=true&deletedIds=&firstRow=${firstRow}&numRows=500&orderBy=voucherDate${archived}`,
        );
        for (const item of page.content ?? []) byId.set(item.entityId, item);
        if (firstRow + 500 >= (page.numFound ?? 0)) break;
      }
    }
    return [...byId.values()].filter(
      (item) =>
        item.billingStatus !== "draft" &&
        ((item.entityType === "salesvoucher" && SALES_TYPES.includes(item.entitySubType)) ||
          (item.entityType === "bookkeepingvoucher" && BOOKKEEPING_TYPES.includes(item.entitySubType))),
    );
  }

  /** Bankumsätze, die einem Beleg aus der Belegliste zugeordnet sind, mit der Zahl der Zuordnungen */
  const assigned = new Map();

  /** Antworten und Dateien eines Belegs */
  async function voucher(item) {
    const id = encodeURIComponent(item.entityId);
    const type = encodeURIComponent(item.entitySubType);
    const details = await json(`/grld-rest/voucherservice/1/v100/voucherDetails/${type}/${id}`);
    for (const line of details.paymentListItems ?? []) {
      if (line.referenceType === "FinancialTransaction" && line.referenceId) assigned.set(line.referenceId, (assigned.get(line.referenceId) ?? 0) + 1);
    }
    const files = [];
    if (item.entityType === "salesvoucher") {
      const document = await json(`/papyrus-rest/vouchers/sales-voucher/${id}`, {}, [200, 423]);
      const pdf = await file(`/salesdocgen/salesdocgen-rest/document/v100/salesVoucherPdf/${id}`);
      if (pdf) files.push({ role: "pdf", ...pdf });
      return { entry: { list: item, details, document }, files };
    }
    const capsa = await json(`/capsa/capsa-rest/vouchers/v1/vouchers/${id}`);
    const hasImages = (capsa.voucherImages ?? details.voucherImages ?? []).length > 0;
    if (hasImages) {
      const pdf = await file(`/grld-rest/printservice/1/v100/printSimpleVoucherPdf/${id}/`);
      if (pdf) files.push({ role: "anhang", ...pdf });
    }
    if (capsa.consideredEInvoice || details.consideredEInvoice) {
      const xml = await file(`/capsa/capsa-rest/v1/vouchers/${id}/einvoice`);
      if (xml) files.push({ role: "xml", ...xml });
    }
    return { entry: { list: item, details, capsa }, files };
  }

  /** Alle Bankumsätze außer den ignorierten */
  async function transactions() {
    const all = [];
    for (let page = 0; ; page++) {
      const result = await json(`/fis/finance-rest/financialtransactionservice/v3/financialTransactions?pageNumber=${page}&pageSize=500&ignored=false`);
      all.push(...(result.content ?? []));
      if (page + 1 >= (result.totalPages ?? 0)) break;
    }
    return all;
  }

  /** Arbeitet `items` mit PARALLEL gleichzeitigen Abfragen ab */
  async function parallel(items, worker) {
    let next = 0;
    const lane = async () => {
      while (next < items.length) await worker(items[next++]);
    };
    await Promise.all(Array.from({ length: PARALLEL }, lane));
  }

  /**
   * Buchungen ohne Beleg: In Lexware Office lässt sich ein Bankumsatz direkt einer Kategorie zuordnen, ohne
   * Belegdatei (auch Privatentnahmen). Diese Buchungen stehen nicht in der Belegliste, zählen aber in der
   * Voranmeldung. Gefunden werden sie über die Bankumsätze, die mehr Zuordnungen haben als Belege aus der
   * Liste; je Umsatz nennt voucherPayments die Buchung. Liefert je Buchung den Eintrag wie bei einem Beleg.
   */
  async function financialVouchers(failed) {
    const open = (await transactions()).filter((t) => (t.numberOfVouchers ?? 0) > (assigned.get(t.financialTransactionId) ?? 0));
    log(`${open.length} Bankumsätze ohne Beleg aus der Liste, suche die Buchungen dazu …`);
    const byVoucher = new Map();
    await parallel(open, async (t) => {
      try {
        const result = await json(
          `/fis/finance-rest/voucherpaymentintegrationservice/v100/voucherPayments/financialTransaction/${encodeURIComponent(t.financialTransactionId)}`,
        );
        for (const payment of result.voucherPayments ?? []) {
          if (!String(payment.voucherType ?? "").startsWith("FINANCIAL_") || !payment.voucherId) continue;
          const found = byVoucher.get(payment.voucherId) ?? { payments: [], transactions: [] };
          found.payments.push(payment);
          if (!found.transactions.some((x) => x.financialTransactionId === t.financialTransactionId)) found.transactions.push(t);
          byVoucher.set(payment.voucherId, found);
        }
      } catch (error) {
        const label = `Bankumsatz ${String(t.transactionDate ?? "").slice(0, 10)} ${t.recipientOrSenderName ?? ""} ${t.amount ?? ""}`.trim();
        failed.push({ id: t.financialTransactionId, type: "FinancialTransaction", number: label, message: String(error?.message ?? error) });
      }
    });
    log(`${byVoucher.size} Buchungen ohne Beleg. Lade sie …`);
    const entries = [];
    await parallel([...byVoucher], async ([id, financial]) => {
      try {
        const details = await json(`/grld-rest/financialvoucherservice/v100/financialVoucher/${encodeURIComponent(id)}`);
        const list = {
          entityId: id,
          entityType: "financialvoucher",
          entitySubType: details.type,
          identificationNumber: null,
          billingStatus: details.billingStatus,
          totalGrossAmount: details.totalGrossAmount,
          openAmount: 0,
          archived: details.archived,
          voucherDate: details.voucherDate,
          createdDate: details.createdDate,
        };
        entries.push({ list, details, financial });
      } catch (error) {
        const type = financial.payments[0]?.voucherType === "FINANCIAL_SALES_INVOICE" ? "FinancialSalesInvoice" : "FinancialPurchaseInvoice";
        failed.push({ id, type, number: "", message: String(error?.message ?? error) });
      }
    });
    return entries;
  }

  // ------------------------------------------------------------------ ZIP (ohne Kompression)

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
  log("Kontakte …");
  const allContacts = await contacts();
  log(`${allContacts.length} Kontakte. Belegliste …`);
  const items = await voucherList();
  log(`${items.length} Belege. Lade Details und Dateien; das dauert etwa ${Math.ceil((items.length * 4 * (PAUSE_MS + 150)) / 60000)} Minuten.`);

  const contactsJson = encoder.encode(JSON.stringify(allContacts));
  let part = 0;
  let zip = null;
  let failed = [];
  let inPart = 0;

  function startPart() {
    part += 1;
    zip = zipWriter();
    failed = [];
    inPart = 0;
    zip.add("kontakte.json", contactsJson);
  }

  function finishPart() {
    const manifest = { format: FORMAT, version: VERSION, part, createdAt, origin: location.origin, vouchers: inPart, failed };
    zip.add("manifest.json", encoder.encode(JSON.stringify(manifest, null, 2)));
    const name = `lexware-sicherung-${stamp}-teil-${String(part).padStart(2, "0")}.zip`;
    download(zip.finish(), name);
    log(`${name} heruntergeladen (${inPart} Belege).`);
  }

  startPart();
  for (const [index, item] of items.entries()) {
    let result;
    try {
      result = await voucher(item);
    } catch (error) {
      // Ein Fehler hält den Lauf nicht auf; Haben zeigt den Beleg in der Liste der fehlgeschlagenen an
      failed.push({ id: item.entityId, type: item.entitySubType, number: item.identificationNumber ?? "", message: String(error?.message ?? error) });
      log(`Fehler bei ${item.identificationNumber || item.entityId}:`, error);
      continue;
    }
    const size = result.files.reduce((sum, f) => sum + f.bytes.length, 0);
    if (inPart > 0 && zip.size + size > PART_LIMIT) {
      finishPart();
      startPart();
    }
    const fileList = [];
    for (const [n, f] of result.files.entries()) {
      const fallback = `${(item.identificationNumber || item.entityId).replace(/[^\w.-]+/g, "_")}-${n + 1}.${f.role === "xml" ? "xml" : "pdf"}`;
      const path = `dateien/${item.entityId}/${n + 1}-${f.filename ?? fallback}`;
      zip.add(path, f.bytes);
      fileList.push({ path, role: f.role, mimeType: f.mimeType, filename: f.filename });
    }
    zip.add(`belege/${item.entityId}.json`, encoder.encode(JSON.stringify({ ...result.entry, files: fileList })));
    inPart += 1;
    if ((index + 1) % 25 === 0) log(`${index + 1} von ${items.length} Belegen`);
  }

  let withoutReceipt = [];
  try {
    withoutReceipt = await financialVouchers(failed);
  } catch (error) {
    // Ohne Bankumsätze fehlen nur die Buchungen ohne Beleg; Haben zeigt das in der Liste der fehlgeschlagenen
    failed.push({ id: "bankumsaetze", type: "FinancialTransaction", number: "Bankumsätze", message: String(error?.message ?? error) });
    log("Fehler bei den Bankumsätzen:", error);
  }
  for (const entry of withoutReceipt) {
    zip.add(`belege/${entry.list.entityId}.json`, encoder.encode(JSON.stringify({ ...entry, files: [] })));
    inPart += 1;
  }
  finishPart();
  log(`Fertig: ${items.length} Belege und ${withoutReceipt.length} Buchungen ohne Beleg in ${part} Datei(en). Jetzt in Haben unter Archiv → Umzug hochladen.`);
})();
