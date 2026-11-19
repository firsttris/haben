import { type EbTransaction, enableBankingStatement } from "@haben/import";
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { databaseUrlFuer, portFuer } from "./durchlaeufe.ts";
import { einrichten, gehe } from "./einrichtung.ts";

const DURCHLAUF = "bank-dubletten";
const URSPRUENGLICH = "TEST K UNDENREFERENZ X0";
const KANDIDAT = "TEST KUNDENREFERENZ X";

/** Zwei gebuchte Umsätze ohne Referenz aus getrennten Abrufen wie im Bericht #865. */
async function seedBankTransactions() {
  const url = databaseUrlFuer(DURCHLAUF);
  if (!new URL(url).pathname.endsWith("bank_dubletten_e2e")) throw new Error("Eigene E2E-Datenbank fehlt.");
  Object.assign(process.env, {
    DATABASE_URL: url,
    BETTER_AUTH_URL: `http://localhost:${portFuer(DURCHLAUF)}`,
    BETTER_AUTH_SECRET: "e2e-geheimnis-mindestens-zweiunddreissig-zeichen",
    HABEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });

  const { closeDatabase } = await import("../src/server/db/index.ts");
  try {
    const { withActor } = await import("../src/server/db/actor.ts");
    const { storeBatch } = await import("../src/server/modules/bank/import-batch.ts");
    const { abrufNachVertrag } = await import("../src/server/modules/bank/vertrag-abruf.ts");
    const window = { dateFrom: "2026-10-01", dateTo: "2026-10-31" };
    const account = { uid: "musterkonto", account_id: { iban: "DE89370400440532013000" }, name: "Musterkonto" };
    let accountId: string | null = null;

    for (const [index, purpose] of [URSPRUENGLICH, KANDIDAT].entries()) {
      const transactions: EbTransaction[] = [
        {
          transaction_amount: { amount: "42.80", currency: "EUR" },
          credit_debit_indicator: "DBIT",
          status: "BOOK",
          booking_date: "2026-10-05",
          creditor: { name: "Musterfirma" },
          remittance_information: [purpose],
        },
      ];
      const fetchId = `e2e-bank-dubletten-${index}`;
      const { input } = abrufNachVertrag({
        identificationHash: account.uid,
        transactions,
        balances: [],
        ...window,
        now: new Date("2026-10-31T12:00:00Z"),
        fetchId,
        statement: enableBankingStatement({ account, transactions, balances: [], ...window }),
        source: { filename: fetchId, sha256: createHash("sha256").update(fetchId).digest("hex") },
      });
      const result = await withActor("system:bankabruf-e2e", (tx) => storeBatch(tx, input, accountId));
      accountId = result.accountId;
    }
    return accountId;
  } finally {
    await closeDatabase();
  }
}

test("Dublettenverdacht vergleichen, entscheiden und zurücknehmen", async ({ page }) => {
  await einrichten(page);
  const accountId = await seedBankTransactions();
  await gehe(page, `/bank?konto=${accountId}&filter=alle`);

  const umsaetze = page.getByRole("region", { name: "Umsätze", exact: true });
  const kandidat = umsaetze.getByRole("link").filter({ hasText: KANDIDAT });
  await expect(kandidat).toContainText("Mögliche Dublette");
  await kandidat.click();
  await expect(page).toHaveURL(/[?&]umsatz=[0-9a-f-]{36}/);
  const auswahl = page.url();

  const pruefung = page.getByRole("region", { name: "Dublettenprüfung" });
  const heading = (name: string) => pruefung.getByRole("heading", { name, exact: true });
  const button = (name: string) => pruefung.getByRole("button", { name, exact: true });
  const offene = (anzahl: number) => umsaetze.getByRole("link", { name: `Offen · ${anzahl}`, exact: true });

  await expect(pruefung.getByText(URSPRUENGLICH, { exact: true })).toBeVisible();
  await expect(pruefung.getByText(KANDIDAT, { exact: true })).toBeVisible();
  await expect(offene(2)).toBeVisible();

  await button("Keine Dublette").click();
  await expect(heading("Keine Dublette")).toBeVisible();
  await page.reload();
  await expect(heading("Keine Dublette")).toBeVisible();
  await expect(offene(2)).toBeVisible();

  await button("Entscheidung zurücknehmen").click();
  await expect(heading("Mögliche Dublette")).toBeVisible();

  await button("Ist eine Dublette").click();
  await expect(heading("Bestätigte Dublette")).toBeVisible();
  await expect(kandidat.getByText("Dublette", { exact: true })).toBeVisible();
  await expect(offene(1)).toBeVisible();
  await expect(page).toHaveURL(auswahl);

  await button("Entscheidung zurücknehmen").click();
  await expect(heading("Mögliche Dublette")).toBeVisible();
  await expect(offene(2)).toBeVisible();
  await expect(page).toHaveURL(auswahl);
});
