import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Beleg und bestätigte Bankzuordnungen gemeinsam stornieren (Postgres, #653)", () => {
  let sql: postgres.Sql;
  let documents: typeof import("./documents.ts");
  let cancellation: typeof import("./cancellation.ts");
  let bank: typeof import("../bank/index.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let sequence = 0;
  const actor = "storno-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    cancellation = await import("./cancellation.ts");
    bank = await import("../bank/index.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kr: "SKR03" | "SKR04" = "SKR03", vat: "ist" | "soll" = "ist") {
    await leeren(sql)`truncate document_cancellations, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, journal_ab)
      values (1, 'Musterbetrieb', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${kr}, ${vat}, 2026)`;
  }
  async function receipt() {
    sequence++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, sequence % 256, Math.floor(sequence / 256), 37]);
    const { id } = await documents.uploadDocument("fixture", { bytes, filename: `beleg-${sequence}.jpg` });
    await documents.updateDocument("fixture", id, {
      supplierName: "Codewerk Lizenzen GmbH",
      supplierUstId: "",
      invoiceNumber: `L-${sequence}`,
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    await documents.bookDocument("fixture", id);
    return id;
  }
  async function transaction(amount: string) {
    const purpose = `Zahlung-${++sequence}`;
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"20.09.26";"20.09.26";"Gebucht";"Musterbetrieb";"Codewerk Lizenzen GmbH";"${purpose}";"Ausgang";"DE02100100100006820101";"${amount}";"";"";""\n`;
    await bank.importStatement("fixture", { bytes: new TextEncoder().encode(csv), filename: `${purpose}.csv` }, null);
    return (await sql`select id from bank_transactions where purpose = ${purpose}`)[0]!.id as string;
  }
  const ids = async (transactionId: string) =>
    (
      await sql`select a.id from allocations a where a.transaction_id = ${transactionId}
    and a.reverses_id is null and not exists (select 1 from allocations r where r.reverses_id = a.id) order by a.id`
    ).map((a) => a.id as string);
  const allocate = (documentId: string, transactionId: string, amount: number) =>
    bank.allocate("fixture", { kind: "document", documentId, transactionId, amount });
  const cancel = (documentId: string, allocationIds: string[]) => cancellation.cancelDocument(actor, documentId, { allocationIds }, "2026-10-05");
  const counts = async () =>
    (
      await sql`select (select count(*) from allocations) as allocations, (select count(*) from write_offs) as writeoffs,
    (select count(*) from journal_entries) as journal, (select count(*) from journal_lines) as lines,
    (select count(*) from document_cancellations) as cancellations, (select count(*) from audit_log) as audit`
    )[0];
  async function cleanResult(documentId: string) {
    expect(Number((await sql`select coalesce(sum(amount), 0) as amount from allocations where document_id = ${documentId}`)[0]!.amount)).toBe(0);
    expect((await sql`select id from document_cancellations where document_id = ${documentId}`).length).toBe(1);
    expect((await reports.euerForYear(2026)).ausgaben.find((l) => l.key === "ausgabe:software")?.amount ?? 0).toBe(0);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
    expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month: 9 })).zeilen)).toEqual([]);
  }

  for (const kr of ["SKR03", "SKR04"] as const)
    for (const vat of ["ist", "soll"] as const) {
      const profile = `${kr}, ${vat}`;
      it(`bestätigte Zahlung und Beleg stornieren, Originale unverändert (${profile})`, async () => {
        await reset(kr, vat);
        const id = await receipt();
        const tx = await transaction("-119,00");
        await allocate(id, tx, -11_900);
        const beforeDoc = await sql`select * from documents where id = ${id}`;
        const beforeBank = await sql`select * from bank_transactions where id = ${tx}`;
        await cancel(id, await ids(tx));
        await cleanResult(id);
        expect(await sql`select * from documents where id = ${id}`).toEqual(beforeDoc);
        expect(await sql`select * from bank_transactions where id = ${tx}`).toEqual(beforeBank);
        expect((await bank.transactionDetail(tx))!.transaction.open).toBe(-11_900);
        const actors = await sql`select l.actor from allocations a join audit_log l on l.table_name = 'allocations'
          and l.action = 'INSERT' and l.row_id = a.id::text where a.document_id = ${id} and a.reverses_id is not null`;
        expect(actors).toEqual([{ actor }]);
        expect((await sql`select l.account, sum(l.debit-l.credit) as saldo from journal_lines l group by l.account`).every((r) => Number(r.saldo) === 0)).toBe(
          true,
        );
      });
      it(`mehrere Teilzahlungen vollständig gemeinsam zurücknehmen (${profile})`, async () => {
        await reset(kr, vat);
        const id = await receipt();
        const first = await transaction("-59,50");
        const second = await transaction("-59,50");
        await allocate(id, first, -5_950);
        await allocate(id, second, -5_950);
        await cancel(id, [...(await ids(first)), ...(await ids(second))]);
        await cleanResult(id);
        expect((await bank.transactionDetail(first))!.transaction.open).toBe(-5_950);
        expect((await bank.transactionDetail(second))!.transaction.open).toBe(-5_950);
      });
      it(`mit der Zahlung verknüpftes Skonto ebenfalls zurücknehmen (${profile})`, async () => {
        await reset(kr, vat);
        const id = await receipt();
        const tx = await transaction("-116,62");
        await bank.allocateWithRest("fixture", { transactionId: tx, target: { kind: "document", documentId: id }, rest: "skontoErhalten" });
        await cancel(id, await ids(tx));
        await cleanResult(id);
        expect(Number((await sql`select sum(amount) as amount from write_offs where document_id = ${id}`)[0]!.amount)).toBe(0);
        expect((await sql`select id from write_offs where document_id = ${id}`).length).toBe(2);
      });
      it(`bestätigte ganze Aufteilung aufheben, unabhängige Zuordnung erhalten (${profile})`, async () => {
        await reset(kr, vat);
        const id = await receipt();
        const other = await receipt();
        const independent = await receipt();
        const tx = await transaction("-239,00");
        const separate = await transaction("-119,00");
        await allocate(independent, separate, -11_900);
        const untouched = await sql`select * from allocations where transaction_id = ${separate}`;
        await bank.allocateSplit("fixture", {
          transactionId: tx,
          parts: [
            { kind: "document", documentId: id, amount: -11_900 },
            { kind: "document", documentId: other, amount: -11_900 },
            { kind: "gebuehren", amount: -100 },
          ],
        });
        await cancel(id, await ids(tx));
        expect(await ids(tx)).toEqual([]);
        expect((await bank.transactionDetail(tx))!.transaction.open).toBe(-23_900);
        expect(await sql`select * from allocations where transaction_id = ${separate}`).toEqual(untouched);
        expect((await sql`select id from document_cancellations where document_id = ${other}`).length).toBe(0);
        expect((await reports.euerForYear(2026)).ausgaben.find((l) => l.key === "ausgabe:software")?.amount).toBe(10_000);
        expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
      });
      it(`ohne ausdrückliche Bestätigung keine Bankzuordnung aufheben (${profile})`, async () => {
        await reset(kr, vat);
        const id = await receipt();
        const tx = await transaction("-119,00");
        await allocate(id, tx, -11_900);
        const before = await counts();
        await expect(cancellation.cancelDocument(actor, id, {}, "2026-10-05")).rejects.toThrow(/Zuordnung auf/);
        expect(await counts()).toEqual(before);
      });
      it(`abgeschlossenes Zahlungsjahr: die Gegenbuchungen fallen ins offene Jahr, 2026 bleibt unberührt (${profile})`, async () => {
        await reset(kr, vat);
        await sql`update company set rechtsform = 'gmbh' where id = 1`;
        const id = await receipt();
        const tx = await transaction("-116,62");
        await bank.allocateWithRest("fixture", { transactionId: tx, target: { kind: "document", documentId: id }, rest: "skontoErhalten" });
        const allocationIds = await ids(tx);
        await sql`insert into year_closings (year) values (2026)`;
        // Storno im Folgejahr: Der Beleg bleibt im abgeschlossenen Jahr stehen, die Gegenzeilen wirken 2027 (#782).
        // Früher trugen sie das Datum der Zahlung und liefen deshalb in die Sperre des abgeschlossenen Jahres.
        const geschlossen = async () =>
          (
            await sql`select count(*)::int as n, coalesce(sum(l.debit), 0)::int as debit, coalesce(sum(l.credit), 0)::int as credit
            from journal_lines l join journal_entries e on e.id = l.entry_id where e.date < '2027-01-01'`
          )[0];
        const vorher = await geschlossen();
        await cancellation.cancelDocument(actor, id, { allocationIds }, "2027-01-05");
        expect(await geschlossen()).toEqual(vorher);
        expect((await sql`select date from journal_entries where date >= '2027-01-01'`).every((r) => r.date === "2027-01-05")).toBe(true);
        expect(await ids(tx)).toEqual([]);
        expect(Number((await sql`select coalesce(sum(amount), 0) as amount from allocations where document_id = ${id}`)[0]!.amount)).toBe(0);
        expect((await sql`select id from document_cancellations where document_id = ${id}`).length).toBe(1);
      });
    }
  it("nach der Rückfrage hinzugekommene Zahlung verlangt eine neue Bestätigung", async () => {
    await reset();
    const id = await receipt();
    const first = await transaction("-59,50");
    await allocate(id, first, -5_950);
    const confirmed = await ids(first);
    const second = await transaction("-59,50");
    await allocate(id, second, -5_950);
    const before = await counts();
    await expect(cancel(id, confirmed)).rejects.toThrow(/Bankzuordnungen.*geändert/);
    expect(await counts()).toEqual(before);
  });
  it("separate Ausbuchung verhindert den Storno und rollt auch bereits erzeugte Bankgegenzeilen zurück", async () => {
    await reset();
    const id = await receipt();
    const tx = await transaction("-116,62");
    await allocate(id, tx, -11_662);
    await bank.writeOff("fixture", { kind: "skontoErhalten", documentId: id, date: "2026-09-20" });
    const confirmed = await ids(tx);
    const before = await counts();
    await expect(cancel(id, confirmed)).rejects.toThrow(/Ausbuchung/);
    expect(await counts()).toEqual(before);
    expect(await ids(tx)).toEqual(confirmed);
  });
  it("fremde Zuordnungs-ID kann keine andere Zahlung aufheben oder einen unbezahlten Beleg stornieren", async () => {
    await reset();
    const id = await receipt();
    const other = await receipt();
    const tx = await transaction("-119,00");
    await allocate(other, tx, -11_900);
    const before = await counts();
    await expect(cancel(id, await ids(tx))).rejects.toThrow(/Bankzuordnungen.*geändert/);
    expect(await counts()).toEqual(before);
  });
  it("zwei gleichzeitige Stornoklicks erzeugen nur eine Gegenbuchung je Ausgangsbuchung", async () => {
    await reset();
    const id = await receipt();
    const tx = await transaction("-119,00");
    await allocate(id, tx, -11_900);
    const confirmed = await ids(tx);
    const results = await Promise.allSettled([cancel(id, confirmed), cancel(id, confirmed)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await sql`select id from allocations where transaction_id = ${tx}`).length).toBe(2);
    await cleanResult(id);
  });
});
