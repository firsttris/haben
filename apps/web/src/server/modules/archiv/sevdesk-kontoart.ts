import { RANGES } from "@haben/import";
import { sql, type SQL } from "drizzle-orm";
import type { ReconciliationCheck } from "./lexoffice.ts";

/*
 * Gutschriften mit `bookingCategory` ACCOUNTING_TYPE bucht sevDesk nach dem gewählten Konto: mit Erlöskonto als
 * Erlösminderung (DATEV: Soll 8200, BU 3, belegt am DATEV-Export), mit Aufwandskonto analog Honorar (Soll 3100, BU 9) nach der
 * Entscheidung in #472; ein Export dieser Gutschrift mit Aufwandskonto liegt nicht vor.
 * Die Gutschrift nennt nur die ID des Kontos; dessen Nummern stehen im Kontostamm (GET /AccountingType/{id}), den der Abruf
 * in sevdesk_accounting_types ablegt. Die Art folgt zur Laufzeit daraus, die Archivkopie bleibt unverändert.
 *
 * skr03 zählt nach SKR03, skr04 nach SKR04, unabhängig vom Kontenrahmen in Haben. Stimmen beide überein, gilt diese Art; ist
 * nur eine da, deren Art. Sonst, ohne Antwort, ohne Nummer und bei mehreren Antworten mit verschiedener Art: unklar. Ein Konto
 * ohne Nummer wird nicht über `parent` aufgelöst; `type` und `translationCode` entscheiden nichts.
 *
 * Klärt der Kontostamm die Art nicht, legt man sie in der Belegansicht von Hand fest (#888, sevdesk_accounting_type_decisions,
 * die jüngste gilt). Ein Kontostamm mit erkannter Art geht vor, auch wenn er erst später abgerufen wird; widerspricht er der
 * Entscheidung von Hand, bleibt die Gutschrift unklar.
 */

export const ACCOUNTING_TYPE_ISSUE =
  "Buchungskonto nicht erkannt: Ob sevDesk diese Gutschrift als Erlösminderung oder als Aufwand gebucht hat, geht aus den abgerufenen Daten nicht sicher hervor. Haben führt sie wie gespeichert als Minderung der Einnahmen. „Erneut abrufen“ holt das Buchungskonto nach; sonst in sevDesk prüfen und die Kontoart hier festlegen.";

export const ACCOUNTING_TYPE_VAT_ISSUE =
  "Buchungskonto nicht erkannt bei Gutschriften aus sevDesk: Der Monatsabgleich der Umsatzsteuer ist gesperrt, bis „Erneut abrufen“ die Konten klärt oder die Kontoart in der Belegansicht festgelegt ist.";

const ranges = (list: [number, number][]) => `array[${list.map(([from, to]) => `int4range(${from}, ${to}, '[]')`).join(", ")}]`;

/**
 * Art einer Kontonummer wie datevAccountKind mit vierstelligen Sachkonten: 'erloes', 'aufwand', sonst 'sonstig' (auch
 * Steuerkonten, längere Nummern und Text); ohne Nummer null. `value` ist ein SQL-Ausdruck vom Typ text.
 */
export function accountingTypeNumberKind(kontenrahmen: keyof typeof RANGES, value: string): string {
  const { erloese, aufwand } = RANGES[kontenrahmen];
  return `(case when coalesce(${value}, '') = '' then null
    when ${value} !~ '^[0-9]{1,4}$' then 'sonstig'
    when (${value})::int <@ any(${ranges(erloese)}) then 'erloes'
    when (${value})::int <@ any(${ranges(aufwand)}) then 'aufwand'
    else 'sonstig' end)`;
}

/** Art einer gespeicherten Antwort von GET /AccountingType */
function answerKind(raw: string): string {
  return `(select case when k.k03 is null and k.k04 is null then 'unklar'
      when coalesce(k.k03, k.k04) = coalesce(k.k04, k.k03) and coalesce(k.k03, k.k04) in ('erloes', 'aufwand') then coalesce(k.k03, k.k04)
      else 'unklar' end
    from (select ${accountingTypeNumberKind("SKR03", `${raw}->>'skr03'`)} as k03, ${accountingTypeNumberKind("SKR04", `${raw}->>'skr04'`)} as k04) k)`;
}

function isAccountingTypeNote(alias: string): string {
  return `(${alias}.source = 'sevdesk' and ${alias}.lexoffice_id like 'creditnote/%' and upper(coalesce(${alias}.raw->>'bookingCategory', '')) = 'ACCOUNTING_TYPE')`;
}

/** Art aller Antworten zum Konto der Gutschrift, ohne Antwort null; ein späterer Abruf kann einen neuen Stand anhängen */
function stammKind(alias: string): string {
  return `(select case when count(*) = 0 then null when count(distinct sat_kind.kind) = 1 then min(sat_kind.kind) else 'unklar' end
    from (select ${answerKind("sat.raw")} as kind from sevdesk_accounting_types sat
      where sat.accounting_type_id = ${alias}.raw->'accountingType'->>'id') sat_kind)`;
}

/** Jüngste Entscheidung von Hand, sonst null */
function manualKind(alias: string): string {
  return `(select d.kind from sevdesk_accounting_type_decisions d where d.voucher_id = ${alias}.id order by d.created_at desc, d.id desc limit 1)`;
}

/** Erkannter Kontostamm geht vor, ein Widerspruch zur Entscheidung von Hand bleibt unklar; ohne erkannten Kontostamm die Entscheidung */
function noteKind(alias: string): string {
  return `(select case when k.stamm in ('erloes', 'aufwand') then case when k.hand is null or k.hand = k.stamm then k.stamm else 'unklar' end
      else coalesce(k.hand, 'unklar') end
    from (select ${stammKind(alias)} as stamm, ${manualKind(alias)} as hand) k)`;
}

/** Gutschrift auf Buchungskonto mit Aufwandskonto: Ausgabe-Gutschrift wie Honorar (expenseCreditNote) */
export function accountingTypeExpense(alias: string): string {
  return `(${isAccountingTypeNote(alias)} and ${noteKind(alias)} = 'aufwand')`;
}

export function accountingTypeUnclear(alias: string): SQL<boolean> {
  return sql.raw(`coalesce(${isAccountingTypeNote(alias)} and ${noteKind(alias)} = 'unklar', false)`) as SQL<boolean>;
}

export type AccountingKind = "erloes" | "aufwand";

/** Kontostamm (null ohne Antwort) und Entscheidung von Hand einer Gutschrift auf ein Buchungskonto */
export type AccountingTypeKinds = { stamm: AccountingKind | "unklar" | null; hand: AccountingKind | null };

/** Beide Quellen der Kontoart, nur für Gutschriften auf ein Buchungskonto, sonst null */
export function accountingTypeKinds(alias: string): SQL<AccountingTypeKinds | null> {
  return sql.raw(
    `case when ${isAccountingTypeNote(alias)} then json_build_object('stamm', ${stammKind(alias)}, 'hand', ${manualKind(alias)}) end`,
  ) as SQL<AccountingTypeKinds | null>;
}

export const ACCOUNTING_KIND_LABEL: Record<AccountingKind, string> = { erloes: "Erlöskonto", aufwand: "Aufwandskonto" };

const known = (kind: AccountingTypeKinds["stamm"]): kind is AccountingKind => kind === "erloes" || kind === "aufwand";

/** Hinweis der Belegansicht: null, wenn die Kontoart erkannt oder von Hand festgelegt ist; bei Widerspruch nennt er beide */
export function accountingTypeIssue(kinds: AccountingTypeKinds | null): string | null {
  if (!kinds) return null;
  const { stamm, hand } = kinds;
  if (known(stamm) && hand && hand !== stamm)
    return `Buchungskonto nicht erkannt: Der Kontostamm aus sevDesk nennt ein ${ACCOUNTING_KIND_LABEL[stamm]}, von Hand festgelegt ist ein ${ACCOUNTING_KIND_LABEL[hand]}. Haben führt die Gutschrift wie gespeichert als Minderung der Einnahmen, bis beide übereinstimmen. In sevDesk prüfen und die Kontoart hier passend festlegen.`;
  return known(stamm) || hand ? null : ACCOUNTING_TYPE_ISSUE;
}

/** Festlegen geht, solange die Kontoart unklar ist oder nur von Hand feststeht; ein erkannter Kontostamm entscheidet selbst */
export function accountingTypeDecidable(kinds: AccountingTypeKinds | null): boolean {
  return kinds !== null && (!known(kinds.stamm) || (kinds.hand !== null && kinds.hand !== kinds.stamm));
}

/**
 * Gutschriften ohne erkannte Kontoart, die ein Jahr betreffen: Ob sie in Kz 81 oder Kz 66 gehören, ist offen. Gezählt im
 * Jahr des Belegs und bei Ist-Versteuerung auch in den Jahren der Zahlungen (`payments`).
 */
export function unclearAccountingTypes<T extends { accountingTypeUnclear: boolean; date: string }>(
  rows: T[],
  year: number,
  payments: (row: T) => { date: string }[],
): number {
  const inYear = (date: string) => date.startsWith(`${year}-`);
  return rows.filter((v) => v.accountingTypeUnclear && (inYear(v.date) || payments(v).some((p) => inYear(p.date)))).length;
}

/** Punkt im Abgleich: Ein Jahr ist erst vollständig, wenn jede Gutschrift ihre Kontoart hat */
export function accountingTypeChecks(unclear: number): ReconciliationCheck[] {
  if (unclear === 0) return [];
  return [{ ok: false, label: "Buchungskonto jeder Gutschrift erkannt", detail: `${unclear} ${unclear === 1 ? "Gutschrift" : "Gutschriften"} aus sevDesk` }];
}
