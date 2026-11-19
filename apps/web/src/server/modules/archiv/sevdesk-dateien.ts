import { SevdeskApiError, sevFileExpectation, sevFileFinding, type SevdeskClient, type SevFile, type SevFileFinding } from "@haben/import";
import { sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import type { LegacyFileState, LexofficeImportProgress } from "../../db/schema.ts";
import { sha256Of, sniff, storeFile } from "../../storage.ts";
import { legacyFileStatus, recordFileState } from "./dateistand.ts";
import { progressMessage } from "./lexoffice.ts";

/*
 * Dateien der Belege aus sevDesk und ihr Dateistand (#345). Beim Übernehmen hält der Abruf fest, was fehlt: ein Beleg ohne
 * `document` (ohne Datei, offen bis zur Bestätigung), eine genannte, aber nicht gelieferte Datei oder ein fehlendes PDF einer
 * Rechnung (Abruf fehlgeschlagen) und ein fehlendes XML neben dem PDF (Anhang fehlt). Jeder spätere Abruf versucht die
 * erwarteten Dateien früher übernommener Belege erneut und hängt sie an denselben Beleg; die Archivkopie bleibt unverändert.
 * Nennt die aktuelle Belegliste eine Datei, die die Archivkopie nicht nennt (in sevDesk später hochgeladen), kommt sie als
 * zusätzliche Datei dazu, auch nach „ohne Datei bestätigt“ und neben der Datei einer Vorlage.
 */

type Kind = "invoice" | "creditnote" | "voucher";
export type SevFetchedFile = { role: "pdf" | "xml" | "anhang"; fileId: string | null; file: SevFile };

/** Abbruch und ungültiger Token beenden den Lauf; alles andere ist ein Fehler dieser Datei */
function fatal(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403))
  );
}

/**
 * Dateien eines Belegs beim ersten Übernehmen. Scheitert das PDF oder die genannte Datei mit einem Fehler (nicht 404),
 * bricht der Beleg ab wie bisher und der nächste Lauf versucht ihn erneut; ein fehlendes XML hält ihn nicht auf.
 */
export async function fetchSevdeskFiles(
  client: SevdeskClient,
  kind: Kind,
  id: string,
  raw: object,
  signal: AbortSignal,
): Promise<{ files: SevFetchedFile[]; finding: SevFileFinding | null }> {
  const expectation = sevFileExpectation(kind, raw);
  const files: SevFetchedFile[] = [];
  let xmlError: string | null = null;
  if (kind === "invoice") {
    const pdf = await client.invoicePdf(id);
    if (pdf) files.push({ role: "pdf", fileId: null, file: pdf });
    try {
      const xml = await client.invoiceXml(id);
      if (xml) files.push({ role: "xml", fileId: null, file: xml });
    } catch (error) {
      if (fatal(error, signal)) throw error;
      xmlError = progressMessage(error);
    }
  } else if (kind === "creditnote") {
    const pdf = await client.creditNotePdf(id);
    if (pdf) files.push({ role: "pdf", fileId: null, file: pdf });
  } else if (expectation.kind === "verweis") {
    const file = await client.document(expectation.documentId);
    if (file) files.push({ role: "anhang", fileId: expectation.documentId, file });
  }
  const main = files.some((f) => f.role !== "xml");
  return { files, finding: sevFileFinding(expectation, { main, xmlError }) };
}

/** Den Stand eines neu übernommenen Belegs festhalten, in derselben Transaktion */
export async function recordSevdeskFinding(tx: Tx, voucherId: string, finding: SevFileFinding | null, actor: string, importId: string) {
  if (finding) await recordFileState(tx, voucherId, finding, { actor, importId });
}

type Row = {
  id: string;
  lexofficeId: string;
  raw: { document?: unknown; origin?: unknown };
  pdf: boolean;
  xml: boolean;
  files: number;
  /** Quell-IDs der angehängten eigenen Dateien und der als nachgeladen festgehaltenen */
  ownIds: string[];
  latest: LegacyFileState | null;
  latestRole: "pdf" | "xml" | "anhang" | null;
  latestSourceFileId: string | null;
};

/**
 * Datei, die sevDesk jetzt an einem schon archivierten Beleg nennt, Haben aber noch nicht hat: in sevDesk nach dem ersten
 * Abruf hochgeladen. Die Archivkopie nennt eine andere oder keine Datei; ein Beleg mit der Datei einer Vorlage bekommt
 * seine eigene dazu. Gleich, ob „ohne Datei“ schon bestätigt war.
 */
function newOwnDocument(row: Row, listed: string | null | undefined): string | null {
  if (!listed) return null;
  const archived = sevFileExpectation("voucher", row.raw);
  if (archived.kind === "verweis" && archived.documentId === listed) return null;
  return row.ownIds.includes(listed) ? null : listed;
}

/** Archivbelege aus früheren Abrufen von sevDesk mit ihren Dateien und dem letzten Dateistand */
function earlierSevdeskVouchers(importId: string) {
  return db.execute<Row>(sql`
  select v.id, v.lexoffice_id as "lexofficeId", jsonb_build_object('document', v.raw->'document', 'origin', v.raw->'origin') as raw,
    exists (select 1 from lexoffice_voucher_files f where f.voucher_id = v.id and f.role = 'pdf') as pdf,
    exists (select 1 from lexoffice_voucher_files f where f.voucher_id = v.id and f.role = 'xml') as xml,
    (select count(*)::int from lexoffice_voucher_files f where f.voucher_id = v.id) as files,
    array(select f.lexoffice_file_id from lexoffice_voucher_files f where f.voucher_id = v.id and f.role = 'anhang' and f.lexoffice_file_id is not null
      union select n.source_file_id from legacy_file_states n where n.voucher_id = v.id and n.state = 'nachgeladen' and n.role = 'anhang'
        and n.source_file_id is not null) as "ownIds",
    s.state as latest, s.role as "latestRole", s.source_file_id as "latestSourceFileId"
  from lexoffice_vouchers v
  left join lateral (select state, role, source_file_id from legacy_file_states s where s.voucher_id = v.id order by s.created_at desc, s.id desc limit 1) s on true
  where v.source = 'sevdesk' and v.import_id <> ${importId}
  order by v.lexoffice_id`);
}

/**
 * Beleg (voucher): eine Datei, die sevDesk erst jetzt nennt, nachladen, oder einen gescheiterten Abruf einer Datei, die
 * sevDesk nicht mehr nennt, abschließen. true, wenn damit für den Beleg nichts mehr zu tun ist.
 */
async function voucherFileChanged(
  actor: string,
  importId: string,
  client: SevdeskClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
  row: Row,
  id: string,
  listedDocuments: ReadonlyMap<string, string | null>,
): Promise<boolean> {
  const own = newOwnDocument(row, listedDocuments.get(id));
  if (own) {
    const added = await loadOwnDocument(actor, importId, client, signal, row, own);
    if (added !== null) progress.sevdeskFiles!.nachgeladen += 1;
    if (added) progress.files += 1;
    return true;
  }
  // Der Abruf einer später genannten Datei scheiterte, und sevDesk nennt sie nicht mehr (entfernt oder zurück zur
  // archivierten Datei): Mit Datei am Beleg fehlt nichts mehr, ohne gilt wieder der Stand der Archivkopie
  const archived = sevFileExpectation("voucher", row.raw);
  const failed = row.latest === "abruf_fehlgeschlagen" && row.latestRole === "anhang" ? row.latestSourceFileId : null;
  if (
    listedDocuments.has(id) &&
    failed &&
    failed !== (listedDocuments.get(id) ?? null) &&
    failed !== (archived.kind === "verweis" ? archived.documentId : null)
  ) {
    if (Number(row.files) > 0) {
      await withActor(actor, (tx) =>
        recordFileState(
          tx,
          row.id,
          {
            state: "kein_anhang",
            role: "anhang",
            sourceFileId: failed,
            message: `sevDesk nennt die Datei ${failed} nicht mehr; die übrigen Dateien des Belegs bleiben.`,
          },
          { actor, importId },
        ),
      );
      return true;
    }
    if (archived.kind === "keine") {
      const finding = sevFileFinding(archived, { main: false });
      if (finding) await withActor(actor, (tx) => recordFileState(tx, row.id, finding, { actor, importId }));
      return true;
    }
  }
  return false;
}

/**
 * Früher übernommene Belege aus sevDesk: fehlende Dateien erneut abrufen, Abrufe vor #345 nachträglich einordnen. Läuft
 * nach den Dateien der Vorlagen, damit ein Beleg aus einer Vorlage mit deren Datei nicht als ohne Datei zählt.
 */
export async function checkSevdeskFiles(
  actor: string,
  importId: string,
  client: SevdeskClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
  /** sevDesk-ID je Beleg, den der aktuelle Abruf listet, mit der ID seiner Datei (`document`) oder null */
  listedDocuments: ReadonlyMap<string, string | null> = new Map(),
) {
  const counts = { ohneDatei: 0, abrufFehlgeschlagen: 0, anhangFehlt: 0, nachgeladen: 0 };
  progress.sevdeskFiles = counts;
  const rows = await earlierSevdeskVouchers(importId);
  for (const row of rows) {
    const kind = row.lexofficeId.split("/")[0] as Kind;
    if (!["invoice", "creditnote", "voucher"].includes(kind)) continue;
    const id = row.lexofficeId.slice(kind.length + 1);
    if (kind === "voucher" && (await voucherFileChanged(actor, importId, client, progress, signal, row, id, listedDocuments))) continue;
    if (row.latest === "bestaetigt_ohne_datei") continue;
    const expectation = sevFileExpectation(kind, row.raw);
    let attempt: { role: "pdf" | "xml" | "anhang"; fileId: string | null; load: () => Promise<SevFile | null> } | null = null;
    if (expectation.kind === "pdf" && !row.pdf) {
      attempt = { role: "pdf", fileId: null, load: () => (kind === "invoice" ? client.invoicePdf(id) : client.creditNotePdf(id)) };
    } else if (expectation.kind === "pdf" && kind === "invoice" && row.latest === "anhang_fehlt" && row.latestRole === "xml") {
      attempt = { role: "xml", fileId: null, load: () => client.invoiceXml(id) };
    } else if (expectation.kind === "verweis" && Number(row.files) === 0) {
      attempt = { role: "anhang", fileId: expectation.documentId, load: () => client.document(expectation.documentId) };
    }
    if (!attempt) {
      // Abruf vor #345: ein Beleg ohne document und ohne Datei bekommt seinen Stand nachträglich
      if (expectation.kind === "keine" && Number(row.files) === 0 && row.latest === null) {
        const finding = sevFileFinding(expectation, { main: false })!;
        await withActor(actor, (tx) => recordFileState(tx, row.id, finding, { actor, importId }));
      }
      continue;
    }
    let file: SevFile | null = null;
    let reason: string | null = null;
    try {
      file = await attempt.load();
    } catch (error) {
      if (fatal(error, signal)) throw error;
      reason = progressMessage(error);
    }
    if (file) {
      await withActor(actor, async (tx) => {
        await appendFile(tx, row.id, attempt.role, attempt.fileId, file, row.lexofficeId);
        await recordFileState(
          tx,
          row.id,
          { state: "nachgeladen", role: attempt.role, sourceFileId: attempt.fileId, message: "Ein späterer Abruf hat die Datei angehängt." },
          { actor, importId },
        );
      });
      progress.files += 1;
      counts.nachgeladen += 1;
      // Fehlte beim ersten Abruf auch das XML, verdeckte der Fehler beim PDF es; jetzt das XML getrennt anfragen
      if (attempt.role === "pdf" && kind === "invoice" && !row.xml && (await xmlAfterPdf(actor, importId, client, signal, row, id))) {
        progress.files += 1;
        counts.nachgeladen += 1;
      }
      continue;
    }
    // Ein XML, das sevDesk jetzt ohne Fehler nicht liefert, gibt es nicht: dann fehlt nichts mehr. Mit Fehler bleibt der Stand.
    if (attempt.role === "xml") {
      if (reason === null)
        await withActor(actor, (tx) =>
          recordFileState(
            tx,
            row.id,
            {
              state: "kein_anhang",
              role: "xml",
              sourceFileId: null,
              message: "Ein späterer Abruf fand ohne Fehler kein XML: die Rechnung ist keine E-Rechnung.",
            },
            { actor, importId },
          ),
        );
      continue;
    }
    const finding = sevFileFinding(expectation, { main: false, mainError: reason });
    if (finding) await withActor(actor, (tx) => recordFileState(tx, row.id, finding, { actor, importId }));
  }
  Object.assign(counts, await openCounts());
}

/**
 * Eigene Datei, die sevDesk erst nach dem ersten Abruf nennt, als zusätzliche Datei anhängen (Rolle „anhang“ mit Quell-ID);
 * eine Datei der Vorlage bleibt daneben. Hängen dieselben Bytes schon am Beleg, entsteht keine zweite Datei, nur der Stand.
 * Scheitert der Abruf, ist der Stand „Abruf fehlgeschlagen“ und der nächste Abruf versucht es erneut.
 * null: nicht geladen; false: geladen, Bytes hingen schon an; true: angehängt.
 */
async function loadOwnDocument(actor: string, importId: string, client: SevdeskClient, signal: AbortSignal, row: Row, documentId: string) {
  let file: SevFile | null = null;
  let reason: string | null = null;
  try {
    file = await client.document(documentId);
  } catch (error) {
    if (fatal(error, signal)) throw error;
    reason = progressMessage(error);
  }
  const loaded = file;
  if (!loaded) {
    const finding = sevFileFinding({ kind: "verweis", documentId }, { main: false, mainError: reason })!;
    await withActor(actor, (tx) => recordFileState(tx, row.id, finding, { actor, importId }));
    return null;
  }
  return withActor(actor, async (tx) => {
    const added = await appendFile(tx, row.id, "anhang", documentId, loaded, row.lexofficeId);
    await recordFileState(
      tx,
      row.id,
      {
        state: "nachgeladen",
        role: "anhang",
        sourceFileId: documentId,
        message: added
          ? "sevDesk nennt die Datei erst nach dem ersten Abruf; ein späterer Abruf hat sie angehängt."
          : "sevDesk nennt die Datei erst nach dem ersten Abruf; dieselbe Datei hing schon am Beleg.",
      },
      { actor, importId },
    );
    return added;
  });
}

/**
 * XML einer Rechnung, deren PDF gerade nachgeladen wurde: angehängt („nachgeladen“), mit Fehler „Anhang fehlt“ (ein
 * späterer Abruf versucht es erneut), ohne Fehler leer heißt keine E-Rechnung. Eigene Transaktion, damit der Stand nach
 * dem des PDFs kommt. true, wenn das XML angehängt wurde.
 */
async function xmlAfterPdf(actor: string, importId: string, client: SevdeskClient, signal: AbortSignal, row: Row, id: string): Promise<boolean> {
  let xml: SevFile | null;
  try {
    xml = await client.invoiceXml(id);
  } catch (error) {
    if (fatal(error, signal)) throw error;
    const finding = sevFileFinding({ kind: "pdf" }, { main: true, xmlError: progressMessage(error) })!;
    await withActor(actor, (tx) => recordFileState(tx, row.id, finding, { actor, importId }));
    return false;
  }
  if (!xml) return false;
  const file = xml;
  await withActor(actor, async (tx) => {
    await appendFile(tx, row.id, "xml", null, file, row.lexofficeId);
    await recordFileState(
      tx,
      row.id,
      { state: "nachgeladen", role: "xml", sourceFileId: null, message: "Ein späterer Abruf hat die Datei angehängt." },
      { actor, importId },
    );
  });
  return true;
}

/** Offene Dateistände aller Belege aus sevDesk nach dem Lauf */
async function openCounts() {
  const rows = await db.execute<{ latest: LegacyFileState | null; files: number }>(sql`
    select (select s.state from legacy_file_states s where s.voucher_id = v.id order by s.created_at desc, s.id desc limit 1) as latest,
      (select count(*)::int from lexoffice_voucher_files f where f.voucher_id = v.id) as files
    from lexoffice_vouchers v where v.source = 'sevdesk'`);
  const statuses = [...rows].map((r) => legacyFileStatus(r.latest, Number(r.files), false));
  return {
    ohneDatei: statuses.filter((s) => s === "ohne_datei_offen" || s === "ohne_datei").length,
    abrufFehlgeschlagen: statuses.filter((s) => s === "abruf_fehlgeschlagen").length,
    anhangFehlt: statuses.filter((s) => s === "anhang_fehlt").length,
  };
}

/** true, wenn eine Zeile entstand; dieselben Bytes hängen je Beleg nur einmal an */
async function appendFile(tx: Tx, voucherId: string, role: "pdf" | "xml" | "anhang", fileId: string | null, file: SevFile, lexofficeId: string) {
  const sha256 = sha256Of(file.bytes);
  await storeFile(file.bytes);
  const kind = sniff(file.bytes)?.kind;
  const extension = role === "xml" ? "xml" : kind === "jpeg" ? "jpg" : (kind ?? "pdf");
  const added = await tx
    .insert(schema.lexofficeVoucherFiles)
    .values({
      voucherId,
      role,
      lexofficeFileId: fileId,
      filename: (file.filename ?? `${lexofficeId.replace(/[^\w.-]+/g, "_")}.${extension}`).slice(0, 200),
      mimeType: file.mimeType.split(";")[0]!.trim() || "application/octet-stream",
      sha256,
      size: file.bytes.byteLength,
    })
    .onConflictDoNothing()
    .returning({ id: schema.lexofficeVoucherFiles.id });
  return added.length > 0;
}
