import { type Cents, formatEuro } from "@haben/core";

function germanDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Saldenprüfung: Anfangssaldo des neuen Imports muss dem Endsaldo des vorigen entsprechen. */
export function checkBalanceContinuity(
  previous: { closingBalance?: Cents; periodTo?: string } | null,
  next: { openingBalance?: Cents; periodFrom?: string },
): { ok: boolean; message?: string } {
  if (previous === null) {
    return { ok: true, message: "Erster Import für dieses Konto; es gibt keinen Endsaldo zum Vergleich." };
  }
  if (previous.closingBalance === undefined || next.openingBalance === undefined) {
    const missing =
      previous.closingBalance === undefined
        ? "Der vorige Import nennt keinen Endsaldo"
        : "Dieser Import nennt keinen Anfangssaldo";
    return { ok: true, message: `${missing}; die Salden können nicht geprüft werden.` };
  }
  if (previous.closingBalance === next.openingBalance) return { ok: true };
  // Überlappende Zeiträume: Salden sind erst nach Abzug der Dubletten vergleichbar
  if (previous.periodTo && next.periodFrom && next.periodFrom <= previous.periodTo) {
    return {
      ok: true,
      message: `Der Zeitraum überschneidet sich mit dem vorigen Import (bis ${germanDate(previous.periodTo)}); die Salden können nicht direkt verglichen werden.`,
    };
  }
  const since = previous.periodTo ? ` (Stand ${germanDate(previous.periodTo)})` : "";
  const diff = next.openingBalance - previous.closingBalance;
  return {
    ok: false,
    message: `Lücke: Anfangssaldo ${formatEuro(next.openingBalance)} passt nicht zum Endsaldo ${formatEuro(previous.closingBalance)}${since} des vorigen Imports. Differenz ${formatEuro(diff)}; vermutlich fehlen Umsätze dazwischen.`,
  };
}
