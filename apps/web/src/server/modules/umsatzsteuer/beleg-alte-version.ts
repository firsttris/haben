import { ACCOUNTS, mitBemessungWieHeute, privatJeErwerbssatz, type Cents, type JournalZeile, type Kontenrahmen } from "@haben/core";
import { inArray } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Belegbuchungen mit § 13b oder Erwerb aus Versionen vor #551 (#1396, mitBemessungWieHeute in @haben/core): Voranmeldung
 * und Verprobung lesen sie mit der Bemessungsgrundlage, die eine heutige Buchung trüge. Beim Erwerb zu 19 % und 7 % mit
 * Privatanteil steht der private Teil beider Sätze in einer Summe auf den Entnahmen; aufteilen lässt er sich nur mit Beträgen
 * und Privatanteil des Belegs, deshalb lädt diese Funktion sie für genau diese Buchungen (#1502, im Update-Test mit Daten aus
 * v0.6.6 gefunden). `alt` setzt der Aufrufer mit belegAusAlterVersion.
 */

export interface BelegBuchung {
  sourceType: string;
  sourceId: string;
  kontenrahmen: Kontenrahmen;
  /** Belegbuchung aus einer Version vor dem Update auf das Journal (belegAusAlterVersion) */
  alt: boolean;
  zeilen: JournalZeile[];
}

/** Erwerb zu zwei Sätzen mit einem privaten Teil ohne Steuerschlüssel: nur dafür braucht es den Beleg */
const brauchtBeleg = (b: BelegBuchung) =>
  b.sourceType === "document" &&
  b.zeilen.some((z) => z.taxCode === "IGE19") &&
  b.zeilen.some((z) => z.taxCode === "IGE7") &&
  b.zeilen.some((z) => z.account === ACCOUNTS[b.kontenrahmen].privatentnahmen && z.taxCode == null);

/** Die Buchungen, Belegbuchungen alter Versionen mit der Bemessungsgrundlage wie heute; alle anderen unverändert */
export async function belegeWieHeute<B extends BelegBuchung>(buchungen: readonly B[], q: Db | Tx): Promise<B[]> {
  const ids = [...new Set(buchungen.filter((b) => b.alt && brauchtBeleg(b)).map((b) => b.sourceId))];
  const privat = new Map<string, Map<string, Cents>>();
  for (let i = 0; i < ids.length; i += 5000) {
    const block = ids.slice(i, i + 5000);
    const d = schema.documents;
    const a = schema.documentAmounts;
    const anteile = new Map(
      (await q.select({ id: d.id, privateShare: d.privateShare }).from(d).where(inArray(d.id, block))).map((r) => [r.id, r.privateShare]),
    );
    const betraege = await q.select({ documentId: a.documentId, taxRate: a.taxRate, net: a.net, tax: a.tax }).from(a).where(inArray(a.documentId, block));
    for (const [id, anteil] of anteile)
      privat.set(
        id,
        privatJeErwerbssatz(
          betraege.filter((r) => r.documentId === id),
          anteil,
        ),
      );
  }
  return buchungen.map((b) => (b.alt ? { ...b, zeilen: mitBemessungWieHeute(b.kontenrahmen, b.zeilen, privat.get(b.sourceId)) } : b));
}
