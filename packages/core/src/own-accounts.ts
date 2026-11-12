import { ASSET_ACCOUNT_NAMES, ASSET_ACCOUNTS } from "./afa.ts";
import { DARLEHEN_KONTEN } from "./darlehen.ts";
import { EBILANZ_KONTEN } from "./ebilanz.ts";
import { GEWST_HINZURECHNUNG_KONTEN, KAPG_STEUER_KONTEN } from "./koerperschaft.ts";
import { LOHN_KONTEN } from "./lohn-buchung.ts";
import { ledgerManagedAccounts, SACHENTNAHME_FRUEHERE_KONTEN, SACHENTNAHME_KONTEN } from "./manual.ts";
import { PAUSCHALE_KONTEN } from "./pauschalen.ts";
import { ACCOUNT_NAMES, ACCOUNTS, EXPENSE_CATEGORIES, type ExpenseCategory, type Kontenrahmen } from "./posting.ts";
import { PRIVATE_USE_ACCOUNT_NAMES, PRIVATE_USE_ACCOUNTS } from "./private-use.ts";
import { STEUER_KONTEN } from "./steuerzahlung.ts";
import { VORTRAG_ACCOUNTS } from "./vortrag.ts";

/*
 * Eigene Sachkonten (#270, Stufe 1): ein Aufwandskonto mit eigener Nummer und eigenem Namen. Für Steuer, EÜR und E-Bilanz
 * zählt es wie seine Elternkategorie; die Auswertungen nach Kontonummer lösen es vorher auf deren Konto auf. Nummer und
 * Elternkategorie prüft dieselbe Regel beim Anlegen, im Server und in der Oberfläche.
 */

/** Kategorien, die kein Aufwand eines eigenen Kontos sein können: keine Aufwandsbuchung, eigene Behandlung oder Wareneinsatz */
const EXCLUDED_PARENTS: readonly ExpenseCategory[] = ["anlage", "hardware", "einfuhrumsatzsteuer", "geldverkehr", "wareneinkauf", "fremdleistung", "kfzSteuer"];

/** Aufwandsklasse des Kontenrahmens: SKR03 4000 bis 4999 (Betriebliche Aufwendungen), SKR04 6000 bis 6999 (sonstige betriebliche Aufwendungen) */
const CLASS_PREFIX: Record<Kontenrahmen, string> = { SKR03: "4", SKR04: "6" };
const CLASS_RANGE: Record<Kontenrahmen, string> = { SKR03: "4000 bis 4999", SKR04: "6000 bis 6999" };

/** Elternkategorien, die ein eigenes Konto im Kontenrahmen haben darf: Aufwand mit Konto in der Aufwandsklasse */
export function ownAccountParents(kontenrahmen: Kontenrahmen): ExpenseCategory[] {
  return (Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[]).filter(
    (kategorie) => !EXCLUDED_PARENTS.includes(kategorie) && EXPENSE_CATEGORIES[kategorie][kontenrahmen].startsWith(CLASS_PREFIX[kontenrahmen]),
  );
}

/** Alle vierstelligen Nummern in Schlüsseln und Werten; unter einem Schlüssel SKR03 oder SKR04 nur für diesen Rahmen */
function collect(value: unknown, into: Record<Kontenrahmen, Set<string>>, only?: Kontenrahmen): void {
  const add = (nummer: string) => {
    if (!/^\d{4}$/.test(nummer)) return;
    for (const kr of only ? [only] : (["SKR03", "SKR04"] as const)) into[kr].add(nummer);
  };
  if (typeof value === "string") {
    add(value);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, inner] of Object.entries(value)) {
    add(key);
    collect(inner, into, key === "SKR03" || key === "SKR04" ? key : only);
  }
}

const reservedCache: Partial<Record<Kontenrahmen, ReadonlySet<string>>> = {};

/**
 * Nummern, die Haben für eigene Zwecke belegt: die Konten der Kategorien, der Buchungen (Bank, Erlöse, Steuer, Lohn, Privat,
 * Gesellschafter, Darlehen, Pauschalen, Anlagen, Körperschaftsteuer) und alle Konten mit Namen oder E-Bilanz-Zuordnung.
 * Ein eigenes Konto darf keine davon nehmen, sonst deutete es bestehende Buchungen um.
 */
export function reservedAccountNumbers(kontenrahmen: Kontenrahmen): ReadonlySet<string> {
  const cached = reservedCache[kontenrahmen];
  if (cached) return cached;
  const into: Record<Kontenrahmen, Set<string>> = { SKR03: new Set(), SKR04: new Set() };
  for (const quelle of [
    ACCOUNTS,
    ACCOUNT_NAMES,
    EXPENSE_CATEGORIES,
    ASSET_ACCOUNTS,
    ASSET_ACCOUNT_NAMES,
    PRIVATE_USE_ACCOUNTS,
    PRIVATE_USE_ACCOUNT_NAMES,
    PAUSCHALE_KONTEN,
    LOHN_KONTEN,
    STEUER_KONTEN,
    DARLEHEN_KONTEN,
    KAPG_STEUER_KONTEN,
    GEWST_HINZURECHNUNG_KONTEN,
    SACHENTNAHME_KONTEN,
    SACHENTNAHME_FRUEHERE_KONTEN,
    VORTRAG_ACCOUNTS,
    EBILANZ_KONTEN,
  ]) {
    collect(quelle, into);
  }
  // Was das Hauptbuch selbst bebucht (Bank, Kasse, Forderungen, Verbindlichkeiten, Steuer, Anlagen), je Kontenrahmen
  for (const nummer of ledgerManagedAccounts(kontenrahmen).keys()) if (/^\d{4}$/.test(nummer)) into[kontenrahmen].add(nummer);
  reservedCache[kontenrahmen] = into[kontenrahmen];
  return into[kontenrahmen];
}

export interface OwnAccountInput {
  kontenrahmen: Kontenrahmen;
  account: string;
  name: string;
  parentCategory: ExpenseCategory;
}

export const OWN_ACCOUNT_NAME_MAX = 80;

/** Warum ein eigenes Konto so nicht angelegt werden kann; null, wenn es geht. Ob das Journal die Nummer schon kennt, prüft der Server. */
export function ownAccountProblem(input: OwnAccountInput): string | null {
  const { kontenrahmen, account, name, parentCategory } = input;
  if (!/^\d{4}$/.test(account)) return "Die Kontonummer hat genau vier Ziffern.";
  if (!account.startsWith(CLASS_PREFIX[kontenrahmen])) return `Im ${kontenrahmen} liegen Aufwandskonten von ${CLASS_RANGE[kontenrahmen]}.`;
  if (reservedAccountNumbers(kontenrahmen).has(account)) return `Das Konto ${account} ist in Haben schon belegt.`;
  // Zeichen wie die Datenbank zählt (length), nicht UTF-16-Einheiten
  const nameLength = Array.from(name.trim()).length;
  if (nameLength === 0 || nameLength > OWN_ACCOUNT_NAME_MAX) return `Der Name fehlt oder ist länger als ${OWN_ACCOUNT_NAME_MAX} Zeichen.`;
  if (!ownAccountParents(kontenrahmen).includes(parentCategory)) return "Diese Elternkategorie kann kein eigenes Konto haben.";
  return null;
}

/** Das Konto, mit dem Steuer, EÜR und E-Bilanz rechnen: bei einem eigenen Konto das seiner Elternkategorie, sonst unverändert */
export function resolveOwnAccount(kontenrahmen: Kontenrahmen, account: string, eigene: ReadonlyMap<string, ExpenseCategory>): string {
  const parent = eigene.get(account);
  // Eine Elternkategorie, die es nicht mehr gibt, lässt das Konto, wie es ist, statt jede Auswertung abbrechen zu lassen
  return parent && parent in EXPENSE_CATEGORIES ? EXPENSE_CATEGORIES[parent][kontenrahmen] : account;
}
