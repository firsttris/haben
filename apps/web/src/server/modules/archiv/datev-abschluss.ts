import { abschluss, carryForward, isKapitalgesellschaft, kapgSteuern, type Abschluss, type KapgSteuern, type Kontenrahmen } from "@haben/core";
import { datevSalden, hasOpeningBalances, type DatevSaldenBooking } from "@haben/import";
import { eq, lte, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { abschlussHinweise, accountName, type AbschlussHinweis } from "../buchhaltung/index.ts";
import { gespeicherteKapgAngaben } from "../jahreserklaerung/index.ts";
import { loadCompany } from "../stammdaten/index.ts";

/*
 * Jahresabschluss aus dem DATEV-Buchungsstapel im Archiv, nur GmbH und UG: Bilanz, GuV, Körperschaft- und Gewerbesteuer
 * eines Jahres aus der alten Buchhaltung, gerechnet mit denselben Funktionen wie aus dem Journal. Zum Vergleich mit dem
 * Abschluss der Steuerberatung; gebucht wird nichts.
 */

/** Woher die Bestände zum Jahresbeginn kommen */
export type DatevVortrag = "stapel" | "vorjahre" | "keiner";

export interface DatevAbschluss {
  year: number;
  kontenrahmen: Kontenrahmen;
  vortrag: DatevVortrag;
  report: Abschluss;
  names: Record<string, string>;
  steuern: KapgSteuern | null;
  issues: AbschlussHinweis[];
}

type Row = DatevSaldenBooking & { date: string; kontenrahmen: string | null; filename: string | null };

async function bookingsUntil(year: number): Promise<Row[]> {
  const b = schema.datevBookings;
  const f = schema.archiveFiles;
  return db
    .select({
      date: b.date,
      amount: b.amount,
      side: b.side,
      account: b.account,
      contraAccount: b.contraAccount,
      buKey: b.buKey,
      accountLength: sql<number | null>`(${f.meta} -> 'header' ->> 'accountLength')::int`,
      kontenrahmen: sql<string | null>`${f.meta} -> 'header' ->> 'kontenrahmen'`,
      filename: f.filename,
    })
    .from(b)
    .leftJoin(f, eq(f.id, b.fileId))
    .where(lte(b.date, `${year}-12-31`));
}

/** Eröffnung aus dem Stapel selbst (9000 bis 9009) oder aus den Stapeln der Vorjahre wie beim Saldenvortrag im Journal */
function openingFor(kontenrahmen: Kontenrahmen, inYear: Row[], prior: Row[]): { vortrag: DatevVortrag; balances: Map<string, number> } {
  if (hasOpeningBalances(inYear)) return { vortrag: "stapel", balances: new Map() };
  if (prior.length === 0) return { vortrag: "keiner", balances: new Map() };
  return { vortrag: "vorjahre", balances: carryForward(kontenrahmen, datevSalden(sinceLastOpening(prior), kontenrahmen)) };
}

/** Buchungen der Vorjahre ab dem letzten Jahr, dessen Stapel seine Eröffnungsbilanz mitbringt; die früheren stecken darin schon */
function sinceLastOpening(prior: Row[]): Row[] {
  const years = [...new Set(prior.map((r) => r.date.slice(0, 4)))].sort().reverse();
  const opening = years.find((y) => hasOpeningBalances(prior.filter((r) => r.date.startsWith(y))));
  return opening ? prior.filter((r) => r.date >= `${opening}-01-01`) : prior;
}

function merge(jahr: { account: string; saldo: number }[], vortrag: Map<string, number>) {
  const salden = new Map(vortrag);
  for (const { account, saldo } of jahr) salden.set(account, (salden.get(account) ?? 0) + saldo);
  return [...salden].map(([account, saldo]) => ({ account, saldo })).sort((a, b) => a.account.localeCompare(b.account, "de", { numeric: true }));
}

function hinweise(kontenrahmen: Kontenrahmen, year: number, inYear: Row[], vortrag: DatevVortrag, mitSteuern: boolean): AbschlussHinweis[] {
  const fremd = [...new Set(inYear.filter((r) => r.kontenrahmen && r.kontenrahmen !== kontenrahmen).map((r) => `${r.filename} (${r.kontenrahmen})`))];
  return [
    ...fremd.map((datei) => ({
      tone: "fehler" as const,
      text: `${datei} ist in einem anderen Kontenrahmen als die Firmendaten (${kontenrahmen}); die Posten stimmen dann nicht.`,
    })),
    ...(vortrag === "keiner"
      ? [
          {
            tone: "hinweis" as const,
            text: `Der Stapel enthält keine Eröffnungsbuchungen (9000 bis 9009) und es gibt keinen Stapel aus den Vorjahren: Die Bestände zum 1.1.${year} fehlen, die Bilanz ist unvollständig. GuV und Steuern betrifft das nicht.`,
          },
        ]
      : []),
    ...(mitSteuern
      ? []
      : [
          {
            tone: "hinweis" as const,
            text: `Für Körperschaft- und Gewerbesteuer fehlen Hebesatz und Verlustvorträge ${year}; sie stehen unter Jahresabschluss ${year}.`,
          },
        ]),
  ];
}

/** Abschluss eines Jahres aus den archivierten DATEV-Buchungen; null ohne Buchungen im Jahr oder im Einzelunternehmen */
export async function datevAbschluss(year: number): Promise<DatevAbschluss | null> {
  const company = await loadCompany();
  if (!isKapitalgesellschaft(company.rechtsform)) return null;
  const rows = await bookingsUntil(year);
  const start = `${year}-01-01`;
  const inYear = rows.filter((r) => r.date >= start);
  if (inYear.length === 0) return null;
  const kontenrahmen = company.kontenrahmen;
  const opening = openingFor(
    kontenrahmen,
    inYear,
    rows.filter((r) => r.date < start),
  );
  const salden = merge(datevSalden(inYear, kontenrahmen), opening.balances);
  const report = abschluss(kontenrahmen, salden);
  const angaben = await gespeicherteKapgAngaben(year);
  const steuern = angaben ? kapgSteuern(kontenrahmen, year, salden, report.jahresergebnis, angaben) : null;
  return {
    year,
    kontenrahmen,
    vortrag: opening.vortrag,
    report,
    names: Object.fromEntries(salden.map((s) => [s.account, accountName(kontenrahmen, s.account)])),
    steuern,
    issues: [...hinweise(kontenrahmen, year, inYear, opening.vortrag, steuern !== null), ...abschlussHinweise(report, kontenrahmen)],
  };
}
