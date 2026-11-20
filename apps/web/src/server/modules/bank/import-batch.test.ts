import { type EbTransaction, enableBankingStatement, statementFromBatch } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { abrufNachVertrag } from "./vertrag-abruf.ts";

/*
 * Schritt 3 aus #306: Lieferungen des Importvertrags speichern. Jeder Test nimmt ein eigenes Konto (IBAN und Kennung),
 * damit sie sich nicht gegenseitig beeinflussen.
 */

let nr = 0;
/** Gültige deutsche IBAN mit Prüfziffer (ISO 13616) */
function iban(konto: number): string {
  const bban = `50010517${String(konto).padStart(10, "0")}`;
  const rest = [...`${bban}131400`].reduce((r, d) => (r * 10 + Number(d)) % 97, 0);
  return `DE${String(98 - rest).padStart(2, "0")}${bban}`;
}
const neuesKonto = () => {
  nr++;
  return { iban: iban(7_000_000 + nr), hash: `hash-${nr}-${Math.random()}` };
};

const tx = (ref: string | null, booking_date: string, amount = "49.99", over: Partial<EbTransaction> = {}): EbTransaction => ({
  entry_reference: ref,
  transaction_amount: { currency: "EUR", amount },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date,
  creditor: { name: "Telekom" },
  creditor_account: { iban: "DE89370400440532013000" },
  remittance_information: ["Rechnung 9/2026"],
  ...over,
});

describe.skipIf(!testDatabaseUrl)("storeBatch (Postgres)", () => {
  let importBatch: typeof import("./import-batch.ts");
  let bank: typeof import("./index.ts");
  let db: typeof import("../../db/index.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    importBatch = await import("./import-batch.ts");
    bank = await import("./index.ts");
    db = await import("../../db/index.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  function abruf(
    konto: { iban: string; hash: string },
    transactions: EbTransaction[],
    over: { fetchId?: string; from?: string; to?: string; fetchFrom?: string } = {},
  ) {
    const window = { dateFrom: over.from ?? "2026-10-01", dateTo: over.to ?? "2026-10-31" };
    const fetchId = over.fetchId ?? `abruf-${Math.random()}`;
    return abrufNachVertrag({
      identificationHash: konto.hash,
      transactions,
      balances: [],
      ...window,
      now: new Date(`${window.dateTo}T12:00:00Z`),
      fetchId,
      statement: enableBankingStatement({
        account: { uid: "u", account_id: { iban: konto.iban }, name: "Geschäftskonto" },
        transactions,
        balances: [],
        ...window,
      }),
      source: { filename: `Abruf ${fetchId}`, sha256: fetchId },
      ...(over.fetchFrom ? { fetchFrom: over.fetchFrom } : {}),
    }).input;
  }

  const speichere = (input: ReturnType<typeof abruf>) => db.db.transaction((t) => importBatch.storeBatch(t, input, null));

  async function umsaetze(iban: string) {
    return sql<{ amount: number; bank_reference: string | null }[]>`
      select t.amount, t.bank_reference from bank_transactions t join bank_accounts a on a.id = t.bank_account_id
      where a.iban = ${iban} order by t.booking_date, t.bank_reference`;
  }

  async function stichtag(konto: { hash: string }) {
    const [s] = await sql<{ c: string | null }[]>`select cutover_date::text as c from import_sources where external_account_id = ${konto.hash}`;
    return s?.c;
  }

  it("legt beim ersten Abruf Bindung, Lieferung, Bewegungen und Umsätze an", async () => {
    const konto = neuesKonto();
    const r = await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-10-06", "10.00")]));
    expect(r).toMatchObject({ added: 2, skipped: 0, checkpoint: "2026-10-31", complete: true, replay: false });
    expect((await umsaetze(konto.iban)).map((u) => u.bank_reference)).toEqual(["ER-1", "ER-2"]);
    const [bindung] = await sql`select count(*)::int as n from import_sources where external_account_id = ${konto.hash}`;
    expect(bindung!.n).toBe(1);
    // Ohne Datei und ohne gewählten Tag beginnt die Quelle mit ihrem ersten Fenster
    expect(await stichtag(konto)).toBe("2026-10-01");
    const bewegungen = await sql`select m.source_event_id from import_movements m join import_sources s on s.id = m.source_id
      where s.external_account_id = ${konto.hash} order by 1`;
    expect(bewegungen.map((b) => b.source_event_id)).toEqual(["ER-1", "ER-2"]);
  });

  it("speichert die Referenzen jeder Bewegung, auch Bezug, Auszahlung und Bestellung", async () => {
    const konto = neuesKonto();
    const input = abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-10-06", "10.00")]);
    const [zahlung, zweite] = input.batch.movements;
    zahlung!.references = { ...zahlung!.references, relatedEventId: "ER-0", payoutId: "PO-7", orderId: "12-34567-89012", endToEndId: "E2E-1" };
    await speichere(input);
    const refs = await sql<{ id: string; refs: unknown }[]>`select m.source_event_id as id, m.refs from import_movements m
      join import_sources s on s.id = m.source_id where s.external_account_id = ${konto.hash} order by 1`;
    expect(refs).toEqual([
      { id: "ER-1", refs: { providerReference: "ER-1", relatedEventId: "ER-0", payoutId: "PO-7", orderId: "12-34567-89012", endToEndId: "E2E-1" } },
      { id: "ER-2", refs: zweite!.references },
    ]);
  });

  it("gibt dieselbe Lieferung noch einmal ohne neue Umsätze zurück", async () => {
    const konto = neuesKonto();
    const input = abruf(konto, [tx("ER-1", "2026-10-05")], { fetchId: "gleich" });
    await speichere(input);
    const r = await speichere(input);
    expect(r).toMatchObject({ added: 0, replay: true, checkpoint: "2026-10-31" });
    expect(await umsaetze(konto.iban)).toHaveLength(1);
  });

  it("lehnt denselben Schlüssel mit anderem Inhalt ab", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { fetchId: "gleich" }));
    await expect(speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-10-07")], { fetchId: "gleich" }))).rejects.toThrow(
      "kam schon mit anderem Inhalt",
    );
    expect(await umsaetze(konto.iban)).toHaveLength(1);
  });

  it("erkennt bekannte Bewegungen im überlappenden Folgeabruf und legt nur neue an", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")]));
    const r = await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-11-03", "5.00")], { from: "2026-10-01", to: "2026-11-05" }));
    expect(r).toMatchObject({ added: 1, skipped: 1, checkpoint: "2026-11-05" });
    expect((await umsaetze(konto.iban)).map((u) => u.bank_reference)).toEqual(["ER-1", "ER-2"]);
  });

  it("belegt wiederbeobachtete Referenzen und exakte Inhaltsübereinstimmungen im selben Vertragsabruf", async () => {
    const konto = neuesKonto();
    const stabil = tx("ER-1", "2026-10-05");
    const ohne = tx(null, "2026-10-06", "3.00", { transaction_id: "T-1" });
    await speichere(abruf(konto, [stabil, ohne], { fetchId: "erster" }));
    const input = abruf(konto, [{ ...stabil, remittance_information: ["Aktualisierter Text"] }, ohne], { fetchId: "wiederholt" });
    const result = await speichere(input);
    expect(result).toMatchObject({ added: 0, skipped: 2 });
    expect(await speichere(input)).toMatchObject({ added: 0, replay: true });
    const observed = await sql<{ ref: string }[]>`select t.bank_reference as ref from bank_import_transactions o
      join bank_imports i on i.id = o.bank_import_id join bank_transactions t on t.id = o.transaction_id
      where i.bank_account_id = ${result.accountId} and i.filename = ${input.source.filename} order by ref`;
    expect(observed.map(({ ref }) => ref)).toEqual(["ER-1", "T-1"]);
  });

  it.each([false, true])("meldet ähnliche Zahlungen nur ohne gemeinsamen Abruf (gemeinsam: %s)", async (gemeinsam) => {
    const konto = neuesKonto();
    const alt = tx(null, "2026-10-05", "49.99", { creditor_account: null, remittance_information: ["MUSTER K UND ENREFERENZ X0"] });
    const neu = tx(null, "2026-10-05", "49.99", { creditor_account: null, remittance_information: ["MUSTER KUNDENREFERENZ X"] });
    await speichere(abruf(konto, [alt]));
    const input = abruf(konto, gemeinsam ? [alt, neu] : [neu], { fetchId: "verdacht" });
    const result = await speichere(input);
    expect(result.added).toBe(1);
    expect(await speichere(input)).toMatchObject({ replay: true });
    expect(await umsaetze(konto.iban)).toHaveLength(2);
    const candidates = await sql`select r.decision, original.purpose as old, neu.purpose as new
      from bank_duplicate_reviews r join bank_transactions neu on neu.id = r.transaction_id
      join bank_transactions original on original.id = r.original_transaction_id where neu.bank_account_id = ${result.accountId}`;
    expect(candidates).toEqual(gemeinsam ? [] : [{ decision: "pending", old: "MUSTER K UND ENREFERENZ X0", new: "MUSTER KUNDENREFERENZ X" }]);
    const [selected] = await sql<{ id: string }[]>`select id from bank_transactions
      where bank_account_id = ${result.accountId} and purpose = 'MUSTER KUNDENREFERENZ X'`;
    const detail = await bank.transactionDetail(selected!.id);
    expect(detail?.duplicateReviews.map((r) => r.originalPurpose)).toEqual(gemeinsam ? [] : ["MUSTER K UND ENREFERENZ X0"]);
    const { umsatzauswahl } = await import("./umsatzauswahl.ts");
    const list = await umsatzauswahl([{ id: result.accountId, purpose: "geschaeft" }], "offen", "", { feld: "datum", richtung: "ab" });
    expect(list.find((row) => row.id === selected!.id)?.hint === "dublette").toBe(!gemeinsam);
    if (!gemeinsam) {
      const { decideDuplicate } = await import("./duplicate-review.ts");
      const { userMessage } = await import("../../errors.ts");
      const [review] = detail!.duplicateReviews;
      expect(detail).toMatchObject({ suggestions: [], direct: null, dauerbelege: [], lastschrift: null, sammelrechnung: null });
      expect((await speichere(abruf(konto, [alt, neu]))).added).toBe(0);
      expect((await bank.transactionDetail(selected!.id))?.duplicateReviews).toEqual([]);
      const stale = await decideDuplicate("test-bearbeiter", { id: review!.id, decision: "duplicate", requestId: crypto.randomUUID() }).catch(userMessage);
      expect(stale).toBe("Beide Umsätze stammen aus einem gemeinsamen Abruf");
      const [storedReview] = await sql`select decision from bank_duplicate_reviews where transaction_id = ${selected!.id}`;
      expect(storedReview?.decision).toBe("pending");
    }
  });

  it("erhält einen neuen Umsatz ohne Referenz neben einem gleichartigen, stabil zugeordneten Umsatz", async () => {
    const konto = neuesKonto();
    const stabil = tx("ER-1", "2026-10-05");
    const ohne = tx(null, "2026-10-05", "49.99", { transaction_id: "T-EIGEN" });
    await speichere(abruf(konto, [stabil]));
    expect((await speichere(abruf(konto, [ohne, stabil]))).added).toBe(1);
    expect((await speichere(abruf(konto, [stabil, ohne]))).added).toBe(0);
    expect((await umsaetze(konto.iban)).map((t) => t.bank_reference)).toEqual(["ER-1", "T-EIGEN"]);
  });

  it("meldet einen Dublettenverdacht auch bei Folgeabrufen ohne gebundene Kontokennung", async () => {
    const konto = neuesKonto();
    const window = { dateFrom: "2026-10-01", dateTo: "2026-10-31" };
    const save = (purpose: string, fetchId: string) =>
      db.db.transaction((txDb) =>
        bank.storeStatement(
          txDb,
          enableBankingStatement({
            account: { uid: "ungebunden", account_id: { iban: konto.iban }, name: "Geschäftskonto" },
            transactions: [tx("BANK-R", "2026-10-05", "49.99", { remittance_information: [purpose] })],
            balances: [],
            ...window,
          }),
          { filename: fetchId, sha256: fetchId },
          null,
        ),
      );
    await save("MUSTERREFERENZ 88X", "Abruf 1");
    await save("MUSTERREFERENZ 88", "Abruf 2");
    const [row] = await sql<{ id: string }[]>`select t.id from bank_transactions t join bank_accounts a on a.id = t.bank_account_id
      where a.iban = ${konto.iban} and t.purpose = 'MUSTERREFERENZ 88'`;
    expect((await bank.transactionDetail(row!.id))?.duplicateReviews).toMatchObject([{ originalPurpose: "MUSTERREFERENZ 88X" }]);
  });

  it("zeigt einen späteren gemeinsamen Abruf bei einer bestätigten Dublette an", async () => {
    const konto = neuesKonto();
    const original = tx(null, "2026-10-05", "49.99", { remittance_information: ["MUSTER 88X"] });
    const kandidat = tx(null, "2026-10-05", "49.99", { remittance_information: ["MUSTER 88"] });
    await speichere(abruf(konto, [original]));
    const { accountId } = await speichere(abruf(konto, [kandidat]));
    const [row] = await sql<{ id: string; transaction_id: string }[]>`select r.id, r.transaction_id from bank_duplicate_reviews r
      join bank_transactions t on t.id = r.transaction_id where t.bank_account_id = ${accountId}`;
    const { decideDuplicate } = await import("./duplicate-review.ts");
    await decideDuplicate("test-bearbeiter", { id: row!.id, decision: "duplicate", requestId: crypto.randomUUID() });
    await speichere(abruf(konto, [original, kandidat]));
    expect(await bank.transactionDetail(row!.transaction_id)).toMatchObject({
      transaction: { open: 0 },
      duplicateReviews: [{ decision: "duplicate", sharedFetch: true }],
    });
  });

  it("lässt bestätigte Verdachtsfälle im Umsatzbestand und korrigiert offenen Betrag und Saldo bis zur Rücknahme", async () => {
    const konto = neuesKonto();
    const alt = tx(null, "2026-10-05", "49.99", { remittance_information: ["Referenz X0"] });
    const neu = tx(null, "2026-10-05", "49.99", { remittance_information: ["Referenz X"] });
    await speichere(abruf(konto, [alt]));
    const { accountId } = await speichere(abruf(konto, [neu]));
    const [review] = await sql<{ id: string; transaction_id: string }[]>`
      select r.id, r.transaction_id from bank_duplicate_reviews r
      join bank_transactions t on t.id = r.transaction_id where t.bank_account_id = ${accountId}
    `;
    expect(review).toBeDefined();
    await sql`update bank_accounts set purpose = 'zahlungsdienstleister', provider = 'sonstige', iban = null, ledger_index = 1 where id = ${accountId}`;
    const account = async () => (await bank.listAccounts()).find((a) => a.id === accountId);
    expect(await account()).toMatchObject({ openCount: 2, providerBalance: -9998 });
    const { decideDuplicate } = await import("./duplicate-review.ts");
    const { searchBank } = await import("./search.ts");
    const searchHit = async () =>
      (await searchBank("Referenz X", ["bankTransactions"], 100)).bankTransactions?.hits.find((hit) => hit.id === review!.transaction_id);
    expect(await searchHit()).toMatchObject({ hint: "dublette", open: -4999 });
    const confirmation = { id: review!.id, decision: "duplicate", requestId: crypto.randomUUID() } as const;
    await Promise.all([decideDuplicate("test-bearbeiter", confirmation), decideDuplicate("test-bearbeiter", confirmation)]);
    expect(await account()).toMatchObject({ openCount: 1, providerBalance: -4999 });
    expect(await searchHit()).toMatchObject({ hint: "bestaetigteDublette", open: 0 });
    const confirmed = await bank.transactionDetail(review!.transaction_id);
    expect(confirmed).toMatchObject({
      transaction: { open: 0 },
      duplicateReviews: [{ id: review!.id, decision: "duplicate" }],
      suggestions: [],
    });
    const stored = await sql`select id from bank_transactions where bank_account_id = ${accountId}`;
    expect(stored).toHaveLength(2);
    const [decision] = await sql<{ id: string }[]>`select id from bank_duplicate_decisions where review_id = ${review!.id}`;
    const undo = { id: review!.id, decision: "pending", decisionId: decision!.id } as const;
    await decideDuplicate("test-bearbeiter", undo);
    await decideDuplicate("test-bearbeiter", confirmation);
    expect(await account()).toMatchObject({ openCount: 2, providerBalance: -9998 });
    expect(await searchHit()).toMatchObject({ hint: "dublette", open: -4999 });
    expect(await bank.transactionDetail(review!.transaction_id)).toMatchObject({
      transaction: { open: -4999 },
      duplicateReviews: [{ id: review!.id, decision: "pending" }],
    });
    const decisions = await sql`select d.decision, a.actor, a.action from bank_duplicate_decisions d
      join audit_log a on a.table_name = 'bank_duplicate_decisions' and a.row_id = d.id::text
      where d.review_id = ${review!.id} order by a.seq`;
    expect(decisions).toEqual([
      { decision: "duplicate", actor: "test-bearbeiter", action: "INSERT" },
      { decision: "pending", actor: "test-bearbeiter", action: "INSERT" },
    ]);
    await expect(sql`update bank_duplicate_decisions set decision = 'distinct' where review_id = ${review!.id}`).rejects.toThrow();
    await decideDuplicate("test-bearbeiter", { id: review!.id, decision: "distinct", requestId: crypto.randomUUID() });
    await decideDuplicate("test-bearbeiter", undo);
    expect(await bank.transactionDetail(review!.transaction_id)).toMatchObject({
      duplicateReviews: [{ id: review!.id, decision: "distinct" }],
    });
  });

  it("bietet einen offenen Dublettenverdacht nicht als Gegenumsatz zur Verrechnung an", async () => {
    const konto = neuesKonto();
    const original = tx(null, "2026-10-05", "49.99", { remittance_information: ["Gegenumsatz X0"] });
    const verdacht = tx(null, "2026-10-05", "49.99", { remittance_information: ["Gegenumsatz X"] });
    const eingang = tx("KONTO-EINGANG", "2026-10-06", "49.99", {
      credit_debit_indicator: "CRDT",
      remittance_information: ["Erstattung"],
    });
    await speichere(abruf(konto, [original]));
    const { accountId } = await speichere(abruf(konto, [verdacht, eingang]));
    const rows = await sql<{ id: string; purpose: string }[]>`select id, purpose from bank_transactions where bank_account_id = ${accountId}`;
    const id = (purpose: string) => rows.find((row) => row.purpose === purpose)!.id;
    const { neutralizationView } = await import("./neutralisierung.ts");
    expect((await neutralizationView(id("Erstattung"))).candidates.map((item) => item.id)).toEqual([id("Gegenumsatz X0")]);
    expect(await neutralizationView(id("Gegenumsatz X"))).toMatchObject({ candidates: [] });
  });

  it("bietet bei einer Auszahlung nur einen geklärten Gegenumsatz an", async () => {
    const konto = neuesKonto();
    const original = tx(null, "2026-10-05", "49.99", {
      credit_debit_indicator: "CRDT",
      debtor: { name: "Muster GmbH" },
      remittance_information: ["Auszahlungsbetrag X0"],
    });
    const verdacht = { ...original, debtor: { name: "PayPal" }, remittance_information: ["Auszahlungsbetrag X"] };
    await speichere(abruf(konto, [original]));
    const { accountId } = await speichere(abruf(konto, [verdacht]));
    const payout = tx("PAYOUT-REF", "2026-10-05", "49.99", { remittance_information: ["Auszahlung auf die Bank"] });
    const { accountId: providerId } = await speichere(abruf(neuesKonto(), [payout]));
    await sql`update bank_accounts set name = 'PayPal', purpose = 'zahlungsdienstleister', provider = 'paypal', iban = null, ledger_index = 2
      where id = ${providerId}`;
    const [providerRow] = await sql<{ id: string }[]>`select id from bank_transactions where bank_account_id = ${providerId}`;
    const [review] = await sql<{ id: string; transaction_id: string; original_transaction_id: string }[]>`
      select r.id, r.transaction_id, r.original_transaction_id from bank_duplicate_reviews r
      join bank_transactions t on t.id = r.transaction_id where t.bank_account_id = ${accountId}
    `;
    const payoutId = providerRow!.id;
    expect((await bank.transactionDetail(payoutId))?.direct).toMatchObject({
      kind: "geldtransit",
      counterpart: { id: review!.original_transaction_id },
    });
    const { decideDuplicate } = await import("./duplicate-review.ts");
    await decideDuplicate("test-bearbeiter", { id: review!.id, decision: "distinct", requestId: crypto.randomUUID() });
    expect((await bank.transactionDetail(payoutId))?.direct).toMatchObject({
      kind: "geldtransit",
      counterpart: { id: review!.transaction_id },
    });
  });

  it("belegt einen Umsatz in Euro nicht aufgrund eines referenzlosen Umsatzes in anderer Währung", async () => {
    const konto = neuesKonto();
    const eur = tx(null, "2026-10-05", "3.00", { transaction_id: "EUR" });
    const usd = { ...eur, transaction_id: "USD", transaction_amount: { currency: "USD", amount: "3.00" } };
    await speichere(abruf(konto, [eur]));
    const input = abruf(konto, [usd], { fetchId: "fremdwaehrung" });
    const result = await speichere(input);
    const observed = await sql`select o.transaction_id from bank_import_transactions o
      join bank_imports i on i.id = o.bank_import_id where i.bank_account_id = ${result.accountId} and i.filename = ${input.source.filename}`;
    expect(observed).toEqual([]);
  });

  it("behält einen gleichartigen Umsatz mit anderer entry_reference aus einem späteren Abruf", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")]));
    const r = await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-10-05")]));
    expect(r.added).toBe(1);
    expect((await umsaetze(konto.iban)).map((u) => u.bank_reference)).toEqual(["ER-1", "ER-2"]);
  });

  it("speichert bei einem Konflikt am Betrag nichts und lässt den Stand stehen", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    await expect(speichere(abruf(konto, [tx("ER-1", "2026-10-05", "50.00"), tx("ER-2", "2026-10-20")]))).rejects.toThrow(
      "ER-1/main: Betrag -49,99 € → -50,00 €; nichts überschrieben.",
    );
    expect(await umsaetze(konto.iban)).toHaveLength(1);
    const [stand] = await sql`select max(b.checkpoint)::text as c from import_batches b join import_sources s on s.id = b.source_id
      where s.external_account_id = ${konto.hash}`;
    expect(stand!.c).toBe("2026-10-10");
  });

  it("verbindet einen vor der Bindung importierten Umsatz, statt ihn doppelt anzulegen", async () => {
    const konto = neuesKonto();
    const alt = [tx("ER-1", "2026-10-05")];
    const vorher = abruf(konto, alt).statement;
    await db.db.transaction((t) => bank.storeStatement(t, vorher, { filename: "alter Abruf", sha256: "alt" }, null));
    const r = await speichere(abruf(konto, [...alt, tx("ER-2", "2026-10-06", "1.00")]));
    expect(r).toMatchObject({ added: 1, skipped: 1 });
    expect(await umsaetze(konto.iban)).toHaveLength(2);
    // Danach zählt die Quellenidentität: derselbe Abruf noch einmal legt nichts an
    expect((await speichere(abruf(konto, [...alt, tx("ER-2", "2026-10-06", "1.00")]))).added).toBe(0);
  });

  it("gleicht nach der Bindung nicht mehr über den Inhalt ab", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")]));
    // Eine Datei nach der Bindung bringt einen Umsatz, den die Bank später mit eigener Kennung liefert
    const datei = abruf(konto, [tx(null, "2026-10-08", "7.00", { transaction_id: "T-1" })]).statement;
    await db.db.transaction((t) => bank.storeStatement(t, datei, { filename: "datei", sha256: "datei" }, null));
    const r = await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-3", "2026-10-08", "7.00")]));
    expect(r.added).toBe(1);
    expect(await umsaetze(konto.iban)).toHaveLength(3);
  });

  it("erkennt Umsätze ohne entry_reference wie bisher am Inhalt", async () => {
    const konto = neuesKonto();
    const ohne = tx(null, "2026-10-05", "3.00", { transaction_id: "T-1" });
    await speichere(abruf(konto, [ohne]));
    const r = await speichere(abruf(konto, [{ ...ohne, transaction_id: "T-2" }]));
    expect(r).toMatchObject({ added: 0, skipped: 1, complete: true });
    expect(await umsaetze(konto.iban)).toHaveLength(1);
  });

  it("prüft auch Altumsätze ausgeschlossener Konten und lässt gemeinsam importierte Zahlungen unverändert", async () => {
    const konto = neuesKonto();
    const alt = tx(null, "2026-10-02", "49.99", { creditor_account: null, remittance_information: ["MUSTER K UND ENREFERENZ X0"] });
    const neu = tx(null, "2026-10-02", "49.99", { creditor_account: null, remittance_information: ["MUSTER KUNDENREFERENZ X"] });
    // Import vor dem Update: Es gab noch keine Verdachtsprüfung.
    async function historisch(zeilen: EbTransaction[]) {
      const input = abruf(konto, zeilen);
      return db.db.transaction((t) => bank.storeStatement(t, { ...input.statement, format: "camt053" }, input.source, null));
    }
    await historisch([alt]);
    const zweiter = await historisch([neu, ...[alt, neu].map((row) => ({ ...row, booking_date: "2026-10-03" }))]);
    await sql`update bank_accounts set excluded_at = now() where id = ${zweiter.accountId}`;
    const { runExistingDuplicateCheck } = await import("./duplicate-scan.ts");
    const parallel = await Promise.all([runExistingDuplicateCheck(), runExistingDuplicateCheck()]);
    expect(parallel.filter(Boolean)).toHaveLength(1);
    await sql`update bank_accounts set excluded_at = null where id = ${zweiter.accountId}`;
    expect(await runExistingDuplicateCheck()).toBeNull();
    expect(await umsaetze(konto.iban)).toHaveLength(4);
    const reviews = await sql`select t.booking_date::text as tag from bank_duplicate_reviews r join bank_transactions t on t.id = r.transaction_id
      where t.bank_account_id = ${zweiter.accountId}`;
    expect(reviews).toEqual([{ tag: "2026-10-02" }]);
    const markers = await sql`select id from bank_duplicate_check`;
    expect(markers).toEqual([{ id: 1 }]);
  });

  it("merkt im Abruf ohne Kontokennung auch wieder gelieferte Umsätze als gemeinsam beobachtet", async () => {
    const konto = neuesKonto();
    const bekannt = tx(null, "2026-10-05", "3.00", { transaction_id: "T-1" });
    const neu = tx(null, "2026-10-05", "3.00", { transaction_id: "T-2", remittance_information: ["Andere Zahlung"] });
    const alt = abruf(konto, [bekannt], { fetchId: "bekannt" });
    const erneut = abruf(konto, [bekannt, neu], { fetchId: "gemeinsam" });
    await db.db.transaction((t) => bank.storeStatement(t, alt.statement, alt.source, null));
    const result = await db.db.transaction((t) => bank.storeStatement(t, erneut.statement, erneut.source, null));
    expect(result).toMatchObject({ added: 1, skipped: 1 });
    const observed = await sql<{ ref: string }[]>`select t.bank_reference as ref from bank_imports i
      join bank_transactions t on t.import_id = i.id or exists (
        select 1 from bank_import_transactions o where o.bank_import_id = i.id and o.transaction_id = t.id
      )
      where i.bank_account_id = ${result.accountId} and i.filename = ${erneut.source.filename} order by ref`;
    expect(observed.map(({ ref }) => ref)).toEqual(["T-1", "T-2"]);
    expect(await umsaetze(konto.iban)).toHaveLength(2);
  });

  it.each(["getrennt", "gemeinsam", "einmal gelieferte Referenz", "mehrfach vergebene Referenz"])(
    "prüft den Enable-Banking-Abruf ohne Kontokennung: %s",
    async (fall) => {
      const konto = neuesKonto();
      const alt = tx(null, "2026-10-05", "49.99", { creditor_account: null, remittance_information: ["MUSTER K UND ENREFERENZ X0"] });
      const ref = fall.endsWith("Referenz") ? "ER-NEU" : null;
      const neu = tx(ref, "2026-10-05", "49.99", {
        creditor_account: null,
        remittance_information: ["MUSTER KUNDENREFERENZ X"],
      });
      const speichereOhneBindung = (zeilen: EbTransaction[]) => {
        const input = abruf(konto, zeilen);
        return db.db.transaction((t) => bank.storeStatement(t, input.statement, input.source, null));
      };
      await speichereOhneBindung([alt]);
      const mehrdeutig = fall === "mehrfach vergebene Referenz";
      const zeilen = fall === "gemeinsam" ? [alt, neu] : mehrdeutig ? [neu, tx(ref, "2026-10-06", "3.00")] : [neu];
      const result = await speichereOhneBindung(zeilen);
      expect(result.added).toBe(mehrdeutig ? 2 : 1);
      expect(await umsaetze(konto.iban)).toHaveLength(mehrdeutig ? 3 : 2);
      const [reviews] = await sql`select count(*)::int as n from bank_duplicate_reviews r join bank_transactions t on t.id = r.transaction_id
      where t.bank_account_id = ${result.accountId}`;
      expect(reviews!.n).toBe(fall === "gemeinsam" ? 0 : 1);
    },
  );

  it("behält zwei Umsätze derselben Lieferung mit wiederverwendeter Referenz und erkennt den nächsten Abruf", async () => {
    const konto = neuesKonto();
    const doppelt = [tx("ER-D", "2026-10-05"), tx("ER-D", "2026-10-05")];
    const input = abruf(konto, doppelt, { fetchId: "mehrfach" });
    expect((await speichere(input)).added).toBe(2);
    expect(await speichere(input)).toMatchObject({ added: 0, replay: true });
    await expect(speichere(abruf(konto, [...doppelt, tx("ER-D", "2026-10-05")], { fetchId: "mehrfach" }))).rejects.toThrow("kam schon mit anderem Inhalt");
    expect((await speichere(abruf(konto, doppelt))).added).toBe(0);
    expect(await umsaetze(konto.iban)).toHaveLength(2);
    const bewegungen = await sql`select m.source_event_id from import_movements m join import_sources s on s.id = m.source_id
      where s.external_account_id = ${konto.hash}`;
    expect(bewegungen).toEqual([]);
  });

  it("hält bei wiederverwendeter Referenz Stichtag, Abruffenster, Euro und Betrag ungleich null ein", async () => {
    const konto = neuesKonto();
    const gemeinsam = [
      tx("ER-D", "2026-10-06", "10.00"),
      tx("ER-D", "2026-10-07", "15.00"),
      tx("ER-D", "2026-10-02", "12.00"),
      tx("ER-D", "2026-11-02", "13.00"),
      tx("ER-D", "2026-10-08", "14.00", { transaction_amount: { amount: "14.00", currency: "USD" } }),
      tx("ER-D", "2026-10-09", "0.00"),
    ];
    const r = await speichere(abruf(konto, gemeinsam, { from: "2026-10-05", fetchFrom: "2026-10-05" }));
    expect(r).toMatchObject({ added: 2, checkpoint: "2026-10-07", complete: false });
    expect((await umsaetze(konto.iban)).map(({ amount }) => amount)).toEqual([-1000, -1500]);
  });

  it("verwendet eine früher mehrfach gelieferte Referenz beim Einzelabruf nicht als Quellenidentität", async () => {
    const konto = neuesKonto();
    const erster = tx("ER-D", "2026-10-05", "10.00");
    const zweiter = tx("ER-D", "2026-10-06", "15.00");
    await speichere(abruf(konto, [erster, zweiter]));
    const einzeln = abruf(konto, [zweiter], { fetchId: "einzeln" });
    expect(await speichere(einzeln)).toMatchObject({ added: 0, skipped: 1 });
    expect(await speichere(einzeln)).toMatchObject({ added: 0, replay: true });
    expect((await speichere(abruf(konto, [erster]))).added).toBe(0);
    const bewegungen = await sql`select m.source_event_id from import_movements m join import_sources s on s.id = m.source_id
      where s.external_account_id = ${konto.hash}`;
    expect(bewegungen).toEqual([]);
    expect(await umsaetze(konto.iban)).toHaveLength(2);
    const anderesKonto = neuesKonto();
    expect((await speichere(abruf(anderesKonto, [erster]))).added).toBe(1);
    const andereBewegungen = await sql`select m.source_event_id from import_movements m join import_sources s on s.id = m.source_id
      where s.external_account_id = ${anderesKonto.hash}`;
    expect(andereBewegungen.map((b) => b.source_event_id)).toEqual(["ER-D"]);
  });

  it("verliert neben einer stabilen Zuordnung keine gleichartigen Umsätze mit mehrfach vergebener Referenz", async () => {
    const konto = neuesKonto();
    const stabil = tx("ER-S", "2026-10-05");
    const doppelt = tx("ER-D", "2026-10-05");
    await speichere(abruf(konto, [stabil]));
    expect((await speichere(abruf(konto, [doppelt, doppelt, stabil]))).added).toBe(2);
    expect((await speichere(abruf(konto, [stabil, doppelt, doppelt]))).added).toBe(0);
    expect(await umsaetze(konto.iban)).toHaveLength(3);
  });

  it("zählt fehlende und früher mehrdeutige Referenzen bei gleichem Inhalt gemeinsam", async () => {
    const konto = neuesKonto();
    const mehrdeutig = tx("ER-D", "2026-10-05");
    const ohne = tx(null, "2026-10-05", "49.99", { transaction_id: "T-EIGEN" });
    await speichere(abruf(konto, [mehrdeutig, tx("ER-D", "2026-10-06")]));
    expect((await speichere(abruf(konto, [ohne, mehrdeutig]))).added).toBe(1);
    expect((await speichere(abruf(konto, [mehrdeutig, ohne]))).added).toBe(0);
    expect(await umsaetze(konto.iban)).toHaveLength(3);
  });

  it("rückt bei einem vorgemerkten Umsatz nur bis zum Vortag vor", async () => {
    const konto = neuesKonto();
    const r = await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-10-20", "1.00", { status: "PDNG" })]));
    expect(r).toMatchObject({ added: 1, checkpoint: "2026-10-19", complete: false });
  });

  it("behält den Stand der Quelle, auch wenn eine frühere Lieferung keinen hatte", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-P", "2026-10-01", "1.00", { status: "PDNG" })]));
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-P", "2026-10-01", "1.00")]));
    const r = await speichere(abruf(konto, [tx("ER-Q", "2026-10-26", "2.00", { status: "PDNG" })], { from: "2026-10-24", to: "2026-11-05" }));
    expect(r.checkpoint).toBe("2026-10-31");
  });

  it("speichert einen Abruf mit einem Umsatz nach dem Fenster und lässt diesen Umsatz für den Folgeabruf", async () => {
    const konto = neuesKonto();
    const r = await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-11-02", "1.00")]));
    expect(r).toMatchObject({ added: 1, checkpoint: "2026-10-31", complete: true });
    expect((await speichere(abruf(konto, [tx("ER-2", "2026-11-02", "1.00")], { from: "2026-10-25", to: "2026-11-05" }))).added).toBe(1);
  });

  it("übernimmt einen gebuchten Umsatz, den die Bank erst mit einem Buchungstag vor dem Fenster liefert", async () => {
    const konto = neuesKonto();
    // Bank filtert nach Valuta: ER-2 (gebucht 20.10., Valuta 12.11.) fehlt im ersten Abruf bis 31.10.
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")]));
    const spaet = tx("ER-2", "2026-10-20", "300.00", { value_date: "2026-11-12" });
    await speichere(abruf(konto, [spaet], { from: "2026-10-24", to: "2026-11-15" }));
    await speichere(abruf(konto, [spaet], { from: "2026-11-08", to: "2026-11-20" }));
    expect((await umsaetze(konto.iban)).map((u) => u.bank_reference)).toEqual(["ER-1", "ER-2"]);
  });

  it("legt einen Umsatz vor dem Fenster nicht doppelt an, wenn eine Datei nach der Bindung seinen Tag schon abdeckt", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    // Kontoauszug als Datei bis 31.10., hier mit demselben Verwendungszweck wie in der API; danach beginnt der Abruf am 01.11. (followUpStart)
    const datei = { ...abruf(konto, [tx("ER-2", "2026-10-30", "12.00")], { from: "2026-10-11" }).statement, format: "camt053" as const };
    await db.db.transaction((t) => bank.storeStatement(t, datei, { filename: "auszug.xml", sha256: `datei-${konto.hash}` }, null));
    // Die Bank filtert nach Valuta und liefert den Umsatz vom 30.10. im Fenster ab 01.11. noch einmal mit
    const r = await speichere(abruf(konto, [tx("ER-2", "2026-10-30", "12.00", { value_date: "2026-11-01" })], { from: "2026-11-01", to: "2026-11-05" }));
    expect(r.added).toBe(0);
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-4999, -1200]);
  });

  it("übernimmt einen Umsatz vor dem Fenster, den die Datei für seinen Tag nicht enthält", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    const datei = { ...abruf(konto, [tx("ER-2", "2026-10-30", "12.00")], { from: "2026-10-11" }).statement, format: "camt053" as const };
    await db.db.transaction((t) => bank.storeStatement(t, datei, { filename: "auszug.xml", sha256: `datei-${konto.hash}` }, null));
    // ER-3 hat die Bank am 30.10. nach dem Export der Datei gebucht, mit Valuta 01.11.
    const spaet = tx("ER-3", "2026-10-30", "77.00", { value_date: "2026-11-01", remittance_information: ["Miete November"] });
    const r = await speichere(abruf(konto, [spaet], { from: "2026-11-01", to: "2026-11-05" }));
    expect(r.added).toBe(1);
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-4999, -1200, -7700]);
  });

  it("rechnet jeden Umsatz der Datei vor dem Fenster nur einmal an", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    const datei = { ...abruf(konto, [tx("ER-2", "2026-10-30", "12.00")], { from: "2026-10-11" }).statement, format: "camt053" as const };
    await db.db.transaction((t) => bank.storeStatement(t, datei, { filename: "auszug.xml", sha256: `datei-${konto.hash}` }, null));
    // Zwei gleiche Beträge am 30.10., die Datei kennt einen davon
    const zwei = [tx("ER-2", "2026-10-30", "12.00", { value_date: "2026-11-01" }), tx("ER-4", "2026-10-30", "12.00", { value_date: "2026-11-01" })];
    expect((await speichere(abruf(konto, zwei, { from: "2026-11-01", to: "2026-11-05" }))).added).toBe(1);
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-4999, -1200, -1200]);
  });

  /** Kontoauszug als Datei (camt) mit ER-2 vom 30.10. über 12,00 €, im Verwendungszweck wie in der API */
  async function dateiMitEr2(konto: { iban: string; hash: string }) {
    const datei = { ...abruf(konto, [tx("ER-2", "2026-10-30", "12.00")], { from: "2026-10-11" }).statement, format: "camt053" as const };
    await db.db.transaction((t) => bank.storeStatement(t, datei, { filename: "auszug.xml", sha256: `datei-${konto.hash}` }, null));
  }
  const er2 = tx("ER-2", "2026-10-30", "12.00", { value_date: "2026-11-01" });
  const er4 = tx("ER-4", "2026-10-30", "12.00", { value_date: "2026-11-01", remittance_information: ["Andere Zahlung"] });

  it("setzt den Stichtag auf den Tag nach dem letzten Umsatz der Datei und lehnt Umsätze davor sichtbar ab", async () => {
    const konto = neuesKonto();
    await dateiMitEr2(konto);
    // Die Datei endet am 30.10.; ER-2 und ER-4 vom 30.10. gehören in die Zeit der Datei, nichts wird über Tag und Betrag abgeglichen
    const r = await speichere(abruf(konto, [er2, er4], { from: "2026-11-01", to: "2026-11-05", fetchId: `stichtag-${konto.hash}` }));
    expect(r.added).toBe(0);
    expect(await stichtag(konto)).toBe("2026-10-31");
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-1200]);
    const [lauf] = await sql<{ warnings: string[] }[]>`select warnings from bank_imports where filename = ${`Abruf stichtag-${konto.hash}`}`;
    expect(lauf!.warnings).toEqual([
      expect.stringContaining("ER-2: Vor dem Stichtag 2026-10-31"),
      expect.stringContaining("ER-4: Vor dem Stichtag 2026-10-31"),
    ]);
  });

  it("nimmt als Stichtag den gewählten Tag „Umsätze abrufen ab“, wenn er nach der Datei liegt", async () => {
    const konto = neuesKonto();
    await dateiMitEr2(konto);
    // Umzug unter dem Jahr: Die Tage vor dem 03.11. stehen in der alten Buchhaltung; ER-5 kommt verspätet vor dem Fenster
    const r = await speichere(abruf(konto, [tx("ER-5", "2026-11-02", "5.00")], { from: "2026-11-03", to: "2026-11-05", fetchFrom: "2026-11-03" }));
    expect(r.added).toBe(0);
    expect(await stichtag(konto)).toBe("2026-11-03");
  });

  it("bindet ein schon abgerufenes Konto ohne Doppelte und ohne Lücke am letzten Tag", async () => {
    const konto = neuesKonto();
    // Abruf vor dem Importvertrag (#1340) bis 20.10.
    const alt = abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-10-20", "2.00")], { to: "2026-10-20" }).statement;
    await db.db.transaction((t) => bank.storeStatement(t, alt, { filename: "alter Abruf", sha256: `alt-${konto.hash}` }, null));
    // Folgeabruf mit sieben Tagen Überlappung; ER-3 hat die Bank am 20.10. nach dem alten Abruf gebucht
    const spaet = tx("ER-3", "2026-10-20", "3.00", { remittance_information: ["Nachgebucht"] });
    const r = await speichere(
      abruf(konto, [tx("ER-2", "2026-10-20", "2.00"), spaet, tx("ER-5", "2026-10-24", "5.00")], { from: "2026-10-13", to: "2026-10-25" }),
    );
    expect(r.added).toBe(2);
    expect((await umsaetze(konto.iban)).map((u) => u.bank_reference)).toEqual(["ER-1", "ER-2", "ER-3", "ER-5"]);
    // Die Überlappung mit dem alten Abruf deckt der Alias ab; ein Stichtag nach dem 20.10. ließe ER-3 fallen
    expect(await stichtag(konto)).toBe("2026-10-13");
  });

  it("nimmt bei Datei und altem Abruf den Tag nach der Datei als Stichtag", async () => {
    const konto = neuesKonto();
    const datei = { ...abruf(konto, [tx("ER-1", "2026-10-10", "1.00")], { to: "2026-10-10" }).statement, format: "camt053" as const };
    await db.db.transaction((t) => bank.storeStatement(t, datei, { filename: "auszug.xml", sha256: `datei-${konto.hash}` }, null));
    const alt = abruf(konto, [tx("ER-2", "2026-10-15", "2.00")], { from: "2026-10-11", to: "2026-10-20" }).statement;
    await db.db.transaction((t) => bank.storeStatement(t, alt, { filename: "alter Abruf", sha256: `alt-${konto.hash}` }, null));
    expect((await speichere(abruf(konto, [tx("ER-2", "2026-10-15", "2.00")], { from: "2026-10-14", to: "2026-10-25" }))).added).toBe(0);
    expect(await stichtag(konto)).toBe("2026-10-11");
  });

  it("behält den gewählten Tag als Stichtag, wenn die Bank erst später liefert (Rückfall auf 89 Tage)", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { from: "2026-10-01", fetchFrom: "2026-09-01" }));
    expect(await stichtag(konto)).toBe("2026-09-01");
  });

  it("gleicht für eine Bindung ohne Stichtag (vor 3b) wie bisher über Tag und Betrag ab", async () => {
    const konto = neuesKonto();
    await dateiMitEr2(konto);
    await sql`insert into import_sources (bank_account_id, provider, external_account_id, account_kind)
      select id, 'enablebanking', ${konto.hash}, 'bank' from bank_accounts where iban = ${konto.iban}`;
    // ER-2 gehört per Alias zur Zeile der Datei, ER-4 ist ein anderer Umsatz mit gleichem Tag und Betrag
    expect((await speichere(abruf(konto, [er2, er4], { from: "2026-11-01", to: "2026-11-05" }))).added).toBe(1);
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-1200, -1200]);
    expect(await stichtag(konto)).toBeNull();
  });

  it("rechnet eine Zeile der Datei, die schon einer Bewegung gehört, im nächsten Abruf nicht an", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    await dateiMitEr2(konto);
    await speichere(abruf(konto, [er2], { from: "2026-11-01", to: "2026-11-05" }));
    expect((await speichere(abruf(konto, [er2, er4], { from: "2026-11-01", to: "2026-11-06" }))).added).toBe(1);
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-4999, -1200, -1200]);
  });

  it("verbindet einen Umsatz vor dem Fenster dauerhaft mit der Zeile der Datei", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    await dateiMitEr2(konto);
    // Abruf 1: ER-2 steht schon aus der Datei und wird mit ihr verbunden
    expect((await speichere(abruf(konto, [er2], { from: "2026-11-01", to: "2026-11-05" }))).added).toBe(0);
    // Abruf 2: ein anderer Umsatz mit gleichem Tag und Betrag ist neu, die Zeile der Datei ist verbraucht
    expect((await speichere(abruf(konto, [er4], { from: "2026-11-02", to: "2026-11-06" }))).added).toBe(1);
    // Derselbe Abruf noch einmal legt nichts an
    expect((await speichere(abruf(konto, [er2, er4], { from: "2026-11-02", to: "2026-11-06" }))).added).toBe(0);
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-4999, -1200, -1200]);
    const [verbunden] = await sql`select count(*)::int as n from import_movements m join import_sources s on s.id = m.source_id
      where s.external_account_id = ${konto.hash} and m.source_event_id = 'ER-2'`;
    expect(verbunden!.n).toBe(1);
  });

  it("hält die Hinweise einer Lieferung im Importprotokoll fest", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    await dateiMitEr2(konto);
    await speichere(abruf(konto, [er2], { from: "2026-11-01", to: "2026-11-05", fetchId: `protokoll-${konto.hash}` }));
    const [lauf] = await sql<{ warnings: string[] }[]>`select warnings from bank_imports where filename = ${`Abruf protokoll-${konto.hash}`}`;
    expect(lauf!.warnings).toEqual([expect.stringContaining("ER-2: Buchungstag 2026-10-30 vor dem Fenster")]);
  });

  it("lässt den Stand der Quelle trotz stornierter und abgelehnter Umsätze vorrücken", async () => {
    const konto = neuesKonto();
    const r = await speichere(
      abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-C", "2026-10-20", "5.00", { status: "CNCL" }), tx("ER-R", "2026-10-21", "6.00", { status: "RJCT" })]),
    );
    expect(r).toMatchObject({ added: 1, checkpoint: "2026-10-31", complete: true });
  });

  it("verbreitert das Fenster nicht um einen verspäteten Umsatz vor ihm", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    // 11.10. bis 19.10. hat kein Abruf geholt; ER-2 vom 05.10. kommt verspätet im Fenster ab 20.10.
    const r = await speichere(abruf(konto, [tx("ER-2", "2026-10-05", "3.00")], { from: "2026-10-20", to: "2026-10-31" }));
    expect(r).toMatchObject({ added: 1, checkpoint: "2026-10-10", complete: false });
  });

  it("zählt Tage einer Datei nur, wenn sie lückenlos an das abgerufene Fenster anschließen", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    // Die Datei deckt 15.10. bis 31.10.; 11.10. bis 14.10. hat weder ein Abruf noch eine Datei
    const datei = { ...abruf(konto, [tx("ER-7", "2026-10-20", "7.00")], { from: "2026-10-15" }).statement, format: "camt053" as const };
    await db.db.transaction((t) => bank.storeStatement(t, datei, { filename: "auszug.xml", sha256: `luecke-${konto.hash}` }, null));
    const r = await speichere(abruf(konto, [tx("ER-8", "2026-11-03", "8.00")], { from: "2026-11-01", to: "2026-11-05" }));
    expect(r).toMatchObject({ added: 1, checkpoint: "2026-10-10", complete: false });
  });

  it("lehnt eine Kennung ab, die schon mit einem anderen Konto verbunden ist", async () => {
    const konto = neuesKonto();
    const anderes = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")]));
    await expect(speichere(abruf({ iban: anderes.iban, hash: konto.hash }, [tx("ER-9", "2026-10-05")]))).rejects.toThrow(
      "schon mit einem anderen Konto verbunden",
    );
  });

  it("legt Zahlung und Gebühr desselben Ereignisses als zwei Umsätze an und erkennt beide beim nächsten Abruf (#306, Schritt 4)", async () => {
    const [psp] = await sql<{ id: string }[]>`insert into bank_accounts (name, purpose, provider) values ('Marktplatz', 'zahlungsdienstleister', 'sonstige')
      returning id`;
    const zahlung = { sourceEventId: "SALE-1", kind: "payment" as const, bookingDate: "2026-10-03", currency: "EUR", references: { orderId: "01-1" } };
    const lieferung = (fetchId: string) => ({
      contractVersion: 1,
      provider: "marktplatz",
      externalAccountId: "verkaeufer-1",
      idempotencyKey: fetchId,
      fetchedAt: "2026-10-31T23:00:00+01:00",
      coverage: { from: "2026-10-01", to: "2026-10-31" },
      part: { fetchId, index: 0, last: true },
      movements: [
        { ...zahlung, component: "main" as const, amount: 4999, counterpartyName: "Erika Beispiel", purpose: "Bestellung 01-1" },
        { ...zahlung, component: "fee" as const, amount: -1006, counterpartyName: "Marktplatz", purpose: "Gebühren zu Bestellung 01-1" },
      ],
      balances: [],
      unsupported: [],
    });
    const input = (fetchId: string) => {
      const batch = lieferung(fetchId);
      const { statement, eventOf } = statementFromBatch(batch, "psp");
      return {
        batch,
        binding: { provider: "marktplatz", externalAccountId: "verkaeufer-1", accountKind: "psp" as const },
        statement,
        eventOf,
        source: { filename: `Lieferung ${fetchId}`, sha256: fetchId.padEnd(64, "0") },
      };
    };
    const erste = await db.db.transaction((t) => importBatch.storeBatch(t, input("l-1"), psp!.id));
    expect(erste).toMatchObject({ added: 2, complete: true });
    const umsaetze = await sql`select amount, purpose from bank_transactions where bank_account_id = ${psp!.id} order by amount desc`;
    expect(umsaetze).toEqual([
      { amount: 4999, purpose: "Bestellung 01-1" },
      { amount: -1006, purpose: "Gebühr · Gebühren zu Bestellung 01-1" },
    ]);
    const bewegungen = await sql`select component from import_movements m join import_sources s on s.id = m.source_id
      where s.external_account_id = 'verkaeufer-1' order by 1`;
    expect(bewegungen.map((b) => b.component)).toEqual(["fee", "main"]);
    // Derselbe Inhalt in einer neuen Lieferung: beide bekannt, nichts doppelt
    expect(await db.db.transaction((t) => importBatch.storeBatch(t, input("l-2"), psp!.id))).toMatchObject({ added: 0 });
  });
});
