import type { Abschluss } from "./hgb.ts";
import { isPrivateAccount, type ManualLine } from "./manual.ts";
import { formatEuro } from "./money.ts";
import { ACCOUNTS, type Kontenrahmen } from "./posting.ts";
import { isKapitalgesellschaft, type Rechtsform } from "./rechtsform.ts";
import { carriesForward, carryForward, type KontoSaldo } from "./vortrag.ts";

/*
 * Eröffnung aus der Schlussbilanz des DATEV-Buchungsstapels (GmbH, UG): Haben schlägt für das erste Jahr in Haben die
 * Eröffnungsbuchung vor, statt dass sie von Hand abgetippt wird. Die Zeilen sind die Vorträge der Schlussbilanz
 * (carryForward: Bestandskonten wie sie sind, das Ergebnis auf Gewinn- bzw. Verlustvortrag) gegen 9000 Saldenvorträge.
 *
 * Anders als die manuelle Eröffnung (manualPostingIssues) darf diese Buchung auch die Konten der Nebenbücher bebuchen:
 * Bank, Kasse, Forderungen, Verbindlichkeiten, Umsatzsteuer und Anlagen. Das geht nur, weil die Beträge nicht eingetippt,
 * sondern aus dem archivierten Stapel gerechnet werden und die Nebenbücher den Eröffnungsbestand kennen (siehe
 * docs/lexoffice.md, „Eröffnung aus dem DATEV-Stapel“). Die manuelle Eröffnung bleibt so streng wie bisher.
 */

/**
 * Höchstzahl der Zeilen. Die 20 Zeilen der manuellen Buchung sind eine Grenze für ein Formular zum Eintippen; eine
 * Schlussbilanz hat oft mehr Konten. 500 Bestandskonten mit Saldo hat auch eine große Bilanz nicht, die Grenze fängt
 * nur einen kaputten Stapel ab.
 */
export const DATEV_OPENING_MAX_LINES = 500;

/**
 * Saldenvortragskonten 9000 bis 9009. DATEV trägt offene Posten der Personenkonten über 9008 (Debitoren) und 9009
 * (Kreditoren) vor, die Sachkonten über 9000; ausgeglichen ist der Vortrag, wenn die drei zusammen null ergeben, nicht
 * jedes für sich (DATEV-Kontenrahmen SKR03/SKR04, Kontenklasse 9 „Vortragskonten“).
 */
const isSaldenvortrag = (account: string) => /^900\d$/.test(account);

const isCents = (value: number) => Number.isInteger(value) && value >= 0 && value <= 100_000_000_00;

/** Kontonummern numerisch sortiert, 9000 Saldenvorträge zuletzt */
function byAccount(kontenrahmen: Kontenrahmen) {
  const last = ACCOUNTS[kontenrahmen].saldenvortrag;
  return (a: string, b: string) => (a === last ? 1 : b === last ? -1 : a.localeCompare(b, "de", { numeric: true }));
}

/**
 * Zeilen der Eröffnung: die Vorträge der Schlussbilanz abzüglich dessen, was im Eröffnungsjahr schon gegen 9000 gebucht
 * ist (einzeln übernommene offene Posten und Anlagen). So stehen Forderungen und Verbindlichkeiten nach der Eröffnung
 * genau mit dem Saldo der Schlussbilanz da, und 9000 ist ausgeglichen: Die Eröffnung bucht dort das Gegenteil dessen,
 * was die Übernahmen gebucht haben.
 */
export function datevOpeningLines(kontenrahmen: Kontenrahmen, schluss: readonly KontoSaldo[], gebucht: readonly KontoSaldo[]): ManualLine[] {
  // 9000 bis 9009 gleichen sich in der Schlussbilanz gegenseitig aus (schlussbilanzIssues); in der Eröffnung von Haben
  // stehen sie nicht, das Gegenkonto ist 9000
  const offen = carryForward(
    kontenrahmen,
    schluss.filter((s) => !isSaldenvortrag(s.account)),
  );
  for (const { account, saldo } of gebucht) offen.set(account, (offen.get(account) ?? 0) - saldo);
  const order = byAccount(kontenrahmen);
  return [...offen]
    .filter(([, saldo]) => saldo !== 0)
    .sort(([a], [b]) => order(a, b))
    .map(([account, saldo]) => ({ account, debit: Math.max(saldo, 0), credit: Math.max(-saldo, 0) }));
}

/** Was der Eröffnung aus dem Stapel fehlt; leer = buchbar */
export function datevOpeningIssues(lines: readonly ManualLine[], kontenrahmen: Kontenrahmen, rechtsform: Rechtsform): string[] {
  if (!isKapitalgesellschaft(rechtsform)) return ["Die Eröffnung aus dem DATEV-Stapel gibt es nur für GmbH und UG"];
  const issues: string[] = [];
  if (lines.length < 2) issues.push("Die Schlussbilanz hat keine Bestände, die zu eröffnen wären");
  if (lines.length > DATEV_OPENING_MAX_LINES) issues.push(`Höchstens ${DATEV_OPENING_MAX_LINES} Zeilen`);
  const saldenvortrag = ACCOUNTS[kontenrahmen].saldenvortrag;
  for (const line of lines) {
    const konto = `Konto ${line.account}`;
    if (!/^\d{4}$/.test(line.account)) issues.push(`${konto} hat nicht vier Ziffern`);
    else if (line.account.startsWith("9") && line.account !== saldenvortrag) issues.push(`${konto} ist ein Vortrags- oder statistisches Konto`);
    else if (line.account !== saldenvortrag && !carriesForward(kontenrahmen, line.account)) {
      issues.push(`${konto} ist ein Erfolgskonto; die Eröffnung übernimmt nur Bestände`);
    } else if (isPrivateAccount(kontenrahmen, line.account)) {
      issues.push(`${konto} ist ein Privatkonto; eine GmbH oder UG bucht auf das Gesellschafter-Verrechnungskonto`);
    }
    if (!isCents(line.debit) || !isCents(line.credit) || (line.debit === 0) === (line.credit === 0)) issues.push(`${konto}: Betrag ungültig`);
  }
  // Der Kassenbestand der Eröffnung ist der Anfangsbestand des Kassenbuchs, und der darf an keinem Tag negativ sein
  const kasse = lines.find((l) => l.account === ACCOUNTS[kontenrahmen].kasse);
  if (kasse && kasse.credit > 0) issues.push(`Die Kasse ${kasse.account} hat in der Schlussbilanz einen negativen Bestand; ein Kassenbuch beginnt nicht im Minus`);
  const debit = lines.reduce((sum, l) => sum + l.debit, 0);
  const credit = lines.reduce((sum, l) => sum + l.credit, 0);
  if (debit !== credit) issues.push("Soll und Haben sind nicht gleich");
  return issues;
}

/**
 * Vorbedingung: Die Schlussbilanz geht auf. Jedes Konto hat einen Posten, die Saldenvortragskonten 9000 bis 9009 sind
 * zusammen ausgeglichen, andere Konten der Klasse 9 je für sich, und Aktiva gleich Passiva; sonst stimmte auch die
 * Eröffnung nicht.
 */
export function schlussbilanzIssues(report: Abschluss, name: (account: string) => string = () => ""): string[] {
  const konto = (account: string) => `${account}${name(account) ? ` ${name(account)}` : ""}`;
  const vortrag = report.offeneVortraege.filter((k) => isSaldenvortrag(k.account)).reduce((sum, k) => sum + k.saldo, 0);
  return [
    ...report.nichtZugeordnet.map((k) => `Konto ${konto(k.account)} (${formatEuro(k.saldo)}) hat keinen Posten in der Bilanz`),
    ...(vortrag === 0 ? [] : [`Die Saldenvortragskonten 9000 bis 9009 sind zusammen nicht ausgeglichen (${formatEuro(vortrag)})`]),
    ...report.offeneVortraege
      .filter((k) => !isSaldenvortrag(k.account))
      .map((k) => `Konto ${konto(k.account)} ist nicht ausgeglichen (${formatEuro(k.saldo)})`),
    ...(report.aktiva === report.passiva
      ? []
      : [`Die Schlussbilanz geht nicht auf: Aktiva ${formatEuro(report.aktiva)}, Passiva ${formatEuro(report.passiva)}`]),
  ];
}
