import { batchSchema, IMPORT_CONTRACT_VERSION, type ImportBatch, type ImportMovement, type SourceBinding } from "./types.ts";

/** Bewegung, die Haben nicht übernimmt. `blocking`: Der Zeitraum gilt damit nicht als vollständig abgerufen. */
export interface RejectedMovement {
  sourceEventId: string;
  component: ImportMovement["component"];
  reason: string;
  blocking: boolean;
}

export type BatchValidation =
  | { ok: false; problems: string[] }
  | {
      ok: true;
      batch: ImportBatch;
      /** Bewegungen für den Import, in der Reihenfolge der Lieferung */
      accepted: ImportMovement[];
      rejected: RejectedMovement[];
      /** Abgelehnte und vom Connector nicht eingeordnete Ereignisse, die die Vollständigkeit blockieren */
      blocking: number;
      hints: string[];
    };

/** Kalendertag, den es gibt: „2026-02-30“ passt zum Muster, aber nicht zum Kalender */
function isCalendarDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const label = (m: Pick<ImportMovement, "sourceEventId" | "component">) => `${m.sourceEventId}/${m.component}`;

/** Fehler, die die ganze Lieferung ungültig machen: Haben nimmt dann nichts davon an, auch keinen Teil */
function hardProblems(batch: ImportBatch, binding: SourceBinding): string[] {
  if (batch.contractVersion !== IMPORT_CONTRACT_VERSION) {
    return [`Vertragsversion ${batch.contractVersion} wird nicht unterstützt, erwartet ${IMPORT_CONTRACT_VERSION}.`];
  }
  if (batch.provider !== binding.provider || batch.externalAccountId !== binding.externalAccountId) {
    return [
      `Die Lieferung gehört zu ${batch.provider}/${batch.externalAccountId}, das Konto ist mit ${binding.provider}/${binding.externalAccountId} verknüpft.`,
    ];
  }
  const { from, to } = batch.coverage;
  const problems: string[] = [];
  for (const day of [from, to]) if (!isCalendarDate(day)) problems.push(`Fenster: ${day} gibt es nicht.`);
  if (problems.length === 0 && from > to) problems.push(`Das Fenster endet vor seinem Anfang (${from} bis ${to}).`);
  // Ohne gültiges Fenster lässt sich keine Bewegung zuordnen
  if (problems.length > 0) return problems;
  const seen = new Set<string>();
  for (const m of batch.movements) {
    if (!isCalendarDate(m.bookingDate)) problems.push(`${label(m)}: Buchungstag ${m.bookingDate} gibt es nicht.`);
    else if (m.bookingDate < from || m.bookingDate > to) {
      problems.push(`${label(m)}: Buchungstag ${m.bookingDate} liegt außerhalb des Fensters ${from} bis ${to}.`);
    }
    if (seen.has(label(m))) problems.push(`${label(m)} steht zweimal in der Lieferung.`);
    seen.add(label(m));
  }
  return problems;
}

/** Grund, eine sonst gültige Bewegung nicht zu übernehmen, oder null */
function rejection(m: ImportMovement, binding: SourceBinding): Omit<RejectedMovement, "sourceEventId" | "component"> | null {
  // Zunächst nur Euro; alles andere sichtbar ablehnen (#306)
  if (m.currency !== "EUR") return { reason: `Währung ${m.currency}: Haben übernimmt nur Euro.`, blocking: true };
  if (binding.cutoverDate && m.bookingDate < binding.cutoverDate) {
    return { reason: `Vor dem Stichtag ${binding.cutoverDate} der Quelle; diese Zeit decken Dateiimporte ab.`, blocking: false };
  }
  if (m.amount === 0) return { reason: "Betrag ist 0.", blocking: false };
  return null;
}

/**
 * Prüft eine Lieferung gegen den Vertrag und die Quellenbindung des Kontos. Ungültiger Inhalt lehnt die ganze Lieferung
 * ab; einzelne Bewegungen in fremder Währung, vor dem Stichtag oder mit Betrag 0 weist Haben mit Grund zurück.
 */
export function validateBatch(input: unknown, binding: SourceBinding): BatchValidation {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "Lieferung"))];
    return { ok: false, problems: fields.map((f) => `Feld ${f} ist ungültig.`) };
  }
  const batch = parsed.data;
  const problems = hardProblems(batch, binding);
  if (problems.length > 0) return { ok: false, problems };

  const accepted: ImportMovement[] = [];
  const rejected: RejectedMovement[] = [];
  for (const m of batch.movements) {
    const r = rejection(m, binding);
    if (r) rejected.push({ sourceEventId: m.sourceEventId, component: m.component, ...r });
    else accepted.push(m);
  }
  const hints = accepted
    .filter((m) => (m.kind === "refund" || m.kind === "chargeback") && m.component === "main" && !m.references.relatedEventId)
    .map((m) => `${m.sourceEventId}: ${m.kind === "refund" ? "Erstattung" : "Rückbelastung"} ohne Bezug zur ursprünglichen Zahlung.`);
  const foreignBalances = batch.balances.filter((b) => b.currency !== "EUR");
  hints.push(...foreignBalances.map((b) => `Saldo vom ${b.date} in ${b.currency} nicht übernommen.`));
  return {
    ok: true,
    batch: { ...batch, balances: batch.balances.filter((b) => b.currency === "EUR") },
    accepted,
    rejected,
    blocking: rejected.filter((r) => r.blocking).length + batch.unsupported.length,
    hints,
  };
}
