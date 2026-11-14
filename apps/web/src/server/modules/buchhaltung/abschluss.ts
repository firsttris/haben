import { abschluss, isKapitalgesellschaft, type Abschluss } from "@haben/core";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { listAssets } from "./assets.ts";
import { accountName } from "./journal.ts";
import { ledgerRange, saldenliste } from "./ledger.ts";

/*
 * Jahresabschluss einer GmbH oder UG: Bilanz und GuV der Kleinstkapitalgesellschaft (abschluss in @haben/core) und das
 * Abschließen des Jahres. Abgeschlossen nimmt das Jahr keine Buchung mehr an (Trigger in drizzle/0098).
 */

export class AbschlussError extends UserError {}

export interface AbschlussHinweis {
  /** fehler: hindert den Abschluss; hinweis: zu klären, hindert ihn nicht */
  tone: "fehler" | "hinweis";
  text: string;
}

export interface JahresabschlussStatus {
  closedAt: Date;
  entries: number;
  /** Stimmen Zahl und Prüfwert der Buchungen noch mit dem Abschluss überein? */
  intact: boolean;
}

/** Was vor dem Abschluss noch zu buchen ist; dieselben Fragen wie beim Jahreswechsel der Firmendaten */
async function openWork(year: number, q: Db | Tx): Promise<AbschlussHinweis[]> {
  const pendingAssets = (await listAssets(year, q)).filter((a) => a.pending).length;
  const [documents] = await q
    .select({ n: count() })
    .from(schema.documents)
    .where(
      and(eq(schema.documents.status, "neu"), gte(schema.documents.documentDate, `${year}-01-01`), lt(schema.documents.documentDate, `${year + 1}-01-01`)),
    );
  const unbooked = documents?.n ?? 0;
  const issues: AbschlussHinweis[] = [];
  if (pendingAssets > 0) issues.push({ tone: "fehler", text: `AfA ${year} fehlt für ${pendingAssets === 1 ? "eine Anlage" : `${pendingAssets} Anlagen`}.` });
  if (unbooked > 0) {
    issues.push({
      tone: "fehler",
      text: `${unbooked === 1 ? "Ein Beleg" : `${unbooked} Belege`} mit Datum in ${year} ${unbooked === 1 ? "ist" : "sind"} noch nicht gebucht.`,
    });
  }
  return issues;
}

/** Offene Vorträge und Konten ohne Posten als Hinweise; auch für den Abschluss aus einem DATEV-Stapel im Archiv */
export function reportIssues(report: Abschluss, kontenrahmen: Parameters<typeof accountName>[0]): AbschlussHinweis[] {
  const konto = (account: string) => `${account}${accountName(kontenrahmen, account) ? ` ${accountName(kontenrahmen, account)}` : ""}`;
  return [
    ...report.offeneVortraege.map((k) => ({
      tone: "hinweis" as const,
      text: `Konto ${konto(k.account)} ist nicht ausgeglichen; die Eröffnung ist unvollständig oder eine Gegenbuchung fehlt.`,
    })),
    ...report.nichtZugeordnet.map((k) => ({
      tone: "hinweis" as const,
      text: `Konto ${konto(k.account)} hat keinen Posten in Bilanz oder GuV und fehlt dort.`,
    })),
  ];
}

async function closingStatus(year: number, q: Db | Tx): Promise<JahresabschlussStatus | null> {
  const [closing] = await q.select().from(schema.yearClosings).where(eq(schema.yearClosings.year, year));
  if (!closing) return null;
  const [now] = await q.execute<{ entries: number; digest: string }>(sql`select entries, digest from haben_year_digest(${year})`);
  return { closedAt: closing.closedAt, entries: closing.entries, intact: now?.entries === closing.entries && now?.digest === closing.digest };
}

/** Bilanz, GuV, offene Punkte und Stand des Abschlusses für ein Jahr; nur GmbH und UG */
export async function jahresabschluss(year: number, today: string) {
  const company = await loadCompany();
  if (!isKapitalgesellschaft(company.rechtsform)) return { year, rechtsform: company.rechtsform, kapitalgesellschaft: false as const };
  const rows = (await saldenliste(ledgerRange(year), { aufgeloest: true })).filter((r) => r.kontenrahmen === company.kontenrahmen);
  const report = abschluss(
    company.kontenrahmen,
    rows.map((r) => ({ account: r.account, saldo: r.saldo })),
  );
  const status = await closingStatus(year, db);
  const yearOver = `${year}-12-31` < today;
  const issues = [
    ...(yearOver ? [] : [{ tone: "fehler" as const, text: `Das Jahr ${year} ist noch nicht vorbei.` }]),
    ...(status ? [] : await openWork(year, db)),
    ...reportIssues(report, company.kontenrahmen),
  ];
  const names = Object.fromEntries(rows.map((r) => [r.account, r.name]));
  return {
    year,
    rechtsform: company.rechtsform,
    kapitalgesellschaft: true as const,
    kontenrahmen: company.kontenrahmen,
    name: company.name,
    report,
    names,
    issues,
    status,
  };
}

/** Schließt das Jahr ab: danach nimmt die Datenbank keine Buchung mit Datum darin mehr an. Nicht umkehrbar. */
export async function closeYear(actor: string, year: number, today: string): Promise<JahresabschlussStatus> {
  return withActor(actor, async (tx) => {
    const company = await loadCompany(tx);
    if (!isKapitalgesellschaft(company.rechtsform)) throw new AbschlussError("Ein Jahr abschließen lässt sich nur in GmbH und UG.");
    if (`${year}-12-31` >= today) throw new AbschlussError(`Das Jahr ${year} ist noch nicht vorbei.`);
    if (await closingStatus(year, tx)) throw new AbschlussError(`Das Jahr ${year} ist bereits abgeschlossen.`);
    const blocking = (await openWork(year, tx)).filter((i) => i.tone === "fehler");
    if (blocking.length > 0) throw new AbschlussError(`Noch nicht bereit: ${blocking.map((i) => i.text).join(" ")}`);
    await tx.insert(schema.yearClosings).values({ year });
    return (await closingStatus(year, tx))!;
  });
}
