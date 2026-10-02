import { DatevParseError, isDatevFile, parseDatevBuchungsstapel } from "@haben/import";
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { loadFile, sha256Of, sniff, storeFile } from "./storage.ts";

export const MAX_ARCHIVE_SIZE = 100 * 1024 * 1024;

export const ARCHIVE_KINDS = {
  datev: "DATEV-Buchungsstapel",
  idea: "IDEA-Export",
  elster: "ELSTER-Protokoll",
  kontoauszug: "Kontoauszug",
  sonstiges: "Sonstiges",
} as const;

export type ArchiveKind = keyof typeof ARCHIVE_KINDS;

export class ArchiveError extends Error {}

const EXTENSION_TYPES: Record<string, string> = {
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
  xml: "application/xml",
  json: "application/json",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function mimeTypeOf(bytes: Uint8Array, filename: string): string {
  const sniffed = sniff(bytes);
  if (sniffed) return sniffed.mimeType;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "application/zip";
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_TYPES[extension] ?? "application/octet-stream";
}

/**
 * Legt eine Originaldatei unverändert ins Archiv. Ein DATEV-Buchungsstapel wird zusätzlich zeilenweise
 * übernommen; Zeiträume dürfen sich nicht mit schon übernommenen Stapeln überschneiden.
 */
export async function addArchiveFile(
  actor: string,
  file: { bytes: Uint8Array; filename: string; kind: ArchiveKind; year: number | null; note?: string },
): Promise<{ id: string; bookings: number; warnings: string[] }> {
  if (file.bytes.byteLength === 0) throw new ArchiveError(`${file.filename}: Datei ist leer.`);
  if (file.bytes.byteLength > MAX_ARCHIVE_SIZE) throw new ArchiveError(`${file.filename}: größer als 100 MB.`);
  const sha256 = sha256Of(file.bytes);
  const [existing] = await db
    .select({ filename: schema.archiveFiles.filename })
    .from(schema.archiveFiles)
    .where(eq(schema.archiveFiles.sha256, sha256));
  if (existing) throw new ArchiveError(`${file.filename}: liegt schon im Archiv (als ${existing.filename}).`);

  let kind = file.kind;
  if (kind !== "datev" && isDatevFile(file.bytes)) kind = "datev";
  let year = file.year;
  let meta: Record<string, unknown> | null = null;
  let bookings: ReturnType<typeof parseDatevBuchungsstapel>["bookings"] = [];
  let warnings: string[] = [];

  if (kind === "datev") {
    let stack;
    try {
      stack = parseDatevBuchungsstapel(file.bytes);
    } catch (error) {
      if (error instanceof DatevParseError) throw new ArchiveError(`${file.filename}: ${error.message}`);
      throw error;
    }
    bookings = stack.bookings;
    warnings = stack.warnings;
    if (bookings.length === 0) throw new ArchiveError(`${file.filename}: Der Buchungsstapel enthält keine Buchungen.`);
    const dates = bookings.map((b) => b.date).sort();
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;
    year ??= Number(stack.header.fiscalYearStart.slice(0, 4));
    // Zeiträume der schon übernommenen Stapel vergleichen, nicht nur einzelne Buchungstage
    const [overlap] = await db
      .select({ filename: schema.archiveFiles.filename, from: sql<string>`${schema.archiveFiles.meta} ->> 'dateFrom'`, to: sql<string>`${schema.archiveFiles.meta} ->> 'dateTo'` })
      .from(schema.archiveFiles)
      .where(
        and(
          eq(schema.archiveFiles.kind, "datev"),
          sql`${schema.archiveFiles.meta} ->> 'dateFrom' <= ${to}`,
          sql`${schema.archiveFiles.meta} ->> 'dateTo' >= ${from}`,
        ),
      )
      .limit(1);
    if (overlap) {
      throw new ArchiveError(
        `${file.filename}: Der Zeitraum ${from} bis ${to} überschneidet sich mit ${overlap.filename} (${overlap.from} bis ${overlap.to}). Jeder Zeitraum darf nur einmal übernommen werden.`,
      );
    }
    meta = { header: stack.header, dateFrom: from, dateTo: to, bookings: bookings.length, warnings };
  }

  // Ohne Jahr zählt die Datei weder im Abgleich noch im Jahresexport
  if (year === null) throw new ArchiveError(`${file.filename}: Bitte das Geschäftsjahr angeben.`);

  await storeFile(file.bytes);
  const id = await withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(schema.archiveFiles)
      .values({
        kind,
        year,
        filename: file.filename.slice(0, 200),
        sha256,
        mimeType: mimeTypeOf(file.bytes, file.filename),
        size: file.bytes.byteLength,
        note: file.note?.slice(0, 500) ?? "",
        meta,
      })
      .returning({ id: schema.archiveFiles.id });
    const fileId = row!.id;
    // In Blöcken, damit große Stapel die Parametergrenze von Postgres nicht reißen
    for (let i = 0; i < bookings.length; i += 1000) {
      await tx.insert(schema.datevBookings).values(
        bookings.slice(i, i + 1000).map((b) => ({
          fileId,
          row: b.row,
          date: b.date,
          amount: b.amount,
          side: b.side,
          currency: b.currency,
          account: b.account,
          contraAccount: b.contraAccount,
          buKey: b.buKey,
          voucherField1: b.voucherField1,
          voucherField2: b.voucherField2,
          text: b.text,
          documentLink: b.documentLink,
          raw: b.raw,
        })),
      );
    }
    return fileId;
  });
  return { id, bookings: bookings.length, warnings };
}

export async function listArchiveFiles() {
  return db
    .select({
      id: schema.archiveFiles.id,
      kind: schema.archiveFiles.kind,
      year: schema.archiveFiles.year,
      filename: schema.archiveFiles.filename,
      mimeType: schema.archiveFiles.mimeType,
      size: schema.archiveFiles.size,
      sha256: schema.archiveFiles.sha256,
      note: schema.archiveFiles.note,
      meta: schema.archiveFiles.meta,
      uploadedAt: schema.archiveFiles.uploadedAt,
    })
    .from(schema.archiveFiles)
    .orderBy(desc(schema.archiveFiles.year), asc(schema.archiveFiles.kind), asc(schema.archiveFiles.filename));
}

export async function loadArchiveFile(id: string) {
  const [row] = await db.select().from(schema.archiveFiles).where(eq(schema.archiveFiles.id, id));
  if (!row) return null;
  return { ...row, bytes: await loadFile(row.sha256) };
}

/** Nummern vergleichbar machen: ohne Leerzeichen, Groß-/Kleinschreibung egal */
export function normalizeVoucherNumber(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

const matchedSql = sql<boolean>`exists (select 1 from lexoffice_vouchers v where v.number <> '' and lower(regexp_replace(v.number, '\\s+', '', 'g')) = lower(regexp_replace(datev_bookings.voucher_field1, '\\s+', '', 'g')))`;

export async function listDatevBookings(filter: { year: number; search: string; unmatched: boolean; page: number }) {
  const conditions: SQL[] = [
    gte(schema.datevBookings.date, `${filter.year}-01-01`),
    lte(schema.datevBookings.date, `${filter.year}-12-31`),
  ];
  if (filter.search.trim()) {
    const term = `%${filter.search.trim()}%`;
    conditions.push(
      or(
        ilike(schema.datevBookings.text, term),
        ilike(schema.datevBookings.voucherField1, term),
        ilike(schema.datevBookings.account, term),
        ilike(schema.datevBookings.contraAccount, term),
      )!,
    );
  }
  if (filter.unmatched) conditions.push(sql`not ${matchedSql}`);
  const where = and(...conditions);
  const pageSize = 100;
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: schema.datevBookings.id,
        row: schema.datevBookings.row,
        date: schema.datevBookings.date,
        amount: schema.datevBookings.amount,
        side: schema.datevBookings.side,
        account: schema.datevBookings.account,
        contraAccount: schema.datevBookings.contraAccount,
        buKey: schema.datevBookings.buKey,
        voucherField1: schema.datevBookings.voucherField1,
        text: schema.datevBookings.text,
        matched: matchedSql,
        filename: schema.archiveFiles.filename,
      })
      .from(schema.datevBookings)
      .innerJoin(schema.archiveFiles, eq(schema.archiveFiles.id, schema.datevBookings.fileId))
      .where(where)
      .orderBy(asc(schema.datevBookings.date), asc(schema.datevBookings.row))
      .limit(pageSize)
      .offset(filter.page * pageSize),
    db.select({ n: count() }).from(schema.datevBookings).where(where),
  ]);
  return { rows, total: total?.n ?? 0, pageSize };
}

/** Umsätze je Konto (beide Seiten jeder Buchung), wie im DATEV-Stapel; Beträge brutto, wo Steuerautomatik greift */
export async function accountTotals(year: number) {
  const rows = await db.execute<{ account: string; debit: string; credit: string }>(sql`
    with sides as (
      select account, case when side = 'S' then amount else 0 end as debit, case when side = 'H' then amount else 0 end as credit
        from datev_bookings where date between ${`${year}-01-01`} and ${`${year}-12-31`}
      union all
      select contra_account, case when side = 'H' then amount else 0 end, case when side = 'S' then amount else 0 end
        from datev_bookings where date between ${`${year}-01-01`} and ${`${year}-12-31`}
    )
    select account, sum(debit) as debit, sum(credit) as credit from sides group by account
    order by length(account), account`);
  return [...rows].map((r) => ({ account: r.account, debit: Number(r.debit), credit: Number(r.credit) }));
}
