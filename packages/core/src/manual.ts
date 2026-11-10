import { ASSET_ACCOUNTS } from "./afa.ts";
import { LOHN_KONTEN } from "./lohn-buchung.ts";
import type { Cents } from "./money.ts";
import { ACCOUNTS, EXPENSE_CATEGORIES, paymentProviderAccount, type Kontenrahmen, type PostingLine } from "./posting.ts";
import { isKapitalgesellschaft, type Rechtsform } from "./rechtsform.ts";
import { carriesForward } from "./vortrag.ts";

/**
 * Manuelle Buchungen (Umbuchungen): Soll an Haben auf frei gewählten Konten, ohne Steuer. Gedacht für die Bücher einer
 * GmbH oder UG, etwa Gesellschafterdarlehen, Stammkapital oder eine falsche Kontierung umbuchen.
 *
 * Nicht bebuchbar sind Konten, die ein Nebenbuch führt: Bank, Kasse und Zahlungsdienstleister (Bankabgleich, Kassenbuch),
 * Forderungen und Verbindlichkeiten (offene Posten), Umsatz- und Vorsteuer (Voranmeldung, Abgleich), Erlöse mit
 * Umsatzsteuer (Rechnungen), Anlagen und AfA (Anlagenverzeichnis), Lohnaufwand und Lohnverbindlichkeiten
 * (Lohnabrechnung) und die Vortragskonten der Klasse 9. Eine Buchung
 * daran vorbei bräche den Abgleich zwischen Nebenbuch und Journal.
 */
export interface ManualLine {
  account: string;
  debit: Cents;
  credit: Cents;
  /**
   * Steuerschlüssel einer freien Buchung (#542, #502), nur auf den Erlöskonten (freieBuchungKonto); der Betrag ist dann
   * brutto, freieBuchungPosting teilt in Netto und Steuer
   */
  taxCode?: FreierSteuerschluessel | null;
}

/** Steuerschlüssel freier Buchungen und ihr Steuersatz in Basispunkten (docs/adr/journal-als-quelle.md, Entscheidung 4) */
export const FREIE_STEUERSCHLUESSEL = { USt19: 1900, USt7: 700, frei: 0 } as const;
export type FreierSteuerschluessel = keyof typeof FREIE_STEUERSCHLUESSEL;

/** Das Erlöskonto eines Steuerschlüssels; vorgeschlagen, wenn eine Zeile den Schlüssel bekommt */
export function freieBuchungKonto(kontenrahmen: Kontenrahmen, code: FreierSteuerschluessel): string {
  const satz = FREIE_STEUERSCHLUESSEL[code];
  return ACCOUNTS[kontenrahmen].erloese[satz];
}

/**
 * Sachentnahme: Entnahme von Gegenständen des Betriebs für Zwecke außerhalb des Unternehmens (unentgeltliche Wertabgabe,
 * § 3 Abs. 1b Nr. 1 UStG; in der EÜR mit dem Teilwert bzw. den Selbstkosten, § 6 Abs. 1 Nr. 4 Satz 1 EStG). DATEV-Konten
 * „Entnahme durch den Unternehmer für Zwecke außerhalb des Unternehmens (Waren)“ 19 % bzw. 7 % USt. In SKR04 ist das zu 7 %
 * 4610; 4630 ist dort „Verwendung von Gegenständen … 7 % USt“ (DATEV-Kontenrahmen SKR04 Art.-Nr. 11175, gültig für 2026).
 */
export const SACHENTNAHME_KONTEN = {
  SKR03: { 1900: "8910", 700: "8915" },
  SKR04: { 1900: "4620", 700: "4610" },
} as const;

export const SACHENTNAHME_KONTO_NAMEN: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    "8910": "Entnahme durch den Unternehmer für Zwecke außerhalb des Unternehmens (Waren) 19 % USt",
    "8915": "Entnahme durch den Unternehmer für Zwecke außerhalb des Unternehmens (Waren) 7 % USt",
  },
  SKR04: {
    "4620": "Entnahme durch den Unternehmer für Zwecke außerhalb des Unternehmens (Waren) 19 % USt",
    "4610": "Entnahme durch den Unternehmer für Zwecke außerhalb des Unternehmens (Waren) 7 % USt",
  },
};

export const isSachentnahmeKonto = (kontenrahmen: Kontenrahmen, account: string) => Object.values(SACHENTNAHME_KONTEN[kontenrahmen]).includes(account as never);

/** Die Konten, die eine Zeile mit diesem Steuerschlüssel bebuchen darf: das Erlöskonto des Satzes und die Sachentnahme */
export function freieBuchungKonten(kontenrahmen: Kontenrahmen, code: FreierSteuerschluessel): string[] {
  const satz = FREIE_STEUERSCHLUESSEL[code];
  return satz === 0 ? [ACCOUNTS[kontenrahmen].erloese[0]] : [ACCOUNTS[kontenrahmen].erloese[satz], SACHENTNAHME_KONTEN[kontenrahmen][satz]];
}

export const MANUAL_MAX_LINES = 20;

/** Konto → Nebenbuch, das es führt */
export function ledgerManagedAccounts(kontenrahmen: Kontenrahmen): Map<string, string> {
  const a = ACCOUNTS[kontenrahmen];
  const assets = ASSET_ACCOUNTS[kontenrahmen];
  const entries: [string, string][] = [
    [a.bank, "Bank"],
    [a.kasse, "Kassenbuch"],
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i): [string, string] => [paymentProviderAccount(kontenrahmen, i), "Bank (Zahlungsdienstleister)"]),
    [a.geldtransit, "Bank (Geldtransit)"],
    [a.forderungen, "Rechnungen (offene Posten)"],
    [a.verbindlichkeiten, "Belege (offene Posten)"],
    ...[
      a.ust[1900],
      a.ust[700],
      a.ustNichtFaellig[1900],
      a.ustNichtFaellig[700],
      a.vorsteuer[1900],
      a.vorsteuer[700],
      a.ustRc,
      a.vorsteuerRc,
      ...Object.values(a.ustIge),
      ...Object.values(a.vorsteuerIge),
      // Entstandene Einfuhrumsatzsteuer: Kz 62 kommt aus den Belegen (Bescheid des Zolls)
      EXPENSE_CATEGORIES.einfuhrumsatzsteuer[kontenrahmen],
    ].map((account): [string, string] => [account, "Umsatzsteuer"]),
    [a.ustVorauszahlung, "Umsatzsteuer"],
    [a.sondervorauszahlung, "Umsatzsteuer"],
    ...[...Object.values(a.erloese), ...Object.values(a.erloeseSonder)].map((account): [string, string] => [account, "Rechnungen (Erlöse)"]),
    ...[
      ...Object.values(assets.anlage),
      assets.gwg,
      assets.sammelposten,
      assets.afa,
      assets.afaKfz,
      assets.afaGwg,
      assets.afaSammelposten,
      assets.restbuchwert,
    ].map((account): [string, string] => [account, "Anlagen"]),
    ...Object.values(LOHN_KONTEN[kontenrahmen]).map((account): [string, string] => [account, "Lohn"]),
  ];
  return new Map(entries);
}

/** Privatkonten des Einzelunternehmens: SKR03 1800–1899, SKR04 2100–2199 (DATEV, Kontenklasse „Privat“) */
export function isPrivateAccount(kontenrahmen: Kontenrahmen, account: string): boolean {
  const n = Number(account);
  return kontenrahmen === "SKR03" ? n >= 1800 && n <= 1899 : n >= 2100 && n <= 2199;
}

const isCents = (value: number) => Number.isInteger(value) && value >= 0 && value <= 100_000_000_00;

/**
 * Art der manuellen Buchung: eine Umbuchung im laufenden Jahr oder eine Eröffnungsbuchung, die Salden aus der bisherigen
 * Buchhaltung zum Start in Haben übernimmt. Die Eröffnung bucht nur Bestandskonten und darf dabei auch die Bank (den
 * Kontostand zum Start) und 9000 Saldenvorträge bebuchen; offene Posten kommen einzeln über den Umzug, Anlagen über das
 * Anlagenverzeichnis, die Kasse über das Kassenbuch.
 */
export type ManualKind = "umbuchung" | "eroeffnung";

/**
 * In der Eröffnung zusätzlich bebuchbar: der Kontostand der Bank zum Start, das Gegenkonto der Vorträge und die
 * Lohnverbindlichkeiten der bisherigen Buchhaltung (etwa die Lohnsteuer für Dezember, fällig am 10. Januar, § 41a Abs. 1
 * EStG), die im neuen Jahr über die Bank bezahlt werden. Den Lohnaufwand bucht nur die Lohnabrechnung.
 */
function openingAccounts(kontenrahmen: Kontenrahmen): Set<string> {
  const a = ACCOUNTS[kontenrahmen];
  const lohn = LOHN_KONTEN[kontenrahmen];
  return new Set([
    a.bank,
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => paymentProviderAccount(kontenrahmen, i)),
    a.saldenvortrag,
    lohn.verbLohn,
    lohn.verbLohnsteuer,
    lohn.verbSv,
  ]);
}

/** Was einer manuellen Buchung fehlt; leer = buchbar */
export function manualPostingIssues(
  lines: readonly ManualLine[],
  kontenrahmen: Kontenrahmen,
  rechtsform: Rechtsform,
  kind: ManualKind = "umbuchung",
): string[] {
  const issues: string[] = [];
  if (lines.length < 2) issues.push("Mindestens zwei Zeilen, eine im Soll und eine im Haben");
  if (lines.length > MANUAL_MAX_LINES) issues.push(`Höchstens ${MANUAL_MAX_LINES} Zeilen`);
  const managed = ledgerManagedAccounts(kontenrahmen);
  const opening = kind === "eroeffnung" ? openingAccounts(kontenrahmen) : new Set<string>();
  for (const [index, line] of lines.entries()) {
    const row = `Zeile ${index + 1}`;
    if (!/^\d{4}$/.test(line.account)) issues.push(`${row}: Konto hat vier Ziffern`);
    else if (opening.has(line.account)) {
      // In der Eröffnung erlaubt, siehe openingAccounts
    } else if (kind === "eroeffnung" && !carriesForward(kontenrahmen, line.account)) {
      issues.push(`${row}: Konto ${line.account} ist ein Erfolgskonto; die Eröffnung übernimmt nur Bestände`);
    } else if (line.account.startsWith("9")) issues.push(`${row}: Konto ${line.account} ist ein Vortrags- oder statistisches Konto`);
    else if (line.taxCode && freieBuchungKonten(kontenrahmen, line.taxCode).includes(line.account)) {
      // Freie Buchung mit Steuerschlüssel auf das Erlöskonto des Schlüssels oder die Sachentnahme (freieBuchungIssues prüft den Rest)
    } else if (line.taxCode) issues.push(`${row}: Mit ${line.taxCode} bucht die Zeile auf ${freieBuchungKonten(kontenrahmen, line.taxCode).join(" oder ")}`);
    else if (isSachentnahmeKonto(kontenrahmen, line.account)) {
      issues.push(`${row}: Konto ${line.account} ist eine Sachentnahme mit Umsatzsteuer und bucht nur mit Steuerschlüssel`);
    } else if (managed.has(line.account)) issues.push(`${row}: Konto ${line.account} führt das Nebenbuch ${managed.get(line.account)}`);
    else if (isKapitalgesellschaft(rechtsform) && isPrivateAccount(kontenrahmen, line.account)) {
      issues.push(`${row}: Konto ${line.account} ist ein Privatkonto; eine GmbH oder UG bucht auf das Gesellschafter-Verrechnungskonto`);
    }
    if (!isCents(line.debit) || !isCents(line.credit)) issues.push(`${row}: Betrag ungültig`);
    else if ((line.debit === 0) === (line.credit === 0)) issues.push(`${row}: Betrag entweder im Soll oder im Haben`);
  }
  const debit = lines.reduce((sum, l) => sum + l.debit, 0);
  const credit = lines.reduce((sum, l) => sum + l.credit, 0);
  if (debit !== credit) issues.push("Soll und Haben sind nicht gleich");
  if (lines.length >= 2 && (!lines.some((l) => l.debit > 0) || !lines.some((l) => l.credit > 0))) issues.push("Es fehlt eine Seite");
  const accounts = new Set(lines.map((l) => l.account));
  if (lines.length >= 2 && accounts.size === 1) issues.push("Soll und Haben auf demselben Konto ändern nichts");
  return issues;
}

/** Buchungszeilen einer geprüften manuellen Buchung ohne Steuerschlüssel; mit Steuerschlüssel siehe freieBuchungPosting */
export function manualPosting(lines: readonly ManualLine[]): PostingLine[] {
  return lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, taxCode: null }));
}

/** Gegenbuchung: Soll und Haben getauscht, Steuerschlüssel bleibt, die Bemessungsgrundlage dreht ihr Vorzeichen (#542) */
export function reverseManualPosting(lines: readonly PostingLine[]): PostingLine[] {
  return lines.map((l) => ({
    account: l.account,
    debit: l.credit,
    credit: l.debit,
    taxCode: l.taxCode,
    ...(l.basis != null ? { basis: -l.basis } : {}),
  }));
}
