import { abschluss, type Abschluss, type Kontenrahmen } from "@haben/core";
import { ledgerRange, saldenliste, uebernahmen } from "./ledger.ts";

/**
 * Bilanz zum 31.12. des Jahres und die Vorjahresspalte, wie Hinterlegung und Restlaufzeiten sie zeigen. Die Vorjahresspalte
 * (§ 265 Abs. 2 HGB) kommt aus der Spalte „Eröffnung“ der Saldenliste: Die Salden zum 1. Januar sind die Schlussbilanz des
 * Vorjahres (Bilanzidentität, § 252 Abs. 1 Nr. 1 HGB), ob vorgetragen oder per Eröffnungsbuchung übernommen; dazu kommt,
 * was im Jahr gegen 9000 übernommen ist (Umzug, Anlagen). Ohne Salden zum 1. Januar gibt es keine (erstes Geschäftsjahr).
 */
export async function jahresBilanzen(year: number, kontenrahmen: Kontenrahmen): Promise<{ report: Abschluss; vorjahr: Abschluss | null }> {
  const rows = (await saldenliste(ledgerRange(year), { aufgeloest: true })).filter((r) => r.kontenrahmen === kontenrahmen);
  const report = abschluss(
    kontenrahmen,
    rows.map((r) => ({ account: r.account, saldo: r.saldo })),
  );
  const salden = new Map<string, number>();
  for (const { account, saldo } of [...rows.map((r) => ({ account: r.account, saldo: r.eroeffnung })), ...(await uebernahmen(year, kontenrahmen))]) {
    salden.set(account, (salden.get(account) ?? 0) + saldo);
  }
  const eroeffnung = [...salden].filter(([, saldo]) => saldo !== 0).map(([account, saldo]) => ({ account, saldo }));
  return { report, vorjahr: eroeffnung.length > 0 ? abschluss(kontenrahmen, eroeffnung) : null };
}
