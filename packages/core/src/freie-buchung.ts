import { euerZuordnung } from "./journal-euer.ts";
import { kontoart } from "./ledger.ts";
import { FREIE_STEUERSCHLUESSEL, isPrivateAccount, type ManualLine } from "./manual.ts";
import { roundHalfAwayFromZero } from "./money.ts";
import { resolveOwnAccount } from "./own-accounts.ts";
import { ACCOUNTS, type ExpenseCategory, type Kontenrahmen, type PostingLine } from "./posting.ts";
import { isKapitalgesellschaft, type Rechtsform } from "./rechtsform.ts";

/*
 * Freie Buchungen mit Steuerschlüssel (#502; docs/adr/journal-als-quelle.md, Entscheidung 4): eine manuelle Buchung, deren
 * Erlöszeile einen Steuerschlüssel trägt. Wie die DATEV-Automatik teilt Haben den Bruttobetrag in Netto und Steuer; die
 * Netto-Zeile trägt den Schlüssel (Bemessungsgrundlage), die Steuer geht auf das Umsatzsteuerkonto des Satzes. Keine
 * Vorsteuer: Eine freie Buchung ist ein Eigenbeleg, der Vorsteuerabzug braucht eine Rechnung (§ 15 Abs. 1 Nr. 1 Satz 2
 * UStG); dafür gibt es Belege. Nur ab dem Stichjahr, wenn Voranmeldung und EÜR aus dem Journal rechnen.
 */

export interface FreieBuchungKontext {
  kontenrahmen: Kontenrahmen;
  rechtsform: Rechtsform;
  /** Kleinunternehmer am Buchungstag: dann keine Umsatzsteuer (§ 19 Abs. 1 UStG) */
  kleinunternehmer: boolean;
  /** Voranmeldung und EÜR rechnen im Jahr der Buchung aus dem Journal (Jahr ≥ Stichjahr) */
  ausDemJournal: boolean;
  /** Eigene Sachkonten (#270) des Kontenrahmens: Nummer → Elternkategorie; sie haben die Zeile der EÜR ihrer Elternkategorie */
  eigene?: ReadonlyMap<string, ExpenseCategory>;
}

/**
 * Was einer manuellen Buchung als freie Buchung fehlt, zusätzlich zu manualPostingIssues; leer = buchbar. Im Einzelunternehmen
 * braucht jede Buchung das Stichjahr (davor rechnet die EÜR aus den Nebenbüchern und sähe sie nicht); jedes Erfolgskonto
 * muss eine Zeile der EÜR haben. Mit Steuerschlüssel ist das Gegenkonto ein Erfolgs- oder Privatkonto, in GmbH und UG ein
 * Erfolgskonto oder das Gesellschafter-Verrechnungskonto.
 */
export function freieBuchungIssues(lines: readonly ManualLine[], k: FreieBuchungKontext): string[] {
  const issues: string[] = [];
  const mitSchluessel = lines.some((l) => l.taxCode);
  const gmbh = isKapitalgesellschaft(k.rechtsform);
  if (!gmbh && !k.ausDemJournal) {
    issues.push("Im Einzelunternehmen gibt es manuelle Buchungen erst ab dem Stichjahr, wenn die EÜR aus dem Journal rechnet");
  } else if (mitSchluessel && !k.ausDemJournal) {
    issues.push("Buchungen mit Steuerschlüssel gibt es erst ab dem Stichjahr, wenn die Voranmeldung aus dem Journal rechnet");
  }
  if (mitSchluessel && k.kleinunternehmer) issues.push("Als Kleinunternehmer bucht Haben keine Umsatzsteuer (§ 19 Abs. 1 UStG)");
  const erfolg = (account: string) => kontoart(k.kontenrahmen, account) !== "bestand";
  for (const [index, line] of lines.entries()) {
    const row = `Zeile ${index + 1}`;
    if (line.taxCode && !(line.taxCode in FREIE_STEUERSCHLUESSEL)) issues.push(`${row}: Steuerschlüssel ${line.taxCode} ist hier nicht erlaubt`);
    const konto = resolveOwnAccount(k.kontenrahmen, line.account, k.eigene ?? new Map());
    if (!gmbh && erfolg(line.account) && euerZuordnung(k.kontenrahmen, konto) === null) {
      issues.push(`${row}: Konto ${line.account} hat keine Zeile in der EÜR`);
    }
    if (mitSchluessel && !line.taxCode) {
      const gegenkonto =
        erfolg(line.account) || (gmbh ? line.account === ACCOUNTS[k.kontenrahmen].gesellschafter : isPrivateAccount(k.kontenrahmen, line.account));
      if (!gegenkonto) {
        issues.push(
          `${row}: Gegenkonto einer Zeile mit Steuerschlüssel ist ein Erfolgskonto oder ${gmbh ? "das Gesellschafter-Verrechnungskonto" : "ein Privatkonto"}`,
        );
      }
    }
  }
  // Im Einzelunternehmen wirkt in der EÜR nur, was Erfolgskonten und Privat berühren; eine Buchung zwischen anderen
  // Bestandskonten neben einem Erfolgskonto wäre eine Einnahme oder Ausgabe ohne Zahlung
  if (!gmbh && lines.some((l) => erfolg(l.account)) && lines.some((l) => !erfolg(l.account) && !isPrivateAccount(k.kontenrahmen, l.account))) {
    issues.push("Im Einzelunternehmen steht neben einem Erfolgskonto nur ein Privatkonto; Zahlungen gehen über Bank oder Kasse");
  }
  return issues;
}

/**
 * Buchungszeilen einer geprüften freien Buchung: Zeilen mit Steuerschlüssel teilen den Bruttobetrag in Netto (mit dem
 * Schlüssel) und Steuer auf das Umsatzsteuerkonto des Satzes, gerundet kaufmännisch (§ 14 Abs. 4 Nr. 8 UStG; wie Haben die
 * Steuer einer Rechnung rundet); ohne Schlüssel wie manualPosting
 */
export function freieBuchungPosting(lines: readonly ManualLine[], kontenrahmen: Kontenrahmen): PostingLine[] {
  const result: PostingLine[] = [];
  for (const l of lines) {
    if (!l.taxCode) {
      result.push({ account: l.account, debit: l.debit, credit: l.credit, taxCode: null });
      continue;
    }
    const satz = FREIE_STEUERSCHLUESSEL[l.taxCode];
    const brutto = l.debit - l.credit;
    const steuer = satz === 0 ? 0 : roundHalfAwayFromZero((brutto * satz) / (10_000 + satz));
    const netto = brutto - steuer;
    const seite = (account: string, betrag: number, taxCode: PostingLine["taxCode"]): PostingLine => ({
      account,
      debit: Math.max(betrag, 0),
      credit: Math.max(-betrag, 0),
      taxCode,
    });
    result.push(seite(l.account, netto, l.taxCode));
    if (steuer !== 0) result.push(seite(ACCOUNTS[kontenrahmen].ust[satz as 1900 | 700], steuer, l.taxCode));
  }
  return result;
}
