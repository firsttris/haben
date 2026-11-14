import { normalizeUstId, PERSONENKONTO_LABEL, type PersonenkontoRolle } from "@haben/core";
import type { DatevGpRow } from "../datev-stammdaten.ts";
import type { ContactRow } from "./contacts.ts";
import { duplicateKey, type RowCandidate } from "./plan.ts";

/*
 * Kontakte aus DATEV-Stammdaten „Debitoren/Kreditoren“ (docs/csv-import.md, „Kontakte aus DATEV“, #472). Anders als
 * beim CSV-Import ist das Personenkonto der Schlüssel: Ein zweiter Import findet jede Nummer am Kontakt wieder und ändert
 * nichts. Derselbe Partner ist ein Debitor und ein Kreditor der Datei mit gleicher USt-IdNr. oder Steuernummer; der Name
 * allein führt nicht zusammen (#327), denn zwei Kunden dürfen gleich heißen. Einem Kontakt in Haben ohne Personenkonto
 * gibt der Import eine Nummer nur nach Bestätigung in der Vorschau, und nie eine, die schon ein anderer Kontakt trägt.
 */

export interface DatevContactCandidate extends RowCandidate<ContactRow> {
  /** Zeilen der Datei, aus denen der Kontakt entsteht: eine, oder Debitor und Kreditor */
  lines: number[];
  /** Hinweise für die Vorschau, etwa warum zwei Zeilen ein Kontakt sind */
  hints: string[];
  /** Dasselbe Personenkonto steht weiter oben in der Datei */
  duplicateOf: string | null;
}

/** Kontakt in Haben, gegen den geplant wird; `…Fest`: die Nummer steht schon in einem DATEV-Export (datev_personenkonten) */
export interface DatevStockContact {
  id: string;
  name: string;
  kundennummer: string | null;
  ustId: string;
  debitorNr: number | null;
  kreditorNr: number | null;
  debitorFest: boolean;
  kreditorFest: boolean;
  archived: boolean;
}

type Numbers = Pick<ContactRow, "name" | "ustId" | "kundennummer"> & { debitorNr?: number | null; kreditorNr?: number | null };

interface PlanBase {
  line: number;
  lines: number[];
  title: string;
}

export type DatevContactPlan<T> =
  | (PlanBase & { status: "neu"; value: T; message: string | null })
  | (PlanBase & { status: "zuordnen"; value: null; message: string; assign: { contactId: string; debitorNr: number | null; kreditorNr: number | null } })
  | (PlanBase & { status: "dublette" | "fehler"; value: null; message: string });

const ROLLEN = ["debitor", "kreditor"] as const;
const nrOf = (c: Numbers | DatevStockContact, rolle: PersonenkontoRolle) => (rolle === "debitor" ? c.debitorNr : c.kreditorNr) ?? null;
const konto = (rolle: PersonenkontoRolle, nr: number) => `${PERSONENKONTO_LABEL[rolle]} ${nr}`;
const sameText = (a: string | null, b: string | null) => Boolean(a?.trim()) && a?.trim().toLowerCase() === b?.trim().toLowerCase();
const sameUstId = (a: string, b: string) => Boolean(a) && normalizeUstId(a) === normalizeUstId(b);
const steuernummer = (row: DatevGpRow) => row.steuernummer.replace(/\D/g, "");

/** Was am Kontakt steht; der Debitor bringt die Kundennummer, was „Kundennummer“ am Kreditor meint, ist nicht belegt */
function contactRow(rows: DatevGpRow[]): ContactRow {
  const field = (key: "name" | "email" | "telefon" | "ustId" | "iban") => rows.find((r) => r[key])?.[key] ?? "";
  // Die Anschrift samt Land aus einer Zeile: Ein leeres Land liest der Parser als DE, gemischt hieße Paris dann Deutschland
  const address = rows.find((r) => r.strasse || r.plz || r.ort) ?? rows[0]!;
  const debitor = rows.find((r) => r.rolle === "debitor");
  const kreditor = rows.find((r) => r.rolle === "kreditor");
  return {
    kundennummer: debitor?.kundennummer ?? "",
    lieferantennummer: "",
    name: field("name"),
    strasse: address.strasse,
    plz: address.plz,
    ort: address.ort,
    land: address.land,
    email: field("email"),
    telefon: field("telefon"),
    ustId: field("ustId"),
    iban: field("iban"),
    leitwegId: "",
    isCustomer: Boolean(debitor),
    isSupplier: Boolean(kreditor),
    debitorNr: debitor?.nr ?? null,
    kreditorNr: kreditor?.nr ?? null,
  };
}

/** Zu jedem Kreditor der erste noch freie Debitor mit gleicher USt-IdNr. oder Steuernummer */
function pairs(rows: DatevGpRow[]): Map<DatevGpRow, { partner: DatevGpRow; reason: string }> {
  const paired = new Map<DatevGpRow, { partner: DatevGpRow; reason: string }>();
  for (const kreditor of rows.filter((r) => r.rolle === "kreditor")) {
    const debitor = rows.find(
      (d) =>
        d.rolle === "debitor" &&
        !paired.has(d) &&
        (sameUstId(d.ustId, kreditor.ustId) || (steuernummer(d) !== "" && steuernummer(d) === steuernummer(kreditor))),
    );
    if (!debitor) continue;
    const reason = sameUstId(debitor.ustId, kreditor.ustId) ? `gleiche USt-IdNr. ${debitor.ustId}` : "gleiche Steuernummer";
    paired.set(debitor, { partner: kreditor, reason });
    paired.set(kreditor, { partner: debitor, reason });
  }
  return paired;
}

/** Land der USt-IdNr. nach ISO 3166-1: EL ist Griechenland, XI Nordirland; EU (OSS) hat keins */
const ustIdLand = (ustId: string): string | null => {
  const prefix = ustId.slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(prefix) || prefix === "EU") return null;
  return ({ EL: "GR", XI: "GB" } as Record<string, string>)[prefix] ?? prefix;
};

function landHint(land: string, ustId: string): string | null {
  const expected = ustIdLand(ustId);
  return expected && expected !== land ? `Land ${land} passt nicht zur USt-IdNr. aus ${ustId.slice(0, 2).toUpperCase()}; bitte das Land prüfen` : null;
}

export function datevContactCandidates(rows: readonly DatevGpRow[]): DatevContactCandidate[] {
  const seen = new Map<number, number>();
  const duplicates = new Map<DatevGpRow, string>();
  for (const row of rows) {
    if (row.errors.length > 0 || row.nr === null || row.rolle === null) continue;
    const first = seen.get(row.nr);
    if (first === undefined) seen.set(row.nr, row.line);
    else duplicates.set(row, `Wie Zeile ${first} (${konto(row.rolle, row.nr)})`);
  }
  const usable = rows.filter((r) => r.errors.length === 0 && r.rolle !== null && !duplicates.has(r));
  const paired = pairs(usable);
  const names = new Map<string, number>();
  const candidates: DatevContactCandidate[] = [];
  for (const row of rows) {
    const pair = paired.get(row);
    if (pair && pair.partner.line < row.line) continue;
    const group = pair ? [row, pair.partner].sort((a, b) => a.line - b.line) : [row];
    const lines = group.map((r) => r.line);
    const base = { line: row.line, lines, title: row.name || "(ohne Name)", keys: [], hints: [] as string[], duplicateOf: duplicates.get(row) ?? null };
    if (row.errors.length > 0 || row.rolle === null || base.duplicateOf) {
      candidates.push({ ...base, value: null, errors: row.errors });
      continue;
    }
    const value = contactRow([...group].sort((a, b) => (a.rolle === "debitor" ? -1 : b.rolle === "debitor" ? 1 : 0)));
    if (pair) {
      const [d, k] = [value.debitorNr!, value.kreditorNr!];
      base.hints.push(`${konto("debitor", d)} und ${konto("kreditor", k)}: ${pair.reason}`);
      const other = group.find((r) => r.name !== value.name);
      if (other) base.hints.push(`Name in Zeile ${other.line}: „${other.name}“`);
    }
    const land = landHint(value.land, value.ustId);
    if (land) base.hints.push(land);
    const key = value.name.trim().toLowerCase();
    const sameName = names.get(key);
    if (sameName !== undefined) base.hints.push(`Gleicher Name wie Zeile ${sameName}; ohne gleiche USt-IdNr. oder Steuernummer ein eigener Kontakt`);
    else names.set(key, row.line);
    const keys = ROLLEN.flatMap((r) => duplicateKey(PERSONENKONTO_LABEL[r], nrOf(value, r)?.toString()));
    candidates.push({ ...base, title: value.name, keys, value, errors: [] });
  }
  return candidates;
}

const numbersOf = (value: Numbers) => ROLLEN.flatMap((rolle) => (nrOf(value, rolle) === null ? [] : [{ rolle, nr: nrOf(value, rolle)! }]));
const named = (c: DatevStockContact) => `„${c.name}“${c.archived ? " (archiviert)" : ""}`;
const fest = (c: DatevStockContact, rolle: PersonenkontoRolle) => (rolle === "debitor" ? c.debitorFest : c.kreditorFest);

/** Hat der Kontakt für eine der Rollen schon eine andere Nummer? Dann bleibt sie; die Meldung sagt, ob sie exportiert ist */
function otherNumber(c: DatevStockContact, wanted: { rolle: PersonenkontoRolle; nr: number }[], prefix: string): string | null {
  const clash = wanted.find(({ rolle, nr }) => nrOf(c, rolle) !== null && nrOf(c, rolle) !== nr);
  if (!clash) return null;
  const own = konto(clash.rolle, nrOf(c, clash.rolle)!);
  return fest(c, clash.rolle)
    ? `${prefix} hat schon ${own}; er steht in einem DATEV-Export und bleibt fest`
    : `${prefix} hat schon ${own}; ändere ihn dort, wenn die Datei recht hat`;
}

type StockResult =
  | { status: "fehler" | "dublette"; message: string }
  | { status: "zuordnen-an"; contact: DatevStockContact; why: string }
  | { status: "neu-hinweis"; hint: string | null };

/** Ein Partner gegen den Bestand: Nummer schon da, Kontakt zum Bestätigen, Konflikt oder neu */
function againstStock(value: Numbers, stock: readonly DatevStockContact[]): StockResult {
  const wanted = numbersOf(value);
  const owners = [...new Set(wanted.flatMap(({ rolle, nr }) => stock.filter((c) => nrOf(c, rolle) === nr)))];
  if (owners.length > 1) {
    const text = wanted.map(({ rolle, nr }, i) => `${konto(rolle, nr)}${i === 0 ? " hat schon" : ""} ${named(owners.find((c) => nrOf(c, rolle) === nr)!)}`);
    return { status: "fehler", message: text.join(", ") };
  }
  const [owner] = owners;
  if (owner) {
    if (owner.ustId && value.ustId && !sameUstId(owner.ustId, value.ustId)) {
      const [first] = wanted.filter(({ rolle, nr }) => nrOf(owner, rolle) === nr);
      return { status: "fehler", message: `${konto(first!.rolle, first!.nr)} hat schon ${named(owner)} mit anderer USt-IdNr. (${owner.ustId})` };
    }
    const clash = otherNumber(owner, wanted, named(owner));
    if (clash) return { status: "fehler", message: clash };
    const missing = wanted.filter(({ rolle }) => nrOf(owner, rolle) === null);
    if (missing.length === 0)
      return { status: "dublette", message: `Gibt es schon (${named(owner)}, ${wanted.map(({ rolle, nr }) => konto(rolle, nr)).join(" und ")})` };
    const has = wanted.filter(({ rolle }) => nrOf(owner, rolle) !== null).map(({ rolle, nr }) => konto(rolle, nr));
    return { status: "zuordnen-an", contact: owner, why: `hat ${has.join(" und ")}` };
  }
  const matches = stock.filter((c) => sameUstId(c.ustId, value.ustId) || sameText(c.kundennummer, value.kundennummer));
  if (matches.length > 1) {
    return {
      status: "fehler",
      message: `USt-IdNr. bzw. Kundennummer passen zu mehreren Kontakten (${matches.map((c) => `„${c.name}“`).join(", ")}); trage die Nummer dort von Hand ein`,
    };
  }
  const [match] = matches;
  if (match) {
    const byUstId = sameUstId(match.ustId, value.ustId);
    // Zwei verschiedene USt-IdNr. sind zwei Unternehmer, auch bei gleicher Kundennummer; wie beim vergebenen Personenkonto
    if (!byUstId && match.ustId && value.ustId) {
      return { status: "fehler", message: `${named(match)} mit gleicher Kundennummer hat eine andere USt-IdNr. (${match.ustId})` };
    }
    const clash = otherNumber(match, wanted, `${named(match)} mit gleicher ${byUstId ? "USt-IdNr." : "Kundennummer"}`);
    if (clash) return { status: "fehler", message: clash };
    return { status: "zuordnen-an", contact: match, why: `gleiche ${byUstId ? "USt-IdNr." : "Kundennummer"}` };
  }
  const sameName = stock.find((c) => sameText(c.name, value.name));
  return { status: "neu-hinweis", hint: sameName ? `Gleicher Name wie ${named(sameName)} in Haben; eigener Kontakt` : null };
}

/**
 * Plan je Partner. `zuordnen` gibt einem vorhandenen Kontakt die fehlenden Nummern (und die Rolle dazu), aber nur, wenn
 * die Vorschau es bestätigt; je Kontakt höchstens ein Vorschlag, damit zwei Zeilen ihn nicht gegeneinander ändern.
 */
export function planDatevContacts<T extends Numbers>(
  candidates: readonly (Omit<DatevContactCandidate, "value"> & { value: T | null })[],
  stock: readonly DatevStockContact[],
): DatevContactPlan<T>[] {
  const proposed = new Map<string, number>();
  return candidates.map((c): DatevContactPlan<T> => {
    const base = { line: c.line, lines: c.lines, title: c.title };
    const withHints = (message: string | null) => [message, ...c.hints].filter(Boolean).join("; ") || null;
    if (c.duplicateOf) return { ...base, status: "dublette", value: null, message: c.duplicateOf };
    if (c.errors.length > 0 || c.value === null) return { ...base, status: "fehler", value: null, message: c.errors.join("; ") };
    const planned = againstStock(c.value, stock);
    if (planned.status === "neu-hinweis") return { ...base, status: "neu", value: c.value, message: withHints(planned.hint) };
    if (planned.status !== "zuordnen-an") return { ...base, status: planned.status, value: null, message: planned.message };
    const earlier = proposed.get(planned.contact.id);
    if (earlier !== undefined)
      return {
        ...base,
        status: "fehler",
        value: null,
        message: `„${planned.contact.name}“ bekommt schon die Nummer aus Zeile ${earlier}; trage diese von Hand ein`,
      };
    proposed.set(planned.contact.id, c.line);
    const missing = numbersOf(c.value).filter(({ rolle }) => nrOf(planned.contact, rolle) === null);
    const assign = { contactId: planned.contact.id, debitorNr: null as number | null, kreditorNr: null as number | null };
    for (const { rolle, nr } of missing) assign[`${rolle}Nr`] = nr;
    const message = `${missing.map(({ rolle, nr }) => konto(rolle, nr)).join(" und ")} an ${named(planned.contact)} vergeben (${planned.why})`;
    return { ...base, status: "zuordnen", value: null, message: withHints(message)!, assign };
  });
}
