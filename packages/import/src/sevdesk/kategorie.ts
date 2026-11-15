import { ACCOUNT_NAMES, ACCOUNTS, DARLEHEN_KONTEN, EXPENSE_CATEGORIES, KAPG_STEUER_KONTEN, type ExpenseCategory } from "@haben/core";
import { RANGES, type Kontenrahmen } from "../datev.ts";

/*
 * Kategorie einer Beleg-Position aus sevDesk (#472). Die Position nennt nur die ID ihres Buchungskontos, dessen Nummern
 * stehen im Kontostamm (GET /AccountingType/{id}): skr03 nach SKR03, skr04 nach SKR04, unabhängig vom Kontenrahmen in
 * Haben. Eingeordnet wird nach der Nummer, nicht nach dem Namen, den man in sevDesk frei vergeben kann:
 *
 * - Aufwandskonto einer Ausgabenkategorie von Haben (EXPENSE_CATEGORIES, genau die Nummer): diese Kategorie. Anlagegut und
 *   Einfuhrumsatzsteuer nicht, sie brauchen Anlagenverzeichnis bzw. Bescheid.
 * - Gesellschafter-Verrechnungskonto, Gezeichnetes Kapital, Darlehen (Konten wie in darlehen.ts), Steuern vom Einkommen
 *   und Ertrag (koerperschaft.ts), Privatentnahmen, -einlagen und Privatsteuern (DATEV-Kontenrahmen 2026: SKR03 1800, 1890,
 *   1810; SKR04 2100, 2180, 2150): Name des DATEV-Kontos. legacyNeutralKind ordnet ihn bei GmbH und UG ein wie den Namen
 *   einer Kategorie aus Lexoffice; im Einzelunternehmen zählt dort weiter nur das Kennzeichen `privat`.
 * - Erlöskonto nach den Kontenbereichen des DATEV-Imports (RANGES): „Erlöse“.
 *
 * Stehen beide Nummern da, müssen sie dasselbe ergeben; eine nicht erkannte Nummer zählt als eigenes Ergebnis. Mehrere
 * Antworten zum selben Konto (spätere Abrufe) müssen ebenso übereinstimmen. Sonst, ohne Antwort und ohne Nummer: null, die
 * Position bleibt „Sonstiges“ wie vor #472.
 */

export type SevAccountCategory =
  | { art: "ausgabe"; kategorie: ExpenseCategory; name: string }
  | { art: "neutral"; name: string }
  | { art: "erloes"; name: string };

/** Felder des Kontostamms, die zählen */
export type SevAccountNumbers = { skr03?: string | null; skr04?: string | null };

const SKIP: readonly ExpenseCategory[] = ["anlage", "einfuhrumsatzsteuer"];

const NEUTRAL_NAMES = {
  gesellschafter: "Verbindlichkeiten gegenüber Gesellschaftern",
  kapital: "Gezeichnetes Kapital",
  darlehen: "Darlehen",
  kst: "Körperschaftsteuer",
  soli: "Solidaritätszuschlag",
  gewst: "Gewerbesteuer",
  entnahme: "Privatentnahmen",
  einlage: "Privateinlagen",
  privatsteuern: "Privatsteuern",
} as const;

type NeutralKey = keyof typeof NEUTRAL_NAMES;

/** Neutrale Konten je Kontenrahmen: Nummer → Art */
const NEUTRAL: Record<Kontenrahmen, Map<string, NeutralKey>> = {
  SKR03: neutralAccounts("SKR03", { kapital: "0800", privatsteuern: "1810" }),
  SKR04: neutralAccounts("SKR04", { kapital: "2900", privatsteuern: "2150" }),
};

function neutralAccounts(kr: Kontenrahmen, own: { kapital: string; privatsteuern: string }): Map<string, NeutralKey> {
  const out = new Map<string, NeutralKey>();
  // Verbindlichkeiten gegenüber Gesellschaftern samt Restlaufzeiten, wie in ACCOUNT_NAMES
  for (const [account, name] of Object.entries(ACCOUNT_NAMES[kr])) if (name.startsWith(NEUTRAL_NAMES.gesellschafter)) out.set(account, "gesellschafter");
  out.set(own.kapital, "kapital");
  out.set(ACCOUNTS[kr].privatentnahmen, "entnahme");
  out.set(ACCOUNTS[kr].privateinlagen, "einlage");
  out.set(own.privatsteuern, "privatsteuern");
  const darlehen = DARLEHEN_KONTEN[kr];
  for (const account of [...Object.values(darlehen.bank), ...Object.values(darlehen.sonstige)]) out.set(account, "darlehen");
  const steuer = KAPG_STEUER_KONTEN[kr];
  for (const account of [...steuer.kst, ...steuer.kstVorjahre]) out.set(account, "kst");
  for (const account of [...steuer.soli, ...steuer.soliWeitere]) out.set(account, "soli");
  for (const account of [...steuer.gewst, ...steuer.gewstVorjahre]) out.set(account, "gewst");
  return out;
}

/** Ergebnis einer Nummer als Schlüssel zum Vergleich; "?" = nicht erkannt, null = keine Nummer */
function numberKey(kr: Kontenrahmen, value: string | null | undefined): string | null {
  const account = (value ?? "").trim();
  if (account === "") return null;
  if (!/^[0-9]{1,4}$/.test(account)) return "?";
  const padded = account.padStart(4, "0");
  for (const [key, accounts] of Object.entries(EXPENSE_CATEGORIES) as [ExpenseCategory, (typeof EXPENSE_CATEGORIES)[ExpenseCategory]][]) {
    if (!SKIP.includes(key) && accounts[kr] === padded) return `ausgabe:${key}`;
  }
  const neutral = NEUTRAL[kr].get(padded);
  if (neutral) return `neutral:${neutral}`;
  const n = Number(padded);
  if (RANGES[kr].erloese.some(([from, to]) => n >= from && n <= to)) return "erloes";
  return "?";
}

function fromKey(key: string): SevAccountCategory | null {
  if (key === "erloes") return { art: "erloes", name: "Erlöse" };
  const [art, rest] = key.split(":") as [string, string];
  if (art === "ausgabe") return { art, kategorie: rest as ExpenseCategory, name: EXPENSE_CATEGORIES[rest as ExpenseCategory].label };
  if (art === "neutral") return { art, name: NEUTRAL_NAMES[rest as NeutralKey] };
  return null;
}

/** Kategorie aus allen gespeicherten Antworten zu einem Konto; null = unklar, die Position bleibt „Sonstiges“ */
export function sevAccountCategory(answers: readonly SevAccountNumbers[]): SevAccountCategory | null {
  const keys = new Set<string>();
  for (const answer of answers) {
    const own = [numberKey("SKR03", answer.skr03), numberKey("SKR04", answer.skr04)].filter((k): k is string => k !== null);
    if (own.length === 0) return null;
    for (const k of own) keys.add(k);
  }
  if (keys.size !== 1) return null;
  return fromKey([...keys][0]!);
}
