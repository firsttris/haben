import { setTimeout as pause } from "node:timers/promises";
import { voucherField } from "@haben/core";
import { expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

it.skipIf(!testDatabaseUrl)(
  "verhindert DATEV-Kollisionen beim parallelen Festschreiben in zwei Jahreskreisen",
  async () => {
    const sql = await setupTestDb();
    try {
      const invoices = await import("./index.ts");
      const { saveNumberFormats } = await import("./number-formats.ts");
      const { createContact } = await import("../stammdaten/contacts.ts");
      await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstrasse 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
      const actor = "test-user";
      await saveNumberFormats(actor, { invoice: "{KUNDENNR}_{JJ}_{N}", quote: "AN-{JJJJ}-{NNN}" });
      await invoices.setNextNumber(actor, "2025-12-31", 261);
      const draft = async (kundennummer: string, issueDate: string) => {
        const contact = await createContact(actor, {
          kundennummer,
          name: "Testkunde GmbH",
          strasse: "Werkstrasse 9",
          plz: "10115",
          ort: "Berlin",
          land: "DE",
          email: "",
          ustId: "",
          iban: "",
          leitwegId: "",
          defaultFormat: null,
        });
        return invoices.createDraft(actor, {
          contactId: contact.id,
          issueDate,
          serviceFrom: null,
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd",
          note: "",
          lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
        });
      };
      const first = await draft("A", "2025-12-31");
      const second = await draft("A25", "2026-01-01");
      let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
      let waiting = 0;
      await sql.begin(async (blocker) => {
        // Beide Transaktionen erreichen eine Schreibsperre, bevor eine von ihnen committen kann.
        await blocker`select haben_lock_audit_chain()`;
        pending = Promise.allSettled([
          invoices.finalizeInvoice(actor, first.id, kleinunternehmerStand),
          invoices.finalizeInvoice(actor, second.id, kleinunternehmerStand),
        ]);
        const deadline = Date.now() + 5_000;
        do {
          const [row] =
            await blocker`select count(*)::int as count from pg_locks waiter join pg_locks holder on holder.locktype = waiter.locktype and holder.database = waiter.database and holder.classid = waiter.classid and holder.objid = waiter.objid and holder.objsubid = waiter.objsubid where holder.pid = pg_backend_pid() and holder.locktype = 'advisory' and holder.granted and not waiter.granted`;
          waiting = row!.count;
          if (waiting === 2) break;
          await pause(20);
        } while (Date.now() < deadline);
      });
      const outcomes = await pending!;
      expect(waiting, JSON.stringify(outcomes.map(({ status }) => status))).toBe(2);
      const rows = await sql`select number from invoices where status = 'final' order by number`;
      const fields = rows.map((row) => voucherField(row.number));
      expect(fields, `Festgeschrieben: ${rows.map((row) => row.number).join(", ")}`).toEqual(["A25261"]);
      // Der Verlierer rollt atomar zurück: Der Entwurf bleibt Entwurf und der Kreis verbraucht seine Nummer nicht.
      const rejectedIndex = outcomes.findIndex((outcome) => outcome.status === "rejected");
      const rejectedDraft = rejectedIndex === 0 ? first : second;
      const rejectedYear = rejectedIndex === 0 ? 2025 : 2026;
      const [rejectedRow] = await sql`select status from invoices where id = ${rejectedDraft.id}`;
      expect(rejectedRow!.status).toBe("draft");
      const [counter] = await sql`select last from invoice_number_counters where year = ${rejectedYear}`;
      expect(counter?.last ?? 0).toBe(rejectedIndex === 0 ? 260 : 0);
      const rejection = outcomes.find((outcome) => outcome.status === "rejected");
      expect(rejection?.reason).toMatchObject({ message: expect.stringContaining("Belegfeld 1") });
    } finally {
      await sql.end();
    }
  },
  20_000,
);
