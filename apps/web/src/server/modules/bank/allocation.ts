// Zuordnung eines Umsatzes: Arten, Schemata und Buchung eines Teils, auch als Aufteilung
import { insertAllocation } from "./settlement-store.ts";
import { randomUUID } from "node:crypto";
import { BankError } from "./bank-error.ts";
import {
  ACCOUNTS,
  paymentProviderAccount,
  type Kontenrahmen,
  type Cents,
  formatEuro,
  type LohnZahlung,
  lohnZahlungKonto,
  directPosting,
  privatKontoPosting,
  exchangeDifferenceBankPosting,
  isKapitalgesellschaft,
  isLohnZahlung,
  aufKontoAngeboten,
  aufRechtsformAngeboten,
  type DirectBooking,
  type PostingLine,
  inCents,
} from "@haben/core";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import type { Tx } from "../../db/index.ts";
import { offeneLohnverbindlichkeit } from "../lohn/index.ts";
import { freigabeNachziehen } from "../umsatzsteuer/index.ts";
import { assertUstvaOffen } from "../umsatzsteuer/index.ts";
import { steuerangabeSchema, steuerbuchung } from "./steuerzahlung.ts";
import { darlehenBuchung, loanPartSchema } from "./darlehen.ts";
import { aufladungBuchung, kategorieAngabeSchema, kategoriebuchung } from "./direkt-kategorie.ts";
import { documentBooking, invoiceBooking, type LockedTransaction, lockTransaction, returnBooking, type Zuordnungsziel } from "./payment-booking.ts";

/**
 * Buchungszeilen eines Umsatzes auf das richtige Geldkonto: Bank (1200/1800) bzw. beim Zahlungsdienstleister dessen
 * Verrechnungskonto (1361 … bzw. 1461 …). Die Buchungsfunktionen in @haben/core buchen immer auf die Bank.
 */
export function onLedger(lines: PostingLine[], kontenrahmen: Kontenrahmen, ledgerIndex: number | null): PostingLine[] {
  if (ledgerIndex === null) return lines;
  const bank = ACCOUNTS[kontenrahmen].bank;
  const ledger = paymentProviderAccount(kontenrahmen, ledgerIndex);
  return lines.map((l) => (l.account === bank ? { ...l, account: ledger } : l));
}

const DIRECT_KINDS = [
  "privat",
  "spende",
  "geldtransit",
  "ustVorauszahlung",
  "sondervorauszahlung",
  "gebuehren",
  "mahnerloes",
  "kapest",
  "lohn",
  "lohnsteuer",
  "sozialversicherung",
  "zinsertrag",
] as const;

/**
 * Aufladung eines Guthabens (#1356): eine direkte Zuordnungsart wie „kategorie“, aber mit Pflicht-Kostenkategorie und
 * ohne Steuersatz: Die Aufladung selbst trägt keine Umsatzsteuer (§ 3 Abs. 15 UStG), und Vorsteuer entsteht erst mit der
 * Rechnung über die Leistung (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 2 UStG). Sie steht neben
 * den zwölf in DIRECT_KINDS und nicht darin: Die Zuordnungs-Schemata sind eine `discriminatedUnion`, und dort darf jeder
 * Wert nur einmal vorkommen — die Aufladung trägt zusätzlich die Kategorie.
 */
const AUFLADUNG_KIND = "aufladung" as const;

/**
 * Eine Lohnzahlung tilgt nur, was die Lohnabrechnung als Verbindlichkeit gebucht hat, wie eine Zahlung den offenen Betrag
 * eines Belegs: ein Ausgang höchstens die offene Verbindlichkeit, ein Eingang höchstens eine Überzahlung. Im
 * Einzelunternehmen zählte ein Betrag darüber hinaus in der EÜR als Personalausgabe, etwa eine Entnahme des Inhabers.
 */
async function assertLohnOffen(tx: Tx, kind: LohnZahlung, amount: Cents, kontenrahmen: Kontenrahmen): Promise<void> {
  const konto = lohnZahlungKonto(kind, kontenrahmen);
  const offen = await offeneLohnverbindlichkeit(tx, konto, kontenrahmen);
  if (Math.sign(-amount) === Math.sign(offen) && Math.abs(amount) <= Math.abs(offen)) return;
  if (amount > 0) {
    throw new BankError(
      offen < 0
        ? `Auf Konto ${konto} ist nur ${formatEuro(-offen)} überzahlt; mehr kann ein Eingang nicht erstatten.`
        : `Ein Eingang erstattet nur eine Überzahlung; auf Konto ${konto} ist nichts überzahlt.`,
    );
  }
  if (offen > 0) throw new BankError(`Auf Konto ${konto} ist nur noch ${formatEuro(offen)} offen.`);
  throw new BankError(
    `Auf Konto ${konto} ist nichts offen. Lohnzahlungen lassen sich erst zuordnen, wenn eine Lohnabrechnung festgeschrieben ist (Personal › Lohn).`,
  );
}

export const allocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invoice"), transactionId: z.uuid(), invoiceId: z.uuid(), amount: inCents(z.number().int()) }),
  z.object({ kind: z.literal("document"), transactionId: z.uuid(), documentId: z.uuid(), amount: inCents(z.number().int()) }),
  // Zahllast oder Erstattung einer abgegebenen Voranmeldung: gebucht wie „Umsatzsteuer an das Finanzamt“, mit Bezug
  z.object({ kind: z.literal("ustva"), transactionId: z.uuid(), vatReturnId: z.uuid(), amount: inCents(z.number().int()) }),
  z.object({
    kind: z.enum(DIRECT_KINDS),
    transactionId: z.uuid(),
    amount: inCents(z.number().int()),
  }),
  // Steuerzahlung oder Erstattung mit Steuerart, Bezugsjahr und Teil (Steuer oder Nebenleistung)
  z.object({ kind: z.literal("steuer"), transactionId: z.uuid(), amount: inCents(z.number().int()), steuer: steuerangabeSchema }),
  // Auszahlung, Tilgung, Zinsen oder Gebühren eines Darlehens
  z.object({ kind: z.literal("darlehen"), transactionId: z.uuid(), amount: inCents(z.number().int()), darlehen: loanPartSchema }),
  // Direkt auf eine Einnahme- oder Ausgabekategorie mit Steuersatz
  z.object({ kind: z.literal("kategorie"), transactionId: z.uuid(), amount: inCents(z.number().int()), kategorie: kategorieAngabeSchema }),
  // Aufladung eines Guthabens: Ausgabe ohne Vorsteuer, Pflicht-Kostenkategorie, ohne Steuersatz (#1356)
  z.object({ kind: z.literal(AUFLADUNG_KIND), transactionId: z.uuid(), amount: inCents(z.number().int()), kategorie: kategorieAngabeSchema }),
]);

export type AllocationInput = z.infer<typeof allocationSchema>;

/** Ein Teil einer Aufteilung: Ziel und Betrag, Vorzeichen wie auf dem Konto (Gebühr in einer Auszahlung also negativ) */
const splitPartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invoice"), invoiceId: z.uuid(), amount: inCents(z.number().int()) }),
  z.object({ kind: z.literal("document"), documentId: z.uuid(), amount: inCents(z.number().int()) }),
  z.object({ kind: z.literal("ustva"), vatReturnId: z.uuid(), amount: inCents(z.number().int()) }),
  z.object({ kind: z.enum(DIRECT_KINDS), amount: inCents(z.number().int()) }),
  z.object({ kind: z.literal("steuer"), amount: inCents(z.number().int()), steuer: steuerangabeSchema }),
  z.object({ kind: z.literal("darlehen"), amount: inCents(z.number().int()), darlehen: loanPartSchema }),
  z.object({ kind: z.literal("kategorie"), amount: inCents(z.number().int()), kategorie: kategorieAngabeSchema }),
]);

export const splitSchema = z.object({ transactionId: z.uuid(), parts: z.array(splitPartSchema).min(2).max(20) });

export type SplitInput = z.infer<typeof splitSchema>;
/** Dazu intern: der Teil einer Zahlung über dem offenen Betrag einer Fremdwährungsrechnung (allocateWithRest) */
export type Part =
  | z.infer<typeof splitPartSchema>
  // Aufladung eines Guthabens (#1356): mit Pflicht-Kostenkategorie und ohne Steuersatz; kein Teil einer Aufteilung
  | { kind: "aufladung"; kategorie: z.infer<typeof kategorieAngabeSchema>; amount: number }
  | { kind: "kursdifferenz"; amount: number }
  // Rücklastschrift (#445): negative Zahlung auf die Rechnung mit Bezug auf die zurückgegebene Lastschrift
  | { kind: "ruecklastschrift"; invoiceId: string; directDebitItemId: string; amount: number }
  // Eine Zeile der Sammelzuordnung mit Gutschriften (allocateFeesToDocument): Die Summe aller Zeilen ist dort geprüft
  | { kind: "document"; documentId: string; amount: number; sammel: true };

export const PRIVAT_NICHT_BUCHBAR =
  "Auf einem privaten Konto ergeben Kontoführung, Zinserträge, Privat und Geldtransit keinen Geschäftsvorfall; diese Buchung ist dort nicht möglich.";

/** Eine Aufladung gibt es nur im Einzelunternehmen (#1356); in GmbH und UG ist die Zahlung eine Forderung, kein Aufwand */
const AUFLADUNG_NICHT_BUCHBAR =
  "In GmbH und UG ist eine Aufladung kein Aufwand, sondern eine Forderung an den Anbieter; die Zuordnungsart ist dort nicht möglich.";

/**
 * Bucht einen Teil eines Umsatzes auf Rechnung, Beleg oder eine Buchung ohne Beleg. Der Betrag trägt das Vorzeichen,
 * mit dem er das Konto bewegt; geprüft wird hier nur gegen das Ziel (offener Betrag der Rechnung bzw. des Belegs).
 */
export async function bookPart(tx: Tx, company: Awaited<ReturnType<typeof openBooks>>, bank: LockedTransaction, part: Part, splitId: string | null) {
  // Gebühren, Zinserträge, Privat und Geldtransit ergeben auf einem privaten Konto keinen Geschäftsvorfall (#873)
  if (!aufKontoAngeboten(part.kind, bank.purpose)) throw new BankError(PRIVAT_NICHT_BUCHBAR);
  // Eine Aufladung gibt es nur im Einzelunternehmen (#1356): Eine Gesellschaft mit Bilanz weist den Betrag bis zur
  // Rechnung als Forderung aus (§ 246 Abs. 1 HGB), nicht als Aufwand; die Auswahl bietet sie dort auch nicht an
  if (!aufRechtsformAngeboten(part.kind, company.rechtsform)) throw new BankError(AUFLADUNG_NICHT_BUCHBAR);
  let lines: PostingLine[];
  let description: string;
  let target: Zuordnungsziel = {};

  if (part.kind === "invoice") {
    ({ lines, description, target } = await invoiceBooking(tx, company, bank, part));
  } else if (part.kind === "ruecklastschrift") {
    ({ lines, description, target } = await returnBooking(tx, company, bank, part));
  } else if (part.kind === "document") {
    ({ lines, description, target } = await documentBooking(tx, company, bank, part));
  } else if (part.kind === "ustva") {
    // Buchung wie „Umsatzsteuer an das Finanzamt“ (SKR03 1780, SKR04 3820); neu ist nur der Bezug auf die Voranmeldung
    const label = await assertUstvaOffen(tx, part.vatReturnId, part.amount);
    lines = directPosting("ustVorauszahlung", part.amount, company.kontenrahmen, company.rechtsform);
    description = `${label} · ${bank.counterpartyName || "Finanzamt"}`;
    target = { vatReturnId: part.vatReturnId };
  } else if (part.kind === "darlehen") {
    ({ lines, description, target } = await darlehenBuchung(tx, company.kontenrahmen, bank, part.darlehen.loanId, part.darlehen.part, part.amount));
  } else if (part.kind === "steuer") {
    ({ lines, description, target } = await steuerbuchung(tx, company, bank, part.steuer, part.amount));
  } else if (part.kind === "kategorie") {
    ({ lines, description, target } = await kategoriebuchung(tx, company.kontenrahmen, bank, part.kategorie, part.amount));
  } else if (part.kind === "aufladung") {
    ({ lines, description, target } = aufladungBuchung(bank, part.kategorie, part.amount, company.kontenrahmen));
  } else if (part.kind === "kursdifferenz") {
    lines = exchangeDifferenceBankPosting(part.amount, company.kontenrahmen);
    description = `Kursdifferenz · ${bank.counterpartyName || "Bankumsatz"}`;
  } else {
    if (isLohnZahlung(part.kind)) await assertLohnOffen(tx, part.kind, part.amount, company.kontenrahmen);
    lines = directPosting(part.kind as DirectBooking, part.amount, company.kontenrahmen, company.rechtsform);
    // In GmbH und UG ist „privat“ das Gesellschafter-Verrechnungskonto; so steht es auch im Buchungstext
    const label = part.kind === "privat" && isKapitalgesellschaft(company.rechtsform) ? "gesellschafter" : part.kind;
    description = `${bank.counterpartyName || "Bankumsatz"} · ${label}`;
  }
  // Privates Konto (#873): Die Richtung des Zahlungskontos gilt für jede Buchungsart — ein Eingang ist eine
  // Privatentnahme, ein Ausgang eine Privateinlage, in GmbH und UG das Gesellschafter-Verrechnungskonto. Die
  // Entscheidung fällt hier einmal für alle Zweige (privatKontoPosting). Nicht hierher gehören Kontoführung,
  // Bankgebühren und Zinsen: Die sind auf einem privaten Konto privat, kein Betriebsvorfall (§ 12 Nr. 1 EStG,
  // § 20 EStG); der Abgleich bietet sie dort nicht an und lehnt sie oben ab (konto-angebot.ts).
  if (bank.purpose === "privat") lines = privatKontoPosting(lines, part.amount, company.kontenrahmen, company.rechtsform);

  const kind = part.kind === "ustva" ? "ustVorauszahlung" : part.kind === "ruecklastschrift" ? "invoice" : part.kind;
  const [allocation] = await insertAllocation(tx, { transactionId: bank.id, kind, amount: part.amount, splitId, ...target });
  await post(tx, company, {
    date: bank.bookingDate,
    description,
    sourceType: "allocation",
    sourceId: allocation!.id,
    lines: onLedger(lines, company.kontenrahmen, bank.ledgerIndex),
  });
  // Zahlung vor der Ausführung (#693): Die vorausdatierte Freigabe zurücknehmen, den Rest wieder festschreiben —
  // nach der Buchung, damit der gezogene Anteil im Journal steht und der Saldo den Rest zeigt
  if (part.kind === "document") await freigabeNachziehen(tx, part.documentId, company, bank.bookingDate);
}

/** Ordnet (einen Teil) eines Umsatzes zu und bucht die Zahlung. */
export async function allocate(actor: string, input: AllocationInput): Promise<void> {
  await withActor(actor, (tx) => allocateIn(tx, input));
}

/** Wie allocate, in einer laufenden Transaktion; etwa zusammen mit dem Buchen des Belegs (Dauerbelege) */
export async function allocateIn(tx: Tx, input: AllocationInput): Promise<void> {
  const company = await openBooks(tx);
  const bank = await lockTransaction(tx, input.transactionId);
  if (input.amount === 0 || Math.sign(input.amount) !== Math.sign(bank.amount)) {
    throw new BankError("Der Betrag muss das Vorzeichen des Umsatzes haben.");
  }
  if (Math.abs(input.amount) > Math.abs(bank.open)) {
    throw new BankError("Der Betrag ist größer als der noch offene Teil des Umsatzes.");
  }
  const { transactionId: _transactionId, ...part } = input;
  await bookPart(tx, company, bank, part, null);
}

/**
 * Splitbuchung: teilt den offenen Teil eines Umsatzes in mehrere Teile mit eigenem Ziel, z. B. eine Auszahlung von
 * 90,00 € in „Rechnung +100,00 €“ und „Gebühr −10,00 €“. Die Teile dürfen unterschiedliche Vorzeichen haben,
 * müssen zusammen aber genau den offenen Teil ergeben. Jeder Teil wird einzeln gebucht (Bruttoprinzip: voller Erlös,
 * Gebühr als Aufwand), alles in einer Transaktion; aufgehoben wird nur die ganze Aufteilung.
 */
export async function allocateSplit(actor: string, input: SplitInput): Promise<void> {
  await withActor(actor, async (tx) => {
    const company = await openBooks(tx);
    const bank = await lockTransaction(tx, input.transactionId);
    // Ohne offenen Betrag ergäben beliebige Teile mit Summe 0 eine erfundene Zahlung (Rechnung +x, Privat −x)
    if (bank.open === 0) throw new BankError("Der Umsatz ist schon ganz zugeordnet.");
    if (input.parts.some((p) => p.amount === 0)) throw new BankError("Jeder Teil braucht einen Betrag.");
    const sum = input.parts.reduce((s, p) => s + p.amount, 0);
    if (sum !== bank.open) {
      throw new BankError(`Die Teile ergeben ${sum / 100} €, offen sind ${bank.open / 100} €. Sie müssen genau den offenen Betrag ergeben.`);
    }
    const splitId = randomUUID();
    for (const part of input.parts) await bookPart(tx, company, bank, part, splitId);
  });
}

/**
 * Bucht einen ganz offenen Umsatz vollständig als Kursdifferenz (Ertrag bei Eingang, Aufwand bei Ausgang), etwa die
 * Differenz zwischen den umgerechneten Monatsbeträgen eines App-Stores und seiner Auszahlung in Euro.
 */
export async function allocateExchangeDifferenceIn(tx: Tx, transactionId: string): Promise<void> {
  const company = await openBooks(tx);
  const bank = await lockTransaction(tx, transactionId);
  if (bank.open !== bank.amount || bank.amount === 0) throw new BankError("Der Umsatz muss noch ganz offen sein.");
  await bookPart(tx, company, bank, { kind: "kursdifferenz", amount: bank.amount }, null);
}
