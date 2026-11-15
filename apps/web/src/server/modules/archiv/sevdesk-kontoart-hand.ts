import { sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { type AccountingKind, accountingTypeDecidable, accountingTypeKinds, type AccountingTypeKinds } from "./sevdesk-kontoart.ts";

/*
 * Schreibt die Entscheidung von Hand (#888). Getrennt von sevdesk-kontoart.ts, das nur SQL-Ausdrücke baut und ohne
 * Datenbankverbindung importiert werden kann.
 */

/** Kontoart einer Gutschrift auf ein Buchungskonto von Hand festlegen (#888); die Archivkopie bleibt unverändert */
export async function decideAccountingType(actor: string, voucherId: string, kind: AccountingKind): Promise<void> {
  await withActor(actor, async (tx) => {
    const [row] = await tx.execute<{ kinds: AccountingTypeKinds | null }>(
      sql`select ${accountingTypeKinds("v")} as kinds from lexoffice_vouchers v where v.id = ${voucherId}`,
    );
    if (!row) throw new UserError("Beleg nicht gefunden.");
    if (!row.kinds) throw new UserError("Die Kontoart lässt sich nur bei einer Gutschrift aus sevDesk auf ein Buchungskonto festlegen.");
    if (!accountingTypeDecidable(row.kinds)) throw new UserError("Die Kontoart steht schon im Kontostamm aus sevDesk fest.");
    if (row.kinds.hand === kind) return;
    await tx.insert(schema.sevdeskAccountingTypeDecisions).values({ voucherId, kind, decidedBy: actor });
  });
}
