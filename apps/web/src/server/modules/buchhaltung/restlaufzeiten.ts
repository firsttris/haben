import {
  bilanzVermerke,
  ebilanzRestlaufzeiten,
  isKapitalgesellschaft,
  restlaufzeitAbgleich,
  restlaufzeitZeilen,
  vermerkKonten,
  type Abschluss,
  type BilanzVermerk,
  type Cents,
  type Kontenrahmen,
  type RestlaufzeitAngabe,
  type RestlaufzeitStand,
  type RestlaufzeitZeile,
  type SpaetFaellig,
  type VermerkKonto,
} from "@haben/core";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { jahresBilanzen } from "./bilanzen.ts";
import { accountName } from "./journal.ts";

/*
 * Restlaufzeiten der Forderungen und Verbindlichkeiten zum 31.12. (§ 268 Abs. 4 Satz 1, Abs. 5 Satz 1 HGB) für die
 * Vermerke in Jahresabschluss, Hinterlegung und E-Bilanz. Haben schlägt sie je Konto vor (bilanzvermerke.ts in
 * @haben/core), die Nutzerin bestätigt sie; gespeichert je Jahr für den Stichtag und die Vorjahresspalte, mit Audit.
 * Ändert sich danach ein Betrag, ist die Angabe neu zu bestätigen.
 */

export class RestlaufzeitError extends UserError {}

const angabe = z.object({ account: z.string().regex(/^\d{4}$/), ueber1Jahr: z.number().int().min(0).max(100_000_000_000_00) });
export const restlaufzeitenSchema = z.object({
  jahr: z.array(angabe).max(500),
  vorjahr: z.array(angabe).max(500).nullable().default(null),
});
export type RestlaufzeitenInput = z.input<typeof restlaufzeitenSchema>;

const gespeichertSchema = z.object({
  jahr: z.array(z.object({ account: z.string(), betrag: z.number().int(), ueber1Jahr: z.number().int() })),
  vorjahr: z.array(z.object({ account: z.string(), betrag: z.number().int(), ueber1Jahr: z.number().int() })).nullable(),
});

async function gespeichert(year: number): Promise<{ data: z.output<typeof gespeichertSchema>; updatedAt: Date } | null> {
  const [row] = await db.select().from(schema.residualTerms).where(eq(schema.residualTerms.year, year));
  const parsed = row ? gespeichertSchema.safeParse(row.data) : null;
  return row && parsed?.success ? { data: parsed.data, updatedAt: row.updatedAt } : null;
}

/**
 * Offene Rechnungen und Belege zum Stichtag, die erst mehr als ein Jahr danach fällig sind: ausgestellt bzw. datiert bis
 * zum Stichtag, ohne Storno, abzüglich der bis dahin zugeordneten Zahlungen.
 */
async function spaetFaellig(year: number): Promise<SpaetFaellig> {
  const stichtag = `${year}-12-31`;
  const grenze = `${year + 1}-12-31`;
  const [row] = await db.execute<{ forderungen: string; verbindlichkeiten: string }>(sql`
    select
      (select coalesce(sum(greatest(i.gross - coalesce((select sum(a.amount) from allocations a join bank_transactions t on t.id = a.transaction_id
                                                         where a.invoice_id = i.id and t.booking_date <= ${stichtag}), 0), 0)), 0)
         from invoices i
        where i.status = 'final' and i.kind = 'rechnung' and i.issue_date <= ${stichtag} and i.due_date > ${grenze}
          and not exists (select 1 from invoices s where s.corrects_id = i.id and s.kind = 'storno' and s.status = 'final' and s.issue_date <= ${stichtag})
      ) as forderungen,
      (select coalesce(sum(greatest(d.gross + coalesce((select sum(a.amount) from allocations a join bank_transactions t on t.id = a.transaction_id
                                                         where a.document_id = d.id and t.booking_date <= ${stichtag}), 0), 0)), 0)
         from documents d
        where d.status = 'gebucht' and d.payment = 'bank' and d.document_date <= ${stichtag} and d.due_date > ${grenze}
          and not exists (select 1 from document_cancellations c where c.document_id = d.id)
      ) as verbindlichkeiten`);
  return { forderungen: Number(row?.forderungen ?? 0), verbindlichkeiten: Number(row?.verbindlichkeiten ?? 0) };
}

interface Stichtag {
  stichtag: string;
  zeilen: RestlaufzeitZeile[];
  konten: VermerkKonto[];
  stand: RestlaufzeitStand;
  ueber1Jahr: Map<string, Cents>;
  /** Gespeicherte Angabe je Konto, auch wenn sie nicht mehr passt */
  angaben: readonly RestlaufzeitAngabe[] | null;
}

async function stichtag(kontenrahmen: Kontenrahmen, year: number, report: Abschluss, angaben: readonly RestlaufzeitAngabe[] | null): Promise<Stichtag> {
  const zeilen = restlaufzeitZeilen(kontenrahmen, year, report, await spaetFaellig(year));
  return { stichtag: `${year}-12-31`, zeilen, konten: vermerkKonten(kontenrahmen, report), ...restlaufzeitAbgleich(zeilen, angaben), angaben };
}

/**
 * Stand zum Stichtag und für die Vorjahresspalte. Für die Vorjahresspalte gilt, was zum Vorjahr gespeichert ist, wenn
 * dieses Jahr keine eigene Angabe dazu hat: Die Restlaufzeiten zum 31.12. des Vorjahres sind dieselben.
 */
async function stichtage(year: number, kontenrahmen: Kontenrahmen) {
  const { report, vorjahr } = await jahresBilanzen(year, kontenrahmen);
  const eigene = await gespeichert(year);
  const fruehere = vorjahr && !eigene?.data.vorjahr ? await gespeichert(year - 1) : null;
  return {
    jahr: await stichtag(kontenrahmen, year, report, eigene?.data.jahr ?? null),
    vorjahr: vorjahr ? await stichtag(kontenrahmen, year - 1, vorjahr, eigene?.data.vorjahr ?? fruehere?.data.jahr ?? null) : null,
    updatedAt: eigene?.updatedAt ?? null,
  };
}

export interface RestlaufzeitBlock {
  stichtag: string;
  stand: RestlaufzeitStand;
  zeilen: (RestlaufzeitZeile & { name: string; wert: Cents })[];
}

export interface RestlaufzeitenAnsicht {
  jahr: RestlaufzeitBlock;
  vorjahr: RestlaufzeitBlock | null;
  /** Zuletzt bestätigt; null = noch nie */
  bestaetigtAm: Date | null;
}

function block(kontenrahmen: Kontenrahmen, s: Stichtag): RestlaufzeitBlock {
  return {
    stichtag: s.stichtag,
    stand: s.stand,
    zeilen: s.zeilen.map((z) => {
      const alt = s.angaben?.find((a) => a.account === z.account && a.betrag === z.betrag);
      return { ...z, name: accountName(kontenrahmen, z.account), wert: z.eingabe && alt ? alt.ueber1Jahr : z.vorschlag };
    }),
  };
}

/**
 * Die Seite „Jahresabschluss“: Konten mit Vorschlag und gespeichertem Wert; null für Einzelunternehmen und Jahre ohne
 * Forderungen und Verbindlichkeiten. Auch im laufenden Jahr, etwa zum Vorbereiten; jede spätere Buchung, die einen
 * Betrag ändert, verlangt eine neue Bestätigung.
 */
export async function restlaufzeitenAnsicht(year: number): Promise<RestlaufzeitenAnsicht | null> {
  const company = await loadCompany();
  if (!isKapitalgesellschaft(company.rechtsform)) return null;
  const s = await stichtage(year, company.kontenrahmen);
  if (s.jahr.zeilen.length === 0 && (s.vorjahr?.zeilen.length ?? 0) === 0) return null;
  return {
    jahr: block(company.kontenrahmen, s.jahr),
    vorjahr: s.vorjahr && s.vorjahr.zeilen.length > 0 ? block(company.kontenrahmen, s.vorjahr) : null,
    bestaetigtAm: s.updatedAt,
  };
}

/** Prüft die Eingaben gegen die Konten zum Stichtag; liefert, was gespeichert wird */
function pruefe(s: Stichtag, eingaben: readonly { account: string; ueber1Jahr: Cents }[] | null): RestlaufzeitAngabe[] {
  const datum = s.stichtag.split("-").reverse().join(".");
  return s.zeilen
    .filter((z) => z.eingabe)
    .map((z) => {
      const eingabe = eingaben?.find((e) => e.account === z.account);
      if (!eingabe) throw new RestlaufzeitError(`Zum ${datum} fehlt die Restlaufzeit für Konto ${z.account}.`);
      if (eingabe.ueber1Jahr > z.betrag) {
        throw new RestlaufzeitError(`Konto ${z.account} zum ${datum}: Mehr als ein Jahr kann höchstens der ganze Betrag laufen.`);
      }
      return { account: z.account, betrag: z.betrag, ueber1Jahr: eingabe.ueber1Jahr };
    });
}

/** Bestätigt die Restlaufzeiten des Jahres und, falls die Bilanz eine hat, der Vorjahresspalte */
export async function saveRestlaufzeiten(actor: string, year: number, input: RestlaufzeitenInput): Promise<void> {
  const company = await loadCompany();
  if (!isKapitalgesellschaft(company.rechtsform)) throw new RestlaufzeitError("Restlaufzeiten gibt es nur im Jahresabschluss von GmbH und UG.");
  const parsed = restlaufzeitenSchema.parse(input);
  const s = await stichtage(year, company.kontenrahmen);
  const data = { jahr: pruefe(s.jahr, parsed.jahr), vorjahr: s.vorjahr ? pruefe(s.vorjahr, parsed.vorjahr) : null };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.residualTerms)
      .values({ year, data })
      .onConflictDoUpdate({ target: schema.residualTerms.year, set: { data, updatedAt: new Date() } }),
  );
}

const STAND_TEXT: Record<"fehlt" | "geaendert", (datum: string) => string> = {
  fehlt: (datum) => `Die Restlaufzeiten der Forderungen und Verbindlichkeiten zum ${datum} sind noch nicht bestätigt (§ 268 Abs. 4 und 5 HGB).`,
  geaendert: (datum) => `Die Salden zum ${datum} haben sich seit der Bestätigung der Restlaufzeiten geändert; bitte neu bestätigen.`,
};

function mangel(s: Stichtag | null): string[] {
  if (!s || s.stand === "keine" || s.stand === "bestaetigt") return [];
  return [STAND_TEXT[s.stand](s.stichtag.split("-").reverse().join("."))];
}

export interface Vermerke {
  jahr: BilanzVermerk[];
  /** null = keine Vorjahresspalte */
  vorjahr: BilanzVermerk[] | null;
  /** Was für vollständige Vermerke fehlt; leer = vollständig */
  maengel: string[];
}

/** Vermerke für Jahr und Vorjahresspalte; Restlaufzeiten nur, wo bestätigt */
export async function bilanzVermerkeFuer(year: number, kontenrahmen: Kontenrahmen): Promise<Vermerke> {
  const s = await stichtage(year, kontenrahmen);
  const vermerke = (t: Stichtag) => bilanzVermerke(t.konten, t.stand === "bestaetigt" || t.stand === "keine" ? t.ueber1Jahr : null);
  return {
    jahr: vermerke(s.jahr),
    vorjahr: s.vorjahr ? vermerke(s.vorjahr) : null,
    maengel: [...mangel(s.jahr), ...mangel(s.vorjahr)],
  };
}

/** Davon-Positionen der E-Bilanz zum Stichtag; null, solange die Restlaufzeiten nicht bestätigt sind */
export async function ebilanzDavon(year: number, kontenrahmen: Kontenrahmen): Promise<Record<string, Cents> | null> {
  const { jahr } = await stichtage(year, kontenrahmen);
  if (jahr.stand !== "bestaetigt" && jahr.stand !== "keine") return null;
  return ebilanzRestlaufzeiten(kontenrahmen, jahr.konten, jahr.ueber1Jahr);
}
