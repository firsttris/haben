import { PSP_FORMATS, type ParsedStatement } from "@haben/import";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import { accountForIban, normalizeIban } from "./accounts.ts";
import { BankError } from "./bank-error.ts";

/**
 * Konto für einen Kontoauszug: das gewählte (passend zu IBAN und Art der Datei) oder, ohne Wahl, das zur IBAN der Datei;
 * fehlt es, wird es angelegt. Ein ausgeschlossenes Konto nimmt nichts an.
 */
export async function importAccount(tx: Tx, statement: ParsedStatement, filename: string, accountId: string | null) {
  let account: typeof schema.bankAccounts.$inferSelect | undefined;
  const fileIban = statement.accountIban ? normalizeIban(statement.accountIban) : null;
  if (accountId) {
    [account] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, accountId));
    if (!account) throw new BankError("Konto nicht gefunden.");
    if (fileIban && fileIban !== account.iban) {
      throw new BankError(`Die Datei gehört zum Konto ${fileIban}, nicht zu ${account.name}.`);
    }
    // Export eines Zahlungsdienstleisters nur in dessen Konto, ein Kontoauszug nie dorthin
    const providerFile = PSP_FORMATS.includes(statement.format);
    if (providerFile !== (account.purpose === "zahlungsdienstleister")) {
      throw new BankError(
        providerFile
          ? `${filename}: Das ist der Export eines Zahlungsdienstleisters. Bitte unter „Konto“ das Konto des Dienstleisters wählen.`
          : `${filename}: ${account.name} ist ein Zahlungsdienstleister; dorthin gehört nur dessen Export.`,
      );
    }
  } else if (fileIban) {
    account = await accountForIban(tx, fileIban, statement.accountName);
  } else if (PSP_FORMATS.includes(statement.format)) {
    throw new BankError(`${filename}: Export eines Zahlungsdienstleisters. Bitte unter „Konto“ das Konto des Dienstleisters wählen.`);
  } else {
    throw new BankError(`${filename}: Die Datei nennt keine IBAN. Bitte das Konto auswählen.`);
  }
  // Ein Konto, das nicht zu dieser Firma gehört (#462), nimmt nichts mehr an: weder eine Datei noch der Abruf
  if (account.excludedAt) {
    throw new BankError(`${filename}: Das Konto ${account.name} ist ausgeschlossen. Bitte erst unter „Ausgeschlossene Konten“ wieder aufnehmen.`);
  }
  return account;
}
