import { accountingTypeKinds, type AccountingTypeKinds, accountingTypeUnclear, taxTypeOf } from "../auswertungen/index.ts";
import { INTERNAL_ERROR, isUniqueViolation, UserError, userMessage } from "../../errors.ts";
import { truncatedNumberMatches } from "./datev-belegnummer.ts";
import { bookingsCheckDetail, datevBookingCounts } from "./datev-abgleich.ts";
import { SEVDESK_EXPORT_IST_CHECK, sevdeskExportIstIssue, sevdeskExportYear, voucherSourceChecks, withoutExportImage } from "./sevdesk-export-abgleich.ts";
import { effectivePayment, paymentHistoryIssue, unclearFrom, visiblePayment } from "../auswertungen/index.ts";
import { accountingTypeChecks, accountingTypeDecidable, accountingTypeIssue, ACCOUNTING_TYPE_VAT_ISSUE, unclearAccountingTypes } from "./sevdesk-kontoart.ts";
import { effectiveAmount, effectiveContactName, effectiveDirection, effectiveTaxes, effectiveType } from "../auswertungen/index.ts";
import {
  datevYearSums,
  LexofficeApiError,
  LexofficeClient,
  mapContact,
  mapPayments,
  mapSalesDocument,
  mapVoucher,
  type LegacyVoucher,
  type LexFile,
  readWebExport,
  type LexofficeClientOptions,
  type LexofficeSource,
  webExportSource,
} from "@haben/import";
import {
  LEGACY_PAYMENT_TYPES,
  legacyNeutralKind,
  legacyNeutralSums,
  legacyVatByMonth,
  type LegacyNeutralKind,
  type LegacyNeutralSum,
  type Rechtsform,
  type Versteuerung,
} from "@haben/core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { loadCompany } from "../stammdaten/index.ts";
import { decrypt, encrypt } from "../../crypto.ts";
import { withActor } from "../../db/actor.ts";
import { ohneJit } from "../../db/ohne-jit.ts";
import { loadSevdeskAccountCategories, sevdeskCategories, sevdeskPositionAccounts } from "./sevdesk-kategorie.ts";
import { env } from "../../env.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import type { LegacyCategoryRow, LegacyFileState, LegacyPayment, LegacySource, LegacyTaxRow, LexofficeImportProgress } from "../../db/schema.ts";
import { sniff } from "../../storage.ts";
import { attachVoucherFiles, storeLegacyVoucher } from "./legacy-store.ts";
import { latestFastbillImport } from "./fastbill.ts";
import { fastbillPartlyCanceledByYear, fastbillPartlyCanceledChecks, fastbillWaitingChecks } from "./fastbill-abgleich.ts";
import { fastbillWaitingByYear } from "./fastbill-belege.ts";
import { latestSevdeskImport } from "./sevdesk.ts";
import { legacyDunningsFor } from "./mahnungen-archiv.ts";
import { customTaxSetId, legacyTaxSetFields, vatFieldsOf } from "./sevdesk-steuerarten.ts";
import { ohneBelegGrund, ohneDateiBestaetigbar } from "./ohne-datei.ts";
import {
  FILE_STATUS_LABELS,
  fileCheck,
  fileCounts,
  fileStateHistory,
  latestFileStateSql,
  legacyFileStatus,
  OPEN_FILE_STATUSES,
  recordFileState,
} from "./dateistand.ts";

export class LexofficeError extends UserError {}

/** Für Tests austauschbar: baut den API-Client */
let clientFactory = (options: LexofficeClientOptions) => new LexofficeClient({ baseUrl: env().LEXOFFICE_API_URL || undefined, ...options });

export function setLexofficeClientFactory(factory: (options: LexofficeClientOptions) => LexofficeClient) {
  clientFactory = factory;
}

const SALES_TYPES = ["invoice", "creditnote", "downpaymentinvoice"] as const;
const BOOKKEEPING_TYPES = ["salesinvoice", "salescreditnote", "purchaseinvoice", "purchasecreditnote"] as const;
type SalesType = (typeof SALES_TYPES)[number];

function isSalesType(type: string): type is SalesType {
  return (SALES_TYPES as readonly string[]).includes(type);
}

/** Läuft ein Abruf länger als so lange ohne Fortschritt, gilt er als abgebrochen (Neustart des Servers). */
export const STALE_MS = 3 * 60 * 1000;

export function progressMessage(error: unknown): string {
  const message = userMessage(error);
  if (message === undefined) console.error("Lexoffice-Abruf", error);
  return message ?? INTERNAL_ERROR;
}

async function apiKey(): Promise<string | null> {
  const [row] = await db.select().from(schema.lexofficeConnection).where(eq(schema.lexofficeConnection.id, 1));
  return row ? decrypt(row.ciphertext).toString("utf8") : null;
}

export async function connectionStatus() {
  const [row] = await db
    .select({ organizationName: schema.lexofficeConnection.organizationName, createdAt: schema.lexofficeConnection.createdAt })
    .from(schema.lexofficeConnection)
    .where(eq(schema.lexofficeConnection.id, 1));
  return row ?? null;
}

/** Prüft den Schlüssel gegen /profile und speichert ihn verschlüsselt. */
export async function saveApiKey(actor: string, key: string): Promise<{ organizationName: string }> {
  const trimmed = key.trim();
  if (trimmed.length < 20) throw new LexofficeError("Der API-Schlüssel ist zu kurz.");
  let organizationName: string;
  try {
    const profile = await clientFactory({ apiKey: trimmed }).profile();
    organizationName = profile.companyName ?? "";
  } catch (error) {
    throw new LexofficeError(`Lexware Office lehnt den Schlüssel ab: ${progressMessage(error)}`);
  }
  await withActor(actor, async (tx) => {
    await tx.delete(schema.lexofficeConnection).where(eq(schema.lexofficeConnection.id, 1));
    await tx.insert(schema.lexofficeConnection).values({ id: 1, ciphertext: encrypt(Buffer.from(trimmed, "utf8")), organizationName });
  });
  return { organizationName };
}

export async function removeApiKey(actor: string) {
  await withActor(actor, (tx) => tx.delete(schema.lexofficeConnection).where(eq(schema.lexofficeConnection.id, 1)));
}

/** Letzter Abruf; ein hängengebliebener Lauf (Server neu gestartet) wird als abgebrochen markiert. */
export async function latestImport() {
  const [row] = await db
    .select()
    .from(schema.lexofficeImports)
    .where(eq(schema.lexofficeImports.source, "lexoffice"))
    .orderBy(desc(schema.lexofficeImports.startedAt))
    .limit(1);
  if (!row) return null;
  if (row.status === "laeuft" && !running.has(row.id) && Date.now() - row.updatedAt.getTime() > STALE_MS) {
    const [updated] = await db
      .update(schema.lexofficeImports)
      .set({ status: "abgebrochen", error: "Der Abruf wurde unterbrochen. Ein neuer Abruf setzt dort fort.", finishedAt: new Date() })
      .where(and(eq(schema.lexofficeImports.id, row.id), eq(schema.lexofficeImports.status, "laeuft")))
      .returning();
    return updated ?? row;
  }
  return row;
}

const running = new Map<string, AbortController>();

/**
 * Startet den Abruf über die Public API im Hintergrund. Schon übernommene Belege werden übersprungen, ein neuer Lauf
 * setzt also nach einem Abbruch fort. Gibt die ID des Laufs zurück; den Fortschritt liefert latestImport().
 */
export async function startImport(actor: string, options: { wait?: boolean } = {}): Promise<string> {
  const key = await apiKey();
  if (!key) throw new LexofficeError("Zuerst den API-Schlüssel hinterlegen.");
  return launchImport(actor, (signal) => clientFactory({ apiKey: key, signal }), options);
}

/**
 * Übernimmt eine Sicherung aus der Web-Oberfläche (Skript lexware-sicherung.js, für Tarife ohne Public API).
 * Derselbe Ablauf wie beim Abruf über die API: Kontakte, Belege mit Zahlungen und Dateien; Vorhandenes wird
 * übersprungen, Teile dürfen nacheinander kommen.
 */
export async function startWebImport(actor: string, parts: { name: string; bytes: Uint8Array }[], options: { wait?: boolean } = {}): Promise<string> {
  const source = webExportSource(readWebExport(parts));
  return launchImport(actor, () => source, options);
}

async function launchImport(actor: string, sourceFor: (signal: AbortSignal) => LexofficeSource, options: { wait?: boolean }): Promise<string> {
  const current = await latestImport();
  if (current?.status === "laeuft") throw new LexofficeError("Ein Abruf läuft bereits.");
  // Der eindeutige Index gilt für beide Quellen: auch einen verwaisten sevDesk-Lauf als abgebrochen markieren
  if ((await latestSevdeskImport())?.status === "laeuft") throw new LexofficeError("Ein Abruf aus sevDesk läuft bereits.");
  if ((await latestFastbillImport())?.status === "laeuft") throw new LexofficeError("Ein Abruf aus FastBill läuft bereits.");
  const progress: LexofficeImportProgress = {
    phase: "kontakte",
    contacts: 0,
    contactsLinked: 0,
    listed: 0,
    imported: 0,
    skipped: 0,
    files: 0,
    failed: [],
  };
  const [row] = await withActor(actor, (tx) => tx.insert(schema.lexofficeImports).values({ progress }).returning({ id: schema.lexofficeImports.id })).catch(
    (error: unknown) => {
      // Gleichzeitig gestartet: der eindeutige Index lässt nur einen laufenden Abruf zu
      if (isUniqueViolation(error, "lexoffice_imports_one_running")) throw new LexofficeError("Ein Abruf läuft bereits.");
      throw error;
    },
  );
  const id = row!.id;
  const controller = new AbortController();
  running.set(id, controller);
  const source = sourceFor(controller.signal);
  const job = runImport(actor, id, source, progress, controller.signal)
    .then(() => finish(id, progress, "fertig", null))
    .catch((error: unknown) =>
      finish(id, progress, controller.signal.aborted ? "abgebrochen" : "fehler", controller.signal.aborted ? "Abgebrochen." : progressMessage(error)),
    )
    // Scheitert auch das Speichern des Abschlusses, darf das keine unbehandelte Ablehnung werden
    .catch((error: unknown) => console.error("Lexware-Office-Abruf: Abschluss nicht gespeichert", error))
    .finally(() => running.delete(id));
  if (options.wait) await job;
  return id;
}

export function cancelImport(id: string): boolean {
  const controller = running.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

export async function finish(id: string, progress: LexofficeImportProgress, status: "fertig" | "fehler" | "abgebrochen", error: string | null) {
  progress.phase = "fertig";
  await db
    .update(schema.lexofficeImports)
    .set({ status, error, progress, updatedAt: new Date(), finishedAt: new Date() })
    .where(eq(schema.lexofficeImports.id, id));
}

/**
 * Belegliste des Laufs. Entwürfe sind keine Belege; der Abruf übergeht sie und zählt ihre Zahl, damit sie nicht still
 * verschwindet (#1504). Vorgänge ohne Belegart kommen über die API gar nicht erst in die Liste — die Sicherung aus der
 * Web-Oberfläche lässt sie schon beim Packen draußen (#183), deshalb gibt es dafür keinen Zähler.
 */
async function sammleBelegliste(
  client: LexofficeSource,
  progress: LexofficeImportProgress,
  save: (force?: boolean) => Promise<void>,
): Promise<{ id: string; type: string; number: string }[]> {
  const listed: { id: string; type: string; number: string }[] = [];
  let drafts = 0;
  for await (const item of client.voucherList([...SALES_TYPES, ...BOOKKEEPING_TYPES])) {
    if (item.voucherStatus === "draft") {
      drafts += 1;
      continue;
    }
    listed.push({ id: item.id, type: item.voucherType, number: item.voucherNumber ?? "" });
    progress.listed = listed.length;
    await save();
  }
  progress.ignored = drafts > 0 ? { drafts } : undefined;
  await save(true);
  return listed;
}

async function runImport(actor: string, importId: string, client: LexofficeSource, progress: LexofficeImportProgress, signal: AbortSignal) {
  let lastSave = 0;
  const save = async (force = false) => {
    if (!force && Date.now() - lastSave < 1000) return;
    lastSave = Date.now();
    await db.update(schema.lexofficeImports).set({ progress, updatedAt: new Date() }).where(eq(schema.lexofficeImports.id, importId));
  };

  // 1. Kontakte: vorhandene über die Lexoffice-ID überspringen, gleichnamige ohne ID verknüpfen
  for await (const raw of client.contacts()) {
    // Die Sicherung aus der Web-Oberfläche liest ohne Netz und kennt das Signal nicht: selbst prüfen
    signal.throwIfAborted();
    const contact = mapContact(raw);
    await withActor(actor, async (tx) => {
      const [known] = await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.lexofficeId, contact.lexofficeId));
      if (known) return;
      const [sameName] = await tx
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(and(isNull(schema.contacts.lexofficeId), sql`lower(${schema.contacts.name}) = lower(${contact.name})`))
        .limit(1);
      if (sameName) {
        // Rollen nur ergänzen: Lieferant in Lexoffice wird auch hier Lieferant, die Kundenrolle bleibt
        await tx
          .update(schema.contacts)
          .set({
            lexofficeId: contact.lexofficeId,
            ...(contact.isVendor
              ? { isSupplier: true, lieferantennummer: sql`coalesce(${schema.contacts.lieferantennummer}, ${contact.lieferantennummer})` }
              : {}),
          })
          .where(eq(schema.contacts.id, sameName.id));
        progress.contactsLinked += 1;
        return;
      }
      await tx.insert(schema.contacts).values({
        lexofficeId: contact.lexofficeId,
        kundennummer: contact.kundennummer,
        // Ohne Rolle in Lexoffice gilt der Kontakt wie bisher als Kunde
        isCustomer: contact.isCustomer || !contact.isVendor,
        isSupplier: contact.isVendor,
        lieferantennummer: contact.lieferantennummer,
        name: contact.name,
        strasse: contact.strasse,
        plz: contact.plz,
        ort: contact.ort,
        land: contact.land,
        email: contact.email,
        ustId: contact.ustId,
        archivedAt: contact.archived ? new Date() : null,
      });
      progress.contacts += 1;
    });
    await save();
  }

  // 2. Belegliste; Entwürfe sind keine Belege und bleiben draußen
  progress.phase = "liste";
  await save(true);
  const categories = new Map((await client.postingCategories()).map((c) => [c.id, c.name]));
  const listed = await sammleBelegliste(client, progress, save);
  const done = new Set((await db.select({ id: schema.lexofficeVouchers.lexofficeId }).from(schema.lexofficeVouchers)).map((r) => r.id));
  // Belege mit fehlender Datei sind nicht abgeschlossen; eine spätere Sicherung kann die Datei enthalten (#1504)
  const nachzuladen = await offeneDateien();

  // 3. Je Beleg Details, Zahlungen und Dateien; Fehler einzelner Belege halten den Lauf nicht auf
  progress.phase = "belege";
  await save(true);
  for (const item of listed) {
    signal.throwIfAborted();
    if (done.has(item.id)) {
      const offen = nachzuladen.get(item.id);
      if (!offen) {
        progress.skipped += 1;
        continue;
      }
      try {
        if (await nachladenDateien(actor, importId, client, item, offen)) progress.nachgeladen = (progress.nachgeladen ?? 0) + 1;
      } catch (error) {
        if (error instanceof LexofficeApiError && (error.status === 401 || error.status === 403)) throw error;
        if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
        progress.failed.push({ lexofficeId: item.id, number: offen[0]!.number, message: progressMessage(error) });
      }
      await save();
      continue;
    }
    try {
      // false: ein gleichzeitiger Lauf hat den Beleg schon übernommen
      if (await importVoucher(actor, importId, client, item, categories, progress)) progress.imported += 1;
      else progress.skipped += 1;
    } catch (error) {
      // Schlüssel ungültig, Tarif gewechselt oder abgebrochen: weitermachen ist sinnlos
      if (error instanceof LexofficeApiError && (error.status === 401 || error.status === 403)) throw error;
      // Abgebrochen: der Client meldet das als eigenen Fehler, nicht als AbortError
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      progress.failed.push({ lexofficeId: item.id, number: item.number, message: progressMessage(error) });
    }
    await save();
  }
  await save(true);
}

type DateiEintrag = { role: "pdf" | "xml" | "anhang"; lexofficeFileId: string | null; file: LexFile };
type OffeneDatei = { voucherId: string; number: string; type: string; role: "pdf" | "xml" | "anhang"; fileId: string | null };

/**
 * Belege mit einer offenen Datei, je Datei der jüngste Stand. Der Stand nennt Rolle und Kennung in der Quelle; offen ist
 * eine Datei, solange kein späterer Stand genau diese Rolle und Kennung ablöst. Offen sind beide Stände: ein
 * fehlgeschlagener Abruf (`abruf_fehlgeschlagen`) und ein fehlender Anhang (`anhang_fehlt`, etwa das XML einer
 * E-Rechnung). Ein späterer Lauf holt deshalb jede offene Datei nach und nicht nur eine je Beleg (#1504, #1624). PDF und
 * XML der Rechnung tragen keine Kennung; sie kommen nur mit dem Beleg selbst und stehen deshalb mit leerer Kennung da.
 */
async function offeneDateien(): Promise<Map<string, OffeneDatei[]>> {
  const rows = await db
    .selectDistinctOn([schema.legacyFileStates.voucherId, schema.legacyFileStates.role, schema.legacyFileStates.sourceFileId], {
      lexofficeId: schema.lexofficeVouchers.lexofficeId,
      number: schema.lexofficeVouchers.number,
      type: schema.lexofficeVouchers.type,
      voucherId: schema.legacyFileStates.voucherId,
      role: schema.legacyFileStates.role,
      fileId: schema.legacyFileStates.sourceFileId,
      state: schema.legacyFileStates.state,
    })
    .from(schema.legacyFileStates)
    .innerJoin(schema.lexofficeVouchers, eq(schema.lexofficeVouchers.id, schema.legacyFileStates.voucherId))
    .where(eq(schema.lexofficeVouchers.source, "lexoffice"))
    .orderBy(
      schema.legacyFileStates.voucherId,
      schema.legacyFileStates.role,
      schema.legacyFileStates.sourceFileId,
      desc(schema.legacyFileStates.createdAt),
      desc(schema.legacyFileStates.id),
    );
  const out = new Map<string, OffeneDatei[]>();
  for (const row of rows) {
    if ((row.state !== "abruf_fehlgeschlagen" && row.state !== "anhang_fehlt") || !row.role) continue;
    const liste = out.get(row.lexofficeId) ?? [];
    liste.push({ voucherId: row.voucherId, number: row.number, type: row.type, role: row.role, fileId: row.fileId });
    out.set(row.lexofficeId, liste);
  }
  return out;
}

/** Holt die offenen Dateien eines früheren Belegs nach; true, wenn mindestens eine ankam */
async function nachladenDateien(
  actor: string,
  importId: string,
  client: LexofficeSource,
  item: { id: string; type: string },
  offen: OffeneDatei[],
): Promise<boolean> {
  // Das PDF und ein XML der Rechnung hängen nicht an einer Kennung; sie kommen über den Beleg selbst
  const salesType = isSalesType(item.type) ? item.type : null;
  const anfragen: (readonly ["pdf" | "xml" | "anhang", string | null, () => Promise<LexFile | null>])[] = [];
  for (const eintrag of offen) {
    if (eintrag.role === "anhang") {
      const fileId = eintrag.fileId;
      if (fileId !== null) anfragen.push(["anhang", fileId, () => client.file(fileId)]);
      continue;
    }
    if (salesType === null) continue;
    const role = eintrag.role;
    anfragen.push([role, null, () => (role === "pdf" ? client.salesDocumentPdf(salesType, item.id) : client.salesDocumentXml(salesType, item.id))]);
  }
  if (anfragen.length === 0) return false;
  const files: DateiEintrag[] = [];
  const weiterhin: FehlendeDatei[] = [];
  const ohneAnhang: ("pdf" | "xml" | "anhang")[] = [];
  await ladeDateien(files, weiterhin, anfragen, ohneAnhang);
  if (files.length === 0 && ohneAnhang.length === 0) return false;
  const voucherId = offen[0]!.voucherId;
  const number = offen[0]!.number || item.id;
  await withActor(actor, async (tx) => {
    if (files.length > 0)
      await attachVoucherFiles(
        tx,
        voucherId,
        files.map((entry) => ({
          role: entry.role,
          sourceFileId: entry.lexofficeFileId,
          filename: entry.file.filename ?? fallbackName({ number, lexofficeId: item.id }, entry.role, entry.file.bytes),
          mimeType: entry.file.mimeType,
          bytes: entry.file.bytes,
        })),
      );
    // Ein Stand je Datei mit Rolle und Kennung: er löst genau diese Datei und trägt den Zeitpunkt für „(nachgeladen)“ (#1624)
    for (const entry of files)
      await recordFileState(
        tx,
        voucherId,
        { state: "nachgeladen", role: entry.role, sourceFileId: entry.lexofficeFileId, message: "Datei aus einer späteren Sicherung nachgeladen." },
        { actor, importId },
      );
    // Die Quelle nennt ohne Fehler kein XML: nichts mehr offen, auch wenn nichts ankam. Sonst bliebe die Rechnung für
    // immer gesperrt, weil jeder weitere Lauf dasselbe „kein XML“ hört (#1624)
    if (ohneAnhang.length > 0)
      await recordFileState(
        tx,
        voucherId,
        { state: "kein_anhang", role: "xml", sourceFileId: null, message: "Die Quelle nennt keine E-Rechnung." },
        { actor, importId },
      );
  });
  // Was weiterhin fehlt, wird danach in einem eigenen Schritt vermerkt: mit dem jüngeren Zeitstempel bleibt der Beleg
  // offen, auch wenn eine der Dateien ankam (#1624)
  if (weiterhin.length > 0) await withActor(actor, (tx) => vermerkeFehlendeDateien(tx, voucherId, weiterhin, { actor, importId }));
  return files.length > 0;
}
/** Eine Datei, die der Beleg führt und die nicht kommt; sie wird am Beleg vermerkt, nicht als Grund, ihn wegzulassen (#1504) */
type FehlendeDatei = { role: "pdf" | "xml" | "anhang"; fileId: string | null; message: string };

/**
 * Holt die Dateien eines Belegs einzeln. Was nicht kommt, landet in `missing`; nur ein ungültiger Schlüssel und ein
 * Abbruch gelten für den ganzen Lauf und werden weitergereicht. Antwortet die Quelle für das XML der E-Rechnung ohne
 * Fehler „gibt es nicht“, landet die Rolle in `ohneAnhang`: das ist eine Auskunft und keine Lücke (#1624).
 */
async function ladeDateien(
  files: DateiEintrag[],
  missing: FehlendeDatei[],
  anfragen: readonly (readonly ["pdf" | "xml" | "anhang", string | null, () => Promise<LexFile | null>])[],
  ohneAnhang: ("pdf" | "xml" | "anhang")[] = [],
): Promise<void> {
  for (const [role, fileId, laden] of anfragen) {
    try {
      const file = await laden();
      if (file) files.push({ role, lexofficeFileId: fileId, file });
      // Eine Rechnung ohne E-Rechnung (406): nichts, was ein weiterer Abruf je nachholen könnte
      else if (role === "xml") ohneAnhang.push(role);
    } catch (error) {
      // Ungültiger Schlüssel und Abbruch gelten für den ganzen Lauf; den Abbruch meldet der Client mit Status 0
      if (error instanceof LexofficeApiError && [0, 401, 403].includes(error.status)) throw error;
      if (error instanceof Error && error.name === "AbortError") throw error;
      missing.push({ role, fileId, message: progressMessage(error) });
    }
  }
}

/**
 * Der Beleg steht, die Datei fehlt: offener Punkt am Beleg statt stillem Verlust. Fehlt die Hauptdatei (PDF bzw. der
 * Anhang eines Buchhaltungsbelegs), nennt die Quelle sie und sie kommt nicht — genau der Stand „Abruf fehlgeschlagen“.
 * Fehlt dagegen das XML einer E-Rechnung neben dem PDF, ist das Original unvollständig, aber der Beleg ist da: derselbe
 * Stand wie bei sevDesk, `anhang_fehlt` mit Rolle `xml` (#345). Bestätigen lässt sich keiner davon, „ohne Beleg“ trägt
 * der Beleg nicht (#1318, #1504).
 */
async function vermerkeFehlendeDateien(tx: Tx, voucherId: string, missing: FehlendeDatei[], by: { actor: string; importId: string }): Promise<void> {
  for (const entry of missing) {
    const xml = entry.role === "xml";
    await recordFileState(
      tx,
      voucherId,
      {
        state: xml ? "anhang_fehlt" : "abruf_fehlgeschlagen",
        role: entry.role,
        sourceFileId: entry.fileId,
        message: `${xml ? "XML der E-Rechnung fehlt in der Sicherung oder kam nicht" : "Datei fehlt in der Sicherung oder kam nicht"}: ${entry.message}`.slice(
          0,
          500,
        ),
      },
      by,
    );
  }
}

async function importVoucher(
  actor: string,
  importId: string,
  client: LexofficeSource,
  item: { id: string; type: string },
  categories: Map<string, string>,
  progress: LexofficeImportProgress,
): Promise<boolean> {
  let voucher: LegacyVoucher;
  let raw: unknown;
  const files: DateiEintrag[] = [];
  const missing: FehlendeDatei[] = [];
  if (isSalesType(item.type)) {
    // Als eigene Konstante, sonst verliert TypeScript die Verengung in den Pfeilfunktionen der Helfer
    const type = item.type;
    raw = await client.salesDocument(type, item.id);
    voucher = mapSalesDocument(type, raw as Parameters<typeof mapSalesDocument>[1], item.id);
    await ladeDateien(files, missing, [
      ["pdf", null, () => client.salesDocumentPdf(type, item.id)],
      ["xml", null, () => client.salesDocumentXml(type, item.id)],
    ]);
  } else {
    raw = await client.voucher(item.id);
    voucher = mapVoucher(raw as Parameters<typeof mapVoucher>[0], item.id);
    await ladeDateien(
      files,
      missing,
      voucher.fileIds.map((fileId) => ["anhang", fileId, () => client.file(fileId)] as const),
    );
  }
  const payments = await client.payments(item.id);

  return withActor(actor, async (tx) => {
    const [contact] = voucher.contactLexofficeId
      ? await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.lexofficeId, voucher.contactLexofficeId))
      : [];
    const row = await storeLegacyVoucher(
      tx,
      {
        lexofficeId: voucher.lexofficeId,
        importId,
        type: voucher.type,
        direction: voucher.direction,
        number: voucher.number,
        date: voucher.date,
        dueDate: voucher.dueDate,
        serviceFrom: voucher.serviceFrom,
        serviceTo: voucher.serviceTo,
        status: voucher.status,
        contactId: contact?.id ?? null,
        contactName: voucher.contactName,
        currency: voucher.currency,
        net: voucher.net,
        tax: voucher.tax,
        gross: voucher.gross,
        taxes: voucher.taxes,
        categories: voucher.categories.map((c) => ({ ...c, name: categories.get(c.categoryId) ?? "" })),
        payment: payments ? mapPayments(payments) : null,
        remark: voucher.remark,
        raw: raw as Record<string, unknown>,
      },
      files.map((entry) => ({
        role: entry.role,
        sourceFileId: entry.lexofficeFileId,
        filename: entry.file.filename ?? fallbackName(voucher, entry.role, entry.file.bytes),
        mimeType: entry.file.mimeType,
        bytes: entry.file.bytes,
      })),
    );
    if (!row) return false;
    progress.files += row.files;
    await vermerkeFehlendeDateien(tx, row.id, missing, { actor, importId });
    return true;
  });
}

export function fallbackName(voucher: Pick<LegacyVoucher, "number" | "lexofficeId">, role: "pdf" | "xml" | "anhang", bytes: Uint8Array): string {
  const base = (voucher.number || voucher.lexofficeId).replace(/[^\w.-]+/g, "_");
  const kind = sniff(bytes)?.kind;
  const extension = role === "xml" ? "xml" : kind === "jpeg" ? "jpg" : (kind ?? "pdf");
  return `${base}.${extension}`;
}

// ---------------------------------------------------------------------------------------------
// Archiv: Übersicht und Abgleich

export async function listLegacyVouchers(filter: { year: number; direction: "alle" | "einnahme" | "ausgabe"; search: string; ohneDatei: boolean }) {
  const term = filter.search.trim() ? `%${filter.search.trim()}%` : null;
  const rows = await db.execute<{
    id: string;
    source: LegacySource;
    type: string;
    direction: "einnahme" | "ausgabe";
    number: string;
    date: string;
    status: string;
    contact_name: string;
    net: number;
    tax: number;
    gross: number;
    files: number;
    file_state: LegacyFileState | null;
    ohne_beleg: boolean;
    accounting_type_unclear: boolean;
  }>(sql`
    select v.id, v.source, ${effectiveType("v")} as type, ${effectiveDirection("v")} as direction, v.number, v.date::text as date, v.status, ${effectiveContactName("v")} as contact_name, ${effectiveAmount("v", "net")} as net, ${effectiveAmount("v", "tax")} as tax, ${effectiveAmount("v", "gross")} as gross,
      (select count(*)::int from lexoffice_voucher_files f where f.voucher_id = v.id) as files, ${latestFileStateSql("v")} as file_state,
      coalesce((v.raw->>'ohneBeleg')::boolean, false) as ohne_beleg, ${accountingTypeUnclear("v")} as accounting_type_unclear
    from lexoffice_vouchers v
    where v.date between ${`${filter.year}-01-01`} and ${`${filter.year}-12-31`}
      ${filter.direction === "alle" ? sql`` : sql`and ${effectiveDirection("v")} = ${filter.direction}`}
      ${term ? sql`and (v.number ilike ${term} or ${effectiveContactName("v")} ilike ${term} or v.remark ilike ${term})` : sql``}
      ${
        // Vorauswahl vor dem Limit; welcher Stand offen ist, entscheidet legacyFileStatus unten
        filter.ohneDatei
          ? sql`and not coalesce((v.raw->>'ohneBeleg')::boolean, false) and (not exists (select 1 from lexoffice_voucher_files f where f.voucher_id = v.id)
              or ${latestFileStateSql("v")} in ('abruf_fehlgeschlagen', 'anhang_fehlt'))`
          : sql``
      }
    order by v.date, v.number
    limit 1000`);
  // Ohne Datei: alles, was noch Arbeit braucht (#345), nicht die bestätigt dateilosen und nicht Buchungen ohne Beleg
  const status = (r: (typeof rows)[number]) => legacyFileStatus(r.file_state, Number(r.files), r.ohne_beleg);
  return [...rows]
    .filter((r) => !filter.ohneDatei || OPEN_FILE_STATUSES.has(status(r)))
    .map((r) => ({
      id: r.id,
      source: r.source,
      type: r.type,
      direction: r.direction,
      number: r.number,
      date: r.date,
      status: r.status,
      contactName: r.contact_name,
      net: Number(r.net),
      tax: Number(r.tax),
      gross: Number(r.gross),
      files: Number(r.files),
      fileStatus: status(r),
      accountingTypeUnclear: r.accounting_type_unclear,
    }));
}

export async function legacyVoucherDetail(id: string) {
  const [voucher] = await db
    .select({
      id: schema.lexofficeVouchers.id,
      lexofficeId: schema.lexofficeVouchers.lexofficeId,
      source: schema.lexofficeVouchers.source,
      sourceName: sql<string | null>`case when ${schema.lexofficeVouchers.source} = 'import' then ${schema.lexofficeVouchers.raw}->>'sourceName' else null end`,
      externalId: sql<string>`case when ${schema.lexofficeVouchers.source} = 'import' then ${schema.lexofficeVouchers.raw}->>'externalId' else ${schema.lexofficeVouchers.lexofficeId} end`,
      type: effectiveType("lexoffice_vouchers"),
      direction: effectiveDirection("lexoffice_vouchers"),
      number: schema.lexofficeVouchers.number,
      date: schema.lexofficeVouchers.date,
      dueDate: schema.lexofficeVouchers.dueDate,
      serviceFrom: schema.lexofficeVouchers.serviceFrom,
      serviceTo: schema.lexofficeVouchers.serviceTo,
      status: schema.lexofficeVouchers.status,
      contactId: schema.lexofficeVouchers.contactId,
      contactName: effectiveContactName("lexoffice_vouchers"),
      currency: schema.lexofficeVouchers.currency,
      net: effectiveAmount("lexoffice_vouchers", "net"),
      tax: effectiveAmount("lexoffice_vouchers", "tax"),
      gross: effectiveAmount("lexoffice_vouchers", "gross"),
      taxes: effectiveTaxes("lexoffice_vouchers"),
      categories: schema.lexofficeVouchers.categories,
      payment: effectivePayment("lexoffice_vouchers"),
      payDate: sql<string | null>`${schema.lexofficeVouchers.raw}->>'payDate'`,
      remark: schema.lexofficeVouchers.remark,
      createdAt: schema.lexofficeVouchers.createdAt,
      accountingType: accountingTypeKinds("lexoffice_vouchers"),
      ohneBeleg: WITHOUT_RECEIPT,
      rawGuid: sql<string | null>`${schema.lexofficeVouchers.raw}->>'guid'`,
      rawDocumentPresent: sql<boolean | null>`(${schema.lexofficeVouchers.raw}->>'documentPresent')::boolean`,
      positionAccounts: sevdeskPositionAccounts("lexoffice_vouchers"),
    })
    .from(schema.lexofficeVouchers)
    .where(eq(schema.lexofficeVouchers.id, id));
  if (!voucher) return null;
  const files = await db
    .select({
      id: schema.lexofficeVoucherFiles.id,
      role: schema.lexofficeVoucherFiles.role,
      filename: schema.lexofficeVoucherFiles.filename,
      mimeType: schema.lexofficeVoucherFiles.mimeType,
      size: schema.lexofficeVoucherFiles.size,
      sha256: schema.lexofficeVoucherFiles.sha256,
      lexofficeFileId: schema.lexofficeVoucherFiles.lexofficeFileId,
    })
    .from(schema.lexofficeVoucherFiles)
    .where(eq(schema.lexofficeVoucherFiles.voucherId, id))
    .orderBy(schema.lexofficeVoucherFiles.createdAt, schema.lexofficeVoucherFiles.id);
  // Mahnstufen der Rechnung aus der Quelle; nur Archiv, ohne Wirkung auf Betrag und Zahlungsstand
  const dunnings = voucher.direction === "einnahme" ? await legacyDunningsFor([voucher.lexofficeId]) : [];
  // Dateistand mit Verlauf (#345); bestätigen lässt sich ein Beleg mit offenem Stand „ohne Datei“, Quelle siehe ohneDateiBestaetigbar
  const fileStates = await fileStateHistory(id);
  const fileStatus = legacyFileStatus(fileStates.at(-1)?.state ?? null, files.length, voucher.ohneBeleg);
  // Offener Stand „ohne Datei“ oder eine Buchung ohne Beleg aus dem Accountable-Stapel bzw. der Lexoffice-Sicherung, wenn die Quelle es hergibt (#1235, #1318)
  const canConfirmWithoutFile =
    (fileStatus === "ohne_datei_offen" || fileStatus === "ohne_beleg") &&
    files.length === 0 &&
    ohneDateiBestaetigbar({ ...voucher, guid: voucher.rawGuid, documentPresent: voucher.rawDocumentPresent, ohneBeleg: voucher.ohneBeleg });
  const { positionAccounts, ...shown } = voucher;
  const categories = positionAccounts ? sevdeskCategories(voucher.categories, positionAccounts, await loadSevdeskAccountCategories()) : voucher.categories;
  // Frühere WISO-Importe setzten das Zahlungsdatum als Leistung, obwohl die Quelle sie nicht belegt (#565).
  // Nur lesend korrigieren; die unveränderliche Archivzeile bleibt erhalten. Quelle: https://github.com/Speicherstadt/haben/issues/565
  return {
    voucher: {
      ...shown,
      categories,
      serviceFrom: voucher.source === "wiso" ? null : voucher.serviceFrom,
      serviceTo: voucher.source === "wiso" ? null : voucher.serviceTo,
      payment: visiblePayment(voucher),
      paymentHistoryIssue: paymentHistoryIssue(voucher),
      accountingTypeIssue: accountingTypeIssue(voucher.accountingType),
      accountingTypeDecidable: accountingTypeDecidable(voucher.accountingType),
    },
    // Von einem späteren Abruf angehängt: Zeitpunkt des Stands „nachgeladen“ zu Rolle und Quell-ID der Datei
    files: files.map((f) => ({
      ...f,
      reloadedAt:
        fileStates.find((s) => s.state === "nachgeladen" && s.role === f.role && s.sourceFileId === (f.role === "anhang" ? f.lexofficeFileId : null))
          ?.createdAt ?? null,
    })),
    dunnings,
    fileState: {
      status: fileStatus,
      label: FILE_STATUS_LABELS[fileStatus],
      history: fileStates,
      canConfirmWithoutFile,
      // Merkmal aus dem Import, nicht aus dem Stand: die Rückfrage unterscheidet daran die Buchung ohne Beleg (Stapel, Sicherung) von sevDesk (#1317)
      ohneBeleg: voucher.ohneBeleg,
      // Warum keine Datei da ist, hängt an Quelle, Beleg-GUID und „Dokument Vorhanden“ (#1235, #1322)
      ohneBelegGrund: ohneBelegGrund({ source: voucher.source, guid: voucher.rawGuid, documentPresent: voucher.rawDocumentPresent }),
    },
  };
}

export async function legacyVoucherFile(fileId: string) {
  const [file] = await db.select().from(schema.lexofficeVoucherFiles).where(eq(schema.lexofficeVoucherFiles.id, fileId));
  return file ?? null;
}

/**
 * Zahlungen, die bei Ist-Versteuerung als Entgelt zählen, mit dem Vorzeichen des Belegs (Gutschriften mindern die Umsätze).
 * Eine Zuordnung über 0 € ist keine Zahlung (#472).
 */
function legacyPayments(v: { source: LegacySource; gross: number; status: string; payment: LegacyPayment | null }) {
  if (paymentHistoryIssue(v)) return [];
  return (v.payment?.items ?? [])
    .filter((p) => LEGACY_PAYMENT_TYPES.has(p.type) && p.date && p.amount !== 0)
    .map((p) => ({ date: p.date, amount: Math.sign(v.gross) * Math.abs(p.amount) }));
}

const TAX_TYPE = sql<string | null>`${taxTypeOf("lexoffice_vouchers")}`;
const TAX_SUB_TYPE = sql<string | null>`lexoffice_vouchers.raw->'taxConditions'->>'taxSubType'`;

/** Buchung ohne Beleg aus der Sicherung der Web-Oberfläche: hat keine Datei und braucht keine */
const WITHOUT_RECEIPT = sql<boolean>`coalesce((lexoffice_vouchers.raw->>'ohneBeleg')::boolean, false)`;

/** Weder Einnahme noch Ausgabe? Zur Laufzeit aus Kategorien und Rechtsform (legacyNeutralKind); die Rohdaten sind gesperrt */
function neutralKindOf(v: { privat: boolean; categories: LegacyCategoryRow[]; tax: number }, rechtsform: Rechtsform): LegacyNeutralKind | null {
  return legacyNeutralKind({ privat: v.privat, categories: v.categories.map((c) => c.name), tax: Number(v.tax) }, rechtsform);
}

/** Belege nur als Archiv (Suche, Datei): Summen und Umsatzsteuer ihrer Jahre kommen aus dem DATEV-Buchungsstapel */
const ARCHIVE_ONLY_SOURCES = new Set<LegacySource>(["buchhaltungsbutler", "sevdesk-export"]);

export type ReconciliationCheck = { ok: boolean; label: string; detail: string };

/** Abgleich je Geschäftsjahr: Was liegt vor, was fehlt noch vor der Kündigung? */
export async function reconciliation() {
  const company = await loadCompany();
  const versteuerung: Versteuerung = company.versteuerung;

  // Die geschätzten Kosten wachsen mit dem Quadrat der Belege; mit JIT dauerte schon das Kompilieren Sekunden (ohne-jit.ts)
  const voucherRows = await ohneJit((tx) =>
    tx
      .select({
        source: schema.lexofficeVouchers.source,
        lexofficeId: schema.lexofficeVouchers.lexofficeId,
        direction: effectiveDirection("lexoffice_vouchers"),
        type: effectiveType("lexoffice_vouchers"),
        number: schema.lexofficeVouchers.number,
        date: schema.lexofficeVouchers.date,
        status: schema.lexofficeVouchers.status,
        net: effectiveAmount("lexoffice_vouchers", "net"),
        tax: effectiveAmount("lexoffice_vouchers", "tax"),
        gross: effectiveAmount("lexoffice_vouchers", "gross"),
        taxes: effectiveTaxes("lexoffice_vouchers"),
        categories: schema.lexofficeVouchers.categories,
        payment: effectivePayment("lexoffice_vouchers"),
        payDate: sql<string | null>`lexoffice_vouchers.raw->>'payDate'`,
        taxType: TAX_TYPE,
        taxSubType: TAX_SUB_TYPE,
        taxSetId: customTaxSetId("lexoffice_vouchers"),
        ohneBeleg: WITHOUT_RECEIPT,
        fileState: latestFileStateSql("lexoffice_vouchers"),
        ohneBelegbild: sql<boolean>`coalesce((lexoffice_vouchers.raw->>'ohneBelegbild')::boolean, false)`,
        privat: sql<boolean>`coalesce((lexoffice_vouchers.raw->>'privat')::boolean, false)`,
        bbNeutral: sql<boolean>`coalesce((lexoffice_vouchers.raw->>'neutral')::boolean, false)`,
        accountingTypeUnclear: accountingTypeUnclear("lexoffice_vouchers"),
        positionAccounts: sevdeskPositionAccounts("lexoffice_vouchers"),
        // Spalte ausdrücklich qualifizieren: drizzle schreibt sonst nur "id", und das träfe f.id
        files: sql<number>`(select count(*)::int from lexoffice_voucher_files f where f.voucher_id = lexoffice_vouchers.id)`,
      })
      .from(schema.lexofficeVouchers),
  );
  // Archiviert, aber weder Einnahme noch Ausgabe: im Einzelunternehmen Privates und Geldtransit, in GmbH und UG
  // Gesellschafter, Kapital, Darlehen und Steuern vom Einkommen; sie stehen je Jahr getrennt (neutral)
  const known = await loadSevdeskAccountCategories();
  const classified = voucherRows.map((v) => {
    const categories = sevdeskCategories(v.categories, v.positionAccounts, known);
    return { ...v, categories, neutral: neutralKindOf({ ...v, categories }, company.rechtsform) ?? (v.bbNeutral ? ("geldtransit" as const) : null) };
  });
  // BuchhaltungsButler-Belege nur als Archiv (Suche, PDF): Einnahme, Ausgabe oder neutral ließe sich aus den Konten nur
  // schätzen. Summen und Steuer kommen für diese Jahre aus dem DATEV-Buchungsstapel desselben Exports. Ebenso die Belege aus
  // der Export-ZIP von sevDesk: Darlehen, Privates, Steuern und Zinsen stehen dort als Beleg ohne Kategorie (#1105).
  const figures = classified.filter((v) => !ARCHIVE_ONLY_SOURCES.has(v.source));
  const businessRows = figures.filter((v) => !v.neutral);
  // Ohne Einzelzahlungen können selbst bereits vollständig bezahlte sevDesk-Rechnungen mehrere Monate betreffen.
  // Gesperrt ist jedes Jahr, in das eine solche Zahlung fallen kann: bis zum Ausgleich, ohne Ausgleichsdatum alle.
  const paymentIssueOf = (year: number) => {
    if (versteuerung !== "ist") return null;
    if (businessRows.some((v) => v.direction === "einnahme" && unclearFrom(v, String(year)))) {
      return "sevDesk-Zahlungshistorie unvollständig: Der Ist-Monatsabgleich ist bis zur Klärung der Einzelzahlungen gesperrt.";
    }
    return null;
  };
  const unclearAccountsIn = (year: number) => unclearAccountingTypes(businessRows, year, (v) => (versteuerung === "ist" ? legacyPayments(v) : []));
  const exportIstIssueOf = (year: number) => sevdeskExportIstIssue(versteuerung, classified, year);
  const vatIssueOf = (year: number) =>
    [paymentIssueOf(year), unclearAccountsIn(year) ? ACCOUNTING_TYPE_VAT_ISSUE : null, exportIstIssueOf(year)].filter(Boolean).join(" ") || null;

  const bookingRows = await datevBookingCounts(company.kontenrahmen);
  const files = await db.select({ kind: schema.archiveFiles.kind, year: schema.archiveFiles.year }).from(schema.archiveFiles);
  // Protokolle der aus sevDesk übernommenen Voranmeldungen zählen wie abgelegte ELSTER-Protokolle (#472)
  const vatProtocols = await db
    .select({ year: schema.legacyVatReports.year })
    .from(schema.legacyVatReportFiles)
    .innerJoin(schema.legacyVatReports, eq(schema.legacyVatReportFiles.vatReportId, schema.legacyVatReports.id));
  const lastImport = await latestImport();
  // Eigene Steuerarten aus sevDesk: Kennzahlen aus dem jüngsten Abruf, auch für früher abgerufene Belege
  const taxSets = await legacyTaxSetFields();
  // Für Jahre ohne Belege per API (Umzug nur über DATEV): Summen aus dem Buchungsstapel
  const datevRows = await db
    .select({
      date: schema.datevBookings.date,
      amount: schema.datevBookings.amount,
      side: schema.datevBookings.side,
      account: schema.datevBookings.account,
      contraAccount: schema.datevBookings.contraAccount,
      buKey: schema.datevBookings.buKey,
      accountLength: sql<number | null>`(${schema.archiveFiles.meta} -> 'header' ->> 'accountLength')::int`,
      fileId: schema.datevBookings.fileId,
    })
    .from(schema.datevBookings)
    .leftJoin(schema.archiveFiles, eq(schema.archiveFiles.id, schema.datevBookings.fileId));

  // DATEV-Stapel der BuchhaltungsButler-Importe, auch wenn die Datei schon vorher im Archiv lag
  const bbImports = await db
    .select({ progress: schema.lexofficeImports.progress })
    .from(schema.lexofficeImports)
    .where(eq(schema.lexofficeImports.source, "buchhaltungsbutler"));
  const bbFileIds = new Set(bbImports.flatMap((i) => i.progress.datevFileIds ?? []));
  // Ebenso die Stapel aus der Export-ZIP von sevDesk; in Jahren mit Belegen aus der API zählen diese (keine Doppelung)
  const sevExportImports = await db
    .select({ progress: schema.lexofficeImports.progress })
    .from(schema.lexofficeImports)
    .where(eq(schema.lexofficeImports.source, "sevdesk-export"));
  const sevExportFileIds = new Set(sevExportImports.flatMap((i) => i.progress.sevdeskExport?.stackFileIds ?? []));

  // Ausgaben aus FastBill, die noch auf ihren Beleg warten, liegen nicht in lexoffice_vouchers: sonst sähe ein Jahr vollständig aus
  const fastbillWaiting = await fastbillWaitingByYear();
  const fastbillPartlyCanceled = await fastbillPartlyCanceledByYear();
  const years = new Set<number>(fastbillWaiting.keys());
  for (const v of voucherRows) years.add(Number(v.date.slice(0, 4)));
  for (const year of bookingRows.keys()) years.add(year);
  for (const f of files) if (f.year) years.add(f.year);
  // Jahre mit aus sevDesk übernommenen Voranmeldungen, auch ohne Belege und ohne Protokoll (#472)
  for (const r of await db.selectDistinct({ year: schema.legacyVatReports.year }).from(schema.legacyVatReports)) years.add(r.year);

  const result = [...years]
    .sort((a, b) => b - a)
    .map((year) => {
      const vouchers = businessRows.filter((v) => v.date.startsWith(`${year}-`));
      // Alle Belege des Jahres, auch neutrale: Auch ein Körperschaftsteuerbescheid braucht seine Datei
      const yearRows = classified.filter((v) => v.date.startsWith(`${year}-`));
      const withoutReceipt = voucherRows.filter((v) => v.ohneBeleg && v.date.startsWith(`${year}-`)).length;
      const yearDatev = datevRows.filter((b) => b.date.startsWith(`${year}-`));
      // Accountable legt in den Belegen nur Ausgaben ab; die Erlöse stehen ausschließlich im
      // Buchungsstapel. Ohne diese Ausnahme blieben die Einnahmen bei 0, obwohl die Buchung da ist.
      const yearEinnahmeBelege = vouchers.some((v) => v.direction === "einnahme" && v.date.startsWith(`${year}-`));
      const fromDatev = (vouchers.length === 0 || !yearEinnahmeBelege) && yearDatev.length > 0 ? datevYearSums(yearDatev, company.kontenrahmen) : null;
      // Mischjahr (Wechsel unter dem Jahr): Belege aus Lexoffice oder sevDesk, dazu der Teil aus dem Stapel von BuchhaltungsButler
      // oder aus der Export-ZIP von sevDesk
      const sevApiYear = yearRows.some((v) => v.source === "sevdesk");
      const bbDatev = yearDatev.filter((b) => b.fileId !== null && (bbFileIds.has(b.fileId) || (!sevApiYear && sevExportFileIds.has(b.fileId))));
      const bbPart = !fromDatev && bbDatev.length > 0 ? datevYearSums(bbDatev, company.kontenrahmen) : null;
      const sum = (direction: "einnahme" | "ausgabe") => {
        const pick = (sums: NonNullable<typeof fromDatev>) => (direction === "einnahme" ? sums.einnahmen : sums.ausgaben);
        if (fromDatev) {
          const { net, tax } = pick(fromDatev);
          return { count: 0, net, tax, gross: net + tax };
        }
        const rows = vouchers.filter((v) => v.direction === direction);
        const bb = bbPart ? pick(bbPart) : { net: 0, tax: 0 };
        return {
          count: rows.length,
          net: rows.reduce((s, r) => s + r.net, 0) + bb.net,
          tax: rows.reduce((s, r) => s + r.tax, 0) + bb.tax,
          gross: rows.reduce((s, r) => s + r.gross, 0) + bb.net + bb.tax,
        };
      };
      // Dateistand (#345): bestätigt dateilose Belege zählen getrennt und blockieren nicht. Ein Exportbeleg ohne Belegbild
      // braucht keine Datei; er steht mit eigener Zahl im Abgleich (#1106)
      const fileStatuses = yearRows.filter((v) => !withoutExportImage(v)).map((v) => legacyFileStatus(v.fileState, Number(v.files), v.ohneBeleg));
      const withoutFile = fileStatuses.filter((f) => OPEN_FILE_STATUSES.has(f) && f !== "anhang_fehlt").length;
      const sevdeskExport = sevdeskExportYear(yearRows);
      const unchecked = vouchers.filter((v) => v.status === "unchecked").length;
      const bookings = bookingRows.get(year);
      const kinds = (kind: string) => files.filter((f) => f.year === year && f.kind === kind).length;
      const elster = kinds("elster") + vatProtocols.filter((p) => p.year === year).length;
      // Ist-Versteuerung: Zahlungen aus dem Zahlungsstatus; sonst Belegdatum
      const vatIssue = vatIssueOf(year);
      const vat = vatIssue
        ? []
        : legacyVatByMonth(
            businessRows
              .filter((v) => (versteuerung === "ist" ? true : v.date.startsWith(`${year}-`)))
              .map((v) => ({
                direction: v.direction,
                date: v.date,
                net: v.net,
                tax: v.tax,
                gross: v.gross,
                taxes: v.taxes,
                payments: legacyPayments(v),
                taxType: v.taxType,
                taxSubType: v.taxSubType,
                vatFields: vatFieldsOf(v.taxSetId, taxSets, v.taxType),
              })),
            versteuerung,
          ).filter((m) => m.month.startsWith(`${year}-`));
      // Einnahmen je Steuerart, damit Sonderfälle (EU, Drittland, § 13b) beim Vergleich auffallen
      const taxTypes = new Map<string, number>();
      for (const v of vouchers) {
        if (v.direction !== "einnahme") continue;
        const key = [v.taxType ?? "net", v.taxSubType].filter(Boolean).join("/");
        taxTypes.set(key, (taxTypes.get(key) ?? 0) + 1);
      }
      // Auch die Rechnungen aus BuchhaltungsButler: Der Nummernkreis läuft in Haben weiter (§ 14 Abs. 4 Satz 1 Nr. 4 UStG)
      const invoices = [...vouchers, ...yearRows.filter((v) => v.source === "buchhaltungsbutler" && !v.bbNeutral)]
        // Stornorechnung und Abschlagsrechnung von sevDesk belegen denselben Nummernkreis wie die Rechnungen (#472)
        .filter(
          (v) =>
            v.number &&
            (v.type === "invoice" ||
              (v.source === "sevdesk" && (v.type === "downpaymentinvoice" || (v.type === "creditnote" && v.lexofficeId.startsWith("invoice/"))))),
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, "de", { numeric: true }));

      // Accountable exportiert keinen IDEA-Export. Den trotzdem zu verlangen, macht "vollständig"
      // strukturell unerreichbar — der Punkt entfällt bei dieser Herkunft.
      const nurAccountable = voucherRows.length > 0 && voucherRows.every((v) => v.source === "accountable");
      const checks: ReconciliationCheck[] = [
        ...(paymentIssueOf(year) ? [{ ok: false, label: "Zahlungshistorie vollständig", detail: paymentIssueOf(year)! }] : []),
        ...(exportIstIssueOf(year) ? [SEVDESK_EXPORT_IST_CHECK] : []),
        ...accountingTypeChecks(unclearAccountsIn(year)),
        ...fastbillWaitingChecks(fastbillWaiting.get(year)),
        ...fastbillPartlyCanceledChecks(fastbillPartlyCanceled.get(year)),
        ...voucherSourceChecks({ sevdeskExport, apiVouchers: vouchers.length, yearRows, withoutReceipt }),
        fileCheck(fileStatuses),
        {
          ok: Boolean(bookings && bookings.total > 0),
          label: "DATEV-Buchungsstapel übernommen",
          detail: bookings ? `${bookings.total} Buchungen` : "fehlt",
        },
        {
          ok: Boolean(bookings) && bookings!.unmatched === 0,
          // Buchungen ohne Belegnummer (Umbuchungen, Privates) brauchen nicht immer einen Beleg; sie stehen nur im Hinweis.
          // Ein Belegfeld ohne Ziffer ist keine Nummer, sondern etwa der Name eines Zahlungsdienstleisters (#1355).
          label: "Jede Buchung mit Belegnummer findet ihren Beleg",
          detail: bookings ? bookingsCheckDetail(bookings) : "–",
        },
        ...(nurAccountable ? [] : [{ ok: kinds("idea") > 0, label: "IDEA-Export archiviert", detail: kinds("idea") > 0 ? "liegt vor" : "fehlt" }]),
        {
          ok: elster > 0,
          label: "ELSTER-Protokolle archiviert",
          detail: elster > 0 ? `${elster} Dateien` : "fehlen",
        },
        {
          ok: kinds("kontoauszug") > 0,
          label: "Kontoauszüge archiviert",
          detail: kinds("kontoauszug") > 0 ? `${kinds("kontoauszug")} Dateien` : "fehlen",
        },
      ];
      return {
        year,
        einnahmen: sum("einnahme"),
        ausgaben: sum("ausgabe"),
        /** Weder Einnahme noch Ausgabe, je Art: zum Vergleich sichtbar statt still weggelassen */
        neutral: legacyNeutralSums(
          figures.flatMap((v) => (v.neutral && v.date.startsWith(`${year}-`) ? [{ kind: v.neutral, direction: v.direction, gross: v.gross }] : [])),
        ),
        /** "datev": keine Belege per API, die Summen stammen aus dem Buchungsstapel; "gemischt": Belege und BB-Stapel */
        sumsFrom: fromDatev ? ("datev" as const) : bbPart ? ("gemischt" as const) : ("belege" as const),
        /** Belege aus der Export-ZIP von sevDesk je Zustand; null ohne solche Belege */
        sevdeskExport,
        withoutFile,
        files: fileCounts(fileStatuses),
        unchecked,
        bookings: bookings ? { total: bookings.total, unmatched: bookings.unmatched, withoutNumber: bookings.withoutNumber } : null,
        vat,
        vatIssue,
        taxTypes: [...taxTypes].map(([taxType, count]) => ({ taxType, count })).sort((a, b) => b.count - a.count),
        lastInvoiceNumber: invoices.at(-1)?.number ?? null,
        checks,
        ready: checks.every((c) => c.ok),
      };
    });
  return { versteuerung, rechtsform: company.rechtsform, years: result, lastImport };
}

// ---------------------------------------------------------------------------------------------
// Für KI-Assistenten: Belege eines Zeitraums mit allem, was in die Nachrechnung der Umsatzsteuer eingeht

export interface LegacyVoucherForVat {
  id: string;
  type: string;
  direction: "einnahme" | "ausgabe";
  number: string;
  date: string;
  status: string;
  contactName: string;
  currency: string;
  net: number;
  tax: number;
  gross: number;
  taxes: LegacyTaxRow[];
  taxType: string | null;
  taxSubType: string | null;
  /** Zahlungen, die bei Ist-Versteuerung als Entgelt zählen */
  payments: { date: string; amount: number }[];
  paymentHistoryIssue: string | null;
  accountingTypeIssue: string | null;
  files: number;
}

/**
 * Belege mit Belegdatum im Zeitraum (JJJJ oder JJJJ-MM). Mit `withPayments` auch Einnahmen, die in diesem
 * Zeitraum bezahlt wurden: Das sind bei Ist-Versteuerung die Belege, aus denen die Monatswerte stammen.
 */
export async function legacyVouchersForPeriod(filter: {
  period: string;
  direction: "alle" | "einnahme" | "ausgabe";
  search: string;
  withPayments: boolean;
  limit: number;
}): Promise<{ total: number; vouchers: LegacyVoucherForVat[]; neutral: LegacyNeutralSum[] }> {
  if (filter.withPayments) {
    // Ausdrücke über alle sevDesk-Belege: mit JIT dauerte schon das Kompilieren Sekunden (ohne-jit.ts)
    const sevdeskRows = await ohneJit((tx) =>
      tx
        .select({
          source: schema.lexofficeVouchers.source,
          direction: effectiveDirection("lexoffice_vouchers"),
          gross: effectiveAmount("lexoffice_vouchers", "gross"),
          status: schema.lexofficeVouchers.status,
          payment: effectivePayment("lexoffice_vouchers"),
          payDate: sql<string | null>`${schema.lexofficeVouchers.raw}->>'payDate'`,
        })
        .from(schema.lexofficeVouchers)
        .where(eq(schema.lexofficeVouchers.source, "sevdesk")),
    );
    // Wie der Abgleich: Bei Ist-Versteuerung zählen die Zahlungen nur auf der Einnahmenseite
    if (sevdeskRows.some((v) => v.direction === "einnahme" && unclearFrom(v, filter.period))) {
      throw new LexofficeError(
        "sevDesk-Zahlungshistorie unvollständig: Eine zahlungsbezogene Zeitraumabfrage ist bis zur Klärung der Einzelzahlungen gesperrt.",
      );
    }
  }
  const like = `${filter.period}%`;
  const term = filter.search.trim() ? `%${filter.search.trim()}%` : null;
  // Mit Zahlungen prüft die Bedingung jeden Archivbeleg mit effectivePayment; mit JIT dauerte das Kompilieren Sekunden
  const rows = await ohneJit((tx) =>
    tx.execute<{
      id: string;
      source: LegacySource;
      type: string;
      direction: "einnahme" | "ausgabe";
      number: string;
      date: string;
      status: string;
      contact_name: string;
      currency: string;
      net: number;
      tax: number;
      gross: number;
      taxes: LegacyTaxRow[];
      payment: LegacyPayment | null;
      categories: LegacyCategoryRow[];
      privat: boolean;
      tax_type: string | null;
      tax_sub_type: string | null;
      files: number;
      accounting_type: AccountingTypeKinds | null;
      position_accounts: (string | null)[] | null;
    }>(sql`
    select v.id, v.source, ${effectiveType("v")} as type, ${effectiveDirection("v")} as direction, v.number, v.date::text as date, v.status, ${effectiveContactName("v")} as contact_name, v.currency, ${effectiveAmount("v", "net")} as net, ${effectiveAmount("v", "tax")} as tax, ${effectiveAmount("v", "gross")} as gross,
      ${effectiveTaxes("v")} as taxes, ${effectivePayment("v")} as payment, v.categories, coalesce((v.raw->>'privat')::boolean, false) as privat,
      ${taxTypeOf("v")} as tax_type,
      v.raw->'taxConditions'->>'taxSubType' as tax_sub_type,
      (select count(*)::int from lexoffice_voucher_files f where f.voucher_id = v.id) as files, ${latestFileStateSql("v")} as file_state,
      coalesce((v.raw->>'ohneBeleg')::boolean, false) as ohne_beleg, ${accountingTypeKinds("v")} as accounting_type,
      ${sevdeskPositionAccounts("v")} as position_accounts
    from lexoffice_vouchers v
    where (v.date::text like ${like}
      ${
        filter.withPayments
          ? sql`or (${effectiveDirection("v")} = 'einnahme' and exists (
              select 1 from jsonb_array_elements(coalesce((${effectivePayment("v")})->'items', '[]'::jsonb)) i
              where i->>'date' like ${like} and i->>'type' in (${sql.join(
                [...LEGACY_PAYMENT_TYPES].map((t) => sql`${t}`),
                sql`, `,
              )})))`
          : sql``
      })
      -- Belege aus BuchhaltungsButler und der Export-ZIP von sevDesk gehen nicht in die Umsatzsteuer ein, wie im Abgleich (Summen aus dem DATEV-Stapel)
      and v.source not in ('buchhaltungsbutler', 'sevdesk-export')
      ${filter.direction === "alle" ? sql`` : sql`and ${effectiveDirection("v")} = ${filter.direction}`}
      ${term ? sql`and (v.number ilike ${term} or ${effectiveContactName("v")} ilike ${term} or v.remark ilike ${term})` : sql``}
    order by v.date, v.number`),
  );
  // Was weder Einnahme noch Ausgabe ist, geht nicht in die Umsatzsteuer ein, wie im Abgleich; es steht summiert daneben
  const { rechtsform } = await loadCompany();
  const known = await loadSevdeskAccountCategories();
  const classified = [...rows].map((r) => ({
    ...r,
    neutral: neutralKindOf({ ...r, categories: sevdeskCategories(r.categories, r.position_accounts, known) }, rechtsform),
  }));
  const neutral = legacyNeutralSums(classified.flatMap((r) => (r.neutral ? [{ kind: r.neutral, direction: r.direction, gross: Number(r.gross) }] : [])));
  const all = classified
    .filter((r) => !r.neutral)
    .map((r) => ({
      id: r.id,
      type: r.type,
      direction: r.direction,
      number: r.number,
      date: r.date,
      status: r.status,
      contactName: r.contact_name,
      currency: r.currency,
      net: Number(r.net),
      tax: Number(r.tax),
      gross: Number(r.gross),
      taxes: r.taxes,
      taxType: r.tax_type,
      taxSubType: r.tax_sub_type,
      payments: legacyPayments({ source: r.source, status: r.status, gross: Number(r.gross), payment: r.payment }),
      paymentHistoryIssue: paymentHistoryIssue({ source: r.source, status: r.status, gross: Number(r.gross), payment: r.payment }),
      accountingTypeIssue: accountingTypeIssue(r.accounting_type),
      files: Number(r.files),
    }));
  return { total: all.length, vouchers: all.slice(0, filter.limit), neutral };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ein Beleg mit der gespeicherten API-Antwort, gesucht nach ID in Haben, ID in Lexoffice bzw. sevDesk oder Belegnummer
 * (Leerzeichen und Groß-/Kleinschreibung egal). Bei einer Nummer können es mehrere sein.
 */
export async function findLegacyVouchers(ref: string) {
  const value = ref.trim();
  if (!value) return [];
  const rows = await db
    .select({ id: schema.lexofficeVouchers.id, raw: schema.lexofficeVouchers.raw })
    .from(schema.lexofficeVouchers)
    .where(
      // Auch eine Belegnummer kann wie eine UUID aussehen; sevDesk-Kennungen wie "invoice/101" sind keine
      sql`${schema.lexofficeVouchers.lexofficeId} = ${value}
        or lower(regexp_replace(${schema.lexofficeVouchers.number}, '\\s+', '', 'g')) = lower(regexp_replace(${value}, '\\s+', '', 'g'))
        or ${truncatedNumberMatches("lexoffice_vouchers", sql`${value}`)}
        ${UUID.test(value) ? sql`or ${schema.lexofficeVouchers.id} = ${value}::uuid` : sql``}`,
    )
    .limit(10);
  const result = [];
  for (const row of rows) {
    const detail = await legacyVoucherDetail(row.id);
    if (detail) result.push({ ...detail, raw: row.raw });
  }
  return result;
}
