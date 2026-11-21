import { between, desc, eq, inArray, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import type { LegacyFileState } from "../../db/schema.ts";
import { UserError } from "../../errors.ts";
import { ohneDateiBestaetigbar } from "./ohne-datei.ts";

/*
 * Dateistand archivierter Belege (#345), gemeinsam für Importfortschritt, Belegansicht, Abgleich und Export. Die Zeilen in
 * legacy_file_states werden nur angehängt; es gilt die jüngste je Beleg. Die Archivkopie in lexoffice_vouchers bleibt
 * unverändert. Wie sevDesk die Zustände liefert, steht in packages/import/src/sevdesk/dateistand.ts.
 */

export class FileStateError extends UserError {}

/** Wie ein Beleg im Abgleich zählt */
export type LegacyFileStatus =
  /** Datei da, nichts Erwartetes fehlt */
  | "vollstaendig"
  /** Buchung ohne Beleg aus der Quelle (raw.ohneBeleg, etwa Lexoffice-Sicherung oder Accountable) */
  | "ohne_beleg"
  /** keine Datei, ohne Feststellung (andere Quellen, sevDesk-Abrufe vor #345) */
  | "ohne_datei"
  /** sevDesk nennt keine Datei, noch niemand hat das geprüft */
  | "ohne_datei_offen"
  /** von Hand geprüft: keine Datei (sevDesk-Abruf oder Accountable ohne Einzelbeleg) */
  | "ohne_datei_bestaetigt"
  | "abruf_fehlgeschlagen"
  | "anhang_fehlt";

export const FILE_STATUS_LABELS: Record<LegacyFileStatus, string> = {
  vollstaendig: "Datei vorhanden",
  ohne_beleg: "Buchung ohne Beleg",
  ohne_datei: "ohne Datei",
  ohne_datei_offen: "laut sevDesk ohne Datei, nicht bestätigt",
  ohne_datei_bestaetigt: "ohne Datei, bestätigt",
  abruf_fehlgeschlagen: "Datei erwartet, Abruf fehlgeschlagen",
  anhang_fehlt: "Anhang fehlt",
};

/** Beschriftung je Zeile in legacy_file_states (Verlauf, Export) */
export const FILE_STATE_LABELS: Record<LegacyFileState, string> = {
  ohne_datei: "laut sevDesk ohne Datei",
  abruf_fehlgeschlagen: "Datei erwartet, Abruf fehlgeschlagen",
  anhang_fehlt: "Anhang fehlt",
  bestaetigt_ohne_datei: "ohne Datei bestätigt",
  bestaetigung_zurueckgenommen: "Bestätigung zurückgenommen",
  nachgeladen: "Datei nachgeladen",
  kein_anhang: "Anhang entfällt, die Quelle führt keinen",
};

/** Ein Beleg dieses Stands braucht noch Arbeit, bevor das Jahr vollständig ist */
export const OPEN_FILE_STATUSES: ReadonlySet<LegacyFileStatus> = new Set(["ohne_datei", "ohne_datei_offen", "abruf_fehlgeschlagen", "anhang_fehlt"]);

export function legacyFileStatus(latest: LegacyFileState | null, files: number, ohneBeleg: boolean): LegacyFileStatus {
  // Eine Bestätigung steht über dem Merkmal aus dem Import, sonst bliebe sie unsichtbar; ohne Bestätigung bleibt es beim Merkmal
  if (latest === "bestaetigt_ohne_datei") return "ohne_datei_bestaetigt";
  if (ohneBeleg) return "ohne_beleg";
  switch (latest) {
    case "abruf_fehlgeschlagen":
      return "abruf_fehlgeschlagen";
    case "anhang_fehlt":
      return "anhang_fehlt";
    // Die Datei der Vorlage (#1128) kann nach der Feststellung ankommen
    case "ohne_datei":
    // Nach einer Rücknahme (#1317) gilt der Beleg wieder als offen: Mit Datei vollständig, sonst derselbe Stand wie vor
    // der Bestätigung. Nicht „ohne_datei“: der lädt nicht zum erneuten Bestätigen ein (canConfirmWithoutFile).
    case "bestaetigung_zurueckgenommen":
      return files > 0 ? "vollstaendig" : "ohne_datei_offen";
    default:
      return files > 0 ? "vollstaendig" : "ohne_datei";
  }
}

/** Jüngster Stand eines Belegs als SQL, für Listen und Abgleich; `alias` ist die Tabelle lexoffice_vouchers */
export function latestFileStateSql(alias: string) {
  return sql<LegacyFileState | null>`${sql.raw(`(select s.state from legacy_file_states s where s.voucher_id = ${alias}.id order by s.created_at desc, s.id desc limit 1)`)}`;
}

/** Wie viele Belege je Stand, für Abgleich und Oberfläche */
export function fileCounts(statuses: readonly LegacyFileStatus[]) {
  const n = (status: LegacyFileStatus) => statuses.filter((s) => s === status).length;
  return {
    ohneDatei: n("ohne_datei"),
    ohneDateiOffen: n("ohne_datei_offen"),
    ohneDateiBestaetigt: n("ohne_datei_bestaetigt"),
    abrufFehlgeschlagen: n("abruf_fehlgeschlagen"),
    anhangFehlt: n("anhang_fehlt"),
  };
}

/** Punkt „Jeder Beleg hat eine Datei“ im Abgleich: jeder offene Stand einzeln, bestätigt dateilose nur als Hinweis */
export function fileCheck(statuses: readonly LegacyFileStatus[]): { ok: boolean; label: string; detail: string } {
  const c = fileCounts(statuses);
  const open = [
    c.abrufFehlgeschlagen > 0 ? `${c.abrufFehlgeschlagen} Abruf fehlgeschlagen` : "",
    c.ohneDateiOffen > 0 ? `${c.ohneDateiOffen} laut sevDesk ohne Datei, nicht bestätigt` : "",
    c.ohneDatei > 0 ? `${c.ohneDatei} ohne Datei` : "",
    c.anhangFehlt > 0 ? `${c.anhangFehlt} mit fehlendem Anhang` : "",
  ].filter(Boolean);
  const confirmed = c.ohneDateiBestaetigt > 0 ? `${c.ohneDateiBestaetigt} ohne Datei (bestätigt)` : "";
  return {
    ok: open.length === 0,
    label: "Jeder Beleg hat eine Datei",
    detail: open.length > 0 ? [...open, confirmed].filter(Boolean).join(", ") : confirmed ? `${confirmed}, übrige mit Datei` : "alle mit Datei",
  };
}

/** Jüngster Stand je Beleg */
export async function latestFileStates(voucherIds: string[]): Promise<Map<string, LegacyFileState>> {
  if (voucherIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([schema.legacyFileStates.voucherId], { voucherId: schema.legacyFileStates.voucherId, state: schema.legacyFileStates.state })
    .from(schema.legacyFileStates)
    .where(inArray(schema.legacyFileStates.voucherId, voucherIds))
    .orderBy(schema.legacyFileStates.voucherId, desc(schema.legacyFileStates.createdAt), desc(schema.legacyFileStates.id));
  return new Map(rows.map((r) => [r.voucherId, r.state]));
}

/** Warum ein offener Posten ohne Datei nicht übernommen werden kann, nach seinem Dateistand und seiner Quelle */
export function takeoverFileIssue(state: LegacyFileState | null, quelle = "sevDesk"): string | null {
  if (state === "abruf_fehlgeschlagen") return `Datei erwartet, Abruf aus ${quelle} fehlgeschlagen – „Erneut abrufen“ versucht es noch einmal`;
  if (state === "ohne_datei") return "laut sevDesk ohne Datei – in sevDesk prüfen, dann in der Belegansicht bestätigen und in Haben von Hand erfassen";
  if (state === "bestaetigt_ohne_datei") return "ohne Datei (bestätigt) – in Haben von Hand erfassen";
  // Nach einer Rücknahme gilt wieder der offene Stand, sonst fiele der Hinweis still weg (#1317)
  if (state === "bestaetigung_zurueckgenommen") return "ohne Datei, Bestätigung zurückgenommen – prüfen, dann erneut bestätigen und in Haben von Hand erfassen";
  return null;
}

type Finding = { state: LegacyFileState; role: "pdf" | "xml" | "anhang" | null; sourceFileId: string | null; message: string };

/** Hängt einen Stand an, wenn er sich vom jüngsten unterscheidet; true, wenn eine Zeile entstand */
export async function recordFileState(tx: Tx, voucherId: string, finding: Finding, by: { actor: string; importId: string | null }): Promise<boolean> {
  const [latest] = await tx
    .select({ state: schema.legacyFileStates.state, role: schema.legacyFileStates.role, sourceFileId: schema.legacyFileStates.sourceFileId })
    .from(schema.legacyFileStates)
    .where(eq(schema.legacyFileStates.voucherId, voucherId))
    .orderBy(desc(schema.legacyFileStates.createdAt), desc(schema.legacyFileStates.id))
    .limit(1);
  if (latest && latest.state === finding.state && latest.role === finding.role && latest.sourceFileId === finding.sourceFileId) return false;
  await tx.insert(schema.legacyFileStates).values({ voucherId, importId: by.importId, createdBy: by.actor, ...finding });
  return true;
}

/**
 * Eine Person hat geprüft, dass der Beleg keine Datei hat. Erlaubt sind Belege aus sevDesk, aus dem Accountable-Stapel und
 * Buchungen ohne Beleg aus der Lexoffice-Sicherung (ohneDateiBestaetigbar), nie Rechnung oder Gutschrift: deren
 * Original-PDF ist Pflicht. Verlangt ist der offene Stand „ohne Datei“; ein fehlgeschlagener Abruf und ein schon
 * bestätigter Beleg lassen sich nicht wegbestätigen.
 */
export async function confirmWithoutFile(actor: string, voucherId: string, note: string): Promise<void> {
  await withActor(actor, async (tx) => {
    // Sperrt den Beleg gegen eine gleichzeitige Bestätigung
    const [voucher] = await tx
      .select({
        source: schema.lexofficeVouchers.source,
        lexofficeId: schema.lexofficeVouchers.lexofficeId,
        type: schema.lexofficeVouchers.type,
        ohneBeleg: sql<boolean>`coalesce((${schema.lexofficeVouchers.raw}->>'ohneBeleg')::boolean, false)`,
        guid: sql<string | null>`${schema.lexofficeVouchers.raw}->>'guid'`,
        documentPresent: sql<boolean | null>`(${schema.lexofficeVouchers.raw}->>'documentPresent')::boolean`,
      })
      .from(schema.lexofficeVouchers)
      .where(eq(schema.lexofficeVouchers.id, voucherId))
      .for("update");
    if (!voucher) throw new FileStateError("Beleg nicht gefunden.");
    if (voucher.source === "sevdesk" && !voucher.lexofficeId.startsWith("voucher/"))
      throw new FileStateError("Rechnungen und Gutschriften brauchen ihr Original-PDF; ein fehlendes PDF lässt sich nicht als „ohne Datei“ bestätigen.");
    if (voucher.source === "accountable" && voucher.type !== "purchaseinvoice")
      throw new FileStateError("Rechnungen und Gutschriften brauchen ihr Original-PDF; ein fehlendes PDF lässt sich nicht als „ohne Datei“ bestätigen.");
    if (voucher.source === "accountable" && voucher.guid)
      throw new FileStateError(
        "Diese Buchung hat eine Beleg-GUID; die Datei fehlt nur im Export. Ein einzelner Beleg kann also existieren, das Bestätigen ohne Datei ist hier nicht vorgesehen.",
      );
    if (voucher.source === "accountable" && voucher.documentPresent === true)
      throw new FileStateError("Accountable meldet zu dieser Buchung „Dokument vorhanden“; ein Einzelbeleg existiert, er hängt nur nicht an dieser Buchung.");
    if (voucher.source === "lexoffice" && voucher.type !== "purchaseinvoice")
      throw new FileStateError("Rechnungen und Gutschriften brauchen ihr Original-PDF; ein fehlendes PDF lässt sich nicht als „ohne Datei“ bestätigen.");
    // Nur eine Buchung ohne Beleg hatte in der Quelle nie ein Belegbild; fehlt die Datei nur im Export, ist das keine Aussage
    if (voucher.source === "lexoffice" && !voucher.ohneBeleg)
      throw new FileStateError("Diese Buchung führt die Sicherung als Buchung mit Beleg; die Datei fehlt nur im Export, das lässt sich hier nicht bestätigen.");
    if (!ohneDateiBestaetigbar(voucher)) throw new FileStateError(`Aus der Quelle ${voucher.source} lassen sich keine Belege ohne Datei bestätigen.`);
    const [{ files } = { files: 0 }] = await tx
      .select({ files: sql<number>`count(*)::int` })
      .from(schema.lexofficeVoucherFiles)
      .where(eq(schema.lexofficeVoucherFiles.voucherId, voucherId));
    const [latest] = await tx
      .select({ state: schema.legacyFileStates.state })
      .from(schema.legacyFileStates)
      .where(eq(schema.legacyFileStates.voucherId, voucherId))
      .orderBy(desc(schema.legacyFileStates.createdAt), desc(schema.legacyFileStates.id))
      .limit(1);
    if (Number(files) > 0) throw new FileStateError("Der Beleg hat eine Datei.");
    if (latest?.state === "bestaetigt_ohne_datei") throw new FileStateError("Schon bestätigt.");
    // Aus dem Accountable-Stapel und der Lexoffice-Sicherung kommt kein Abruf, dort gibt es keinen Stand: das Merkmal ohneBeleg genügt.
    // Nach einer Rücknahme ist der Beleg wieder offen; ohne diesen Fall wäre der Knopf da, der Klick aber abgewiesen (#1317)
    const standOffen =
      latest?.state === "ohne_datei" ||
      latest?.state === "bestaetigung_zurueckgenommen" ||
      (latest?.state == null && (voucher.source === "accountable" || voucher.source === "lexoffice") && voucher.ohneBeleg);
    if (!standOffen)
      throw new FileStateError(
        latest?.state === "abruf_fehlgeschlagen"
          ? `${voucher.source === "lexoffice" ? "Die Sicherung" : "sevDesk"} nennt zu diesem Beleg eine Datei. Einen neuen Abruf starten, statt ohne Datei zu bestätigen.`
          : "Erst ein Abruf aus sevDesk stellt fest, ob der Beleg eine Datei nennt.",
      );
    const text = note.trim();
    const herkunft = voucher.source === "accountable" ? "Accountable-Stapel" : voucher.source === "lexoffice" ? "Lexoffice-Sicherung" : "In sevDesk geprüft";
    await tx.insert(schema.legacyFileStates).values({
      voucherId,
      importId: null,
      state: "bestaetigt_ohne_datei",
      message: text
        ? `${herkunft}: ${text}`
        : voucher.source === "accountable"
          ? "Accountable-Stapel: keine Beleg-GUID, kein Belegbild vorhanden."
          : voucher.source === "lexoffice"
            ? "Lexoffice-Sicherung: Buchung ohne Beleg, kein Belegbild in der Quelle."
            : "In sevDesk geprüft: keine Datei hinterlegt.",
      createdBy: actor,
    });
  });
}

/**
 * Nimmt eine Bestätigung „ohne Datei“ mit Grund zurück (#1317). Wie beim Bestätigen entsteht eine neue Zeile; die
 * Bestätigung selbst bleibt stehen, legacy_file_states wird nie geändert. Erlaubt ist das nur, solange sie die jüngste
 * Zeile ist: eine Rechnung oder Gutschrift war nie bestätigbar und lässt sich deshalb auch nicht zurücknehmen.
 */
export async function revokeFileConfirmation(actor: string, voucherId: string, reason: string): Promise<void> {
  const text = reason.trim();
  if (!text) throw new FileStateError("Die Rücknahme braucht einen Grund.");
  if (text.length > 500) throw new FileStateError("Der Grund der Rücknahme ist zu lang (höchstens 500 Zeichen).");
  await withActor(actor, async (tx) => {
    // Sperrt den Beleg gegen eine gleichzeitige Bestätigung oder Rücknahme
    const [voucher] = await tx
      .select({ id: schema.lexofficeVouchers.id })
      .from(schema.lexofficeVouchers)
      .where(eq(schema.lexofficeVouchers.id, voucherId))
      .for("update");
    if (!voucher) throw new FileStateError("Beleg nicht gefunden.");
    const [latest] = await tx
      .select({ state: schema.legacyFileStates.state })
      .from(schema.legacyFileStates)
      .where(eq(schema.legacyFileStates.voucherId, voucherId))
      .orderBy(desc(schema.legacyFileStates.createdAt), desc(schema.legacyFileStates.id))
      .limit(1);
    if (latest?.state !== "bestaetigt_ohne_datei")
      throw new FileStateError("Nur eine Bestätigung „ohne Datei“ lässt sich zurücknehmen; dieser Beleg ist nicht bestätigt.");
    await tx.insert(schema.legacyFileStates).values({
      voucherId,
      importId: null,
      state: "bestaetigung_zurueckgenommen",
      message: `Bestätigung zurückgenommen: ${text}`,
      createdBy: actor,
    });
  });
}

/** Verlauf des Dateistands für die Belegansicht, älteste zuerst, mit Namen der Person */
export async function fileStateHistory(voucherId: string) {
  const rows = await db
    .select({
      state: schema.legacyFileStates.state,
      role: schema.legacyFileStates.role,
      sourceFileId: schema.legacyFileStates.sourceFileId,
      message: schema.legacyFileStates.message,
      createdAt: schema.legacyFileStates.createdAt,
      createdBy: schema.legacyFileStates.createdBy,
      importId: schema.legacyFileStates.importId,
      name: schema.user.name,
    })
    .from(schema.legacyFileStates)
    .leftJoin(schema.user, eq(schema.user.id, schema.legacyFileStates.createdBy))
    .where(eq(schema.legacyFileStates.voucherId, voucherId))
    .orderBy(schema.legacyFileStates.createdAt, schema.legacyFileStates.id);
  return rows.map(({ name, createdBy, ...row }) => ({ ...row, by: row.importId ? null : (name ?? createdBy) }));
}

/** Verlauf aller Belege eines Jahres für den Export */
export async function fileStatesForYear(year: number) {
  return db
    .select({
      voucherId: schema.legacyFileStates.voucherId,
      lexofficeId: schema.lexofficeVouchers.lexofficeId,
      number: schema.lexofficeVouchers.number,
      state: schema.legacyFileStates.state,
      role: schema.legacyFileStates.role,
      sourceFileId: schema.legacyFileStates.sourceFileId,
      message: schema.legacyFileStates.message,
      createdBy: schema.legacyFileStates.createdBy,
      importId: schema.legacyFileStates.importId,
      createdAt: schema.legacyFileStates.createdAt,
    })
    .from(schema.legacyFileStates)
    .innerJoin(schema.lexofficeVouchers, eq(schema.lexofficeVouchers.id, schema.legacyFileStates.voucherId))
    .where(between(schema.lexofficeVouchers.date, `${year}-01-01`, `${year}-12-31`))
    .orderBy(schema.lexofficeVouchers.date, schema.lexofficeVouchers.number, schema.legacyFileStates.createdAt, schema.legacyFileStates.id);
}
