import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** Fehlermeldung samt Ursache: Drizzle verpackt den Fehler der Datenbank in „Failed query“ */
async function failure(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const e = error as Error & { cause?: Error };
    return `${e.message} ${e.cause?.message ?? ""}`;
  }
  throw new Error("Erwartet war ein Fehler");
}

describe.skipIf(!testDatabaseUrl)("Rechtsform: GmbH und UG (Postgres)", () => {
  let sql: postgres.Sql;
  let company: typeof import("./company.ts");
  let guard: typeof import("./settings-guard.ts");
  let cash: typeof import("../bank/cash.ts");
  let documents: typeof import("../belege/documents.ts");
  let pauschalen: typeof import("../buchhaltung/pauschalen.ts");
  let assets: typeof import("../buchhaltung/assets.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  const actor = "test-user";
  const today = "2026-10-04";

  beforeAll(async () => {
    sql = await setupTestDb();
    company = await import("./company.ts");
    guard = await import("./settings-guard.ts");
    cash = await import("../bank/cash.ts");
    documents = await import("../belege/documents.ts");
    pauschalen = await import("../buchhaltung/pauschalen.ts");
    assets = await import("../buchhaltung/assets.ts");
    annual = await import("../jahreserklaerung/annual.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(rechtsform: "einzelunternehmen" | "gmbh" | "ug", kontenrahmen: "SKR03" | "SKR04" = "SKR03", versteuerung: "ist" | "soll" = "ist") {
    await sql`truncate cash_entries, pauschalen, asset_depreciations, assets, journal_lines, journal_entries, document_amounts, documents, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Testfirma GmbH', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY',
              ${kontenrahmen}, ${versteuerung}, ${rechtsform})`;
  }

  const linesOf = async (sourceId: string) =>
    (
      await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
        where e.source_id = ${sourceId} order by l.debit desc, l.account`
    ).map((l) => ({ ...l }));

  async function document(payment: "bank" | "privat", privateShare = 0) {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: "rechnung.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Schreibwaren Huber",
      supplierUstId: "",
      invoiceNumber: "R-1",
      documentDate: "2026-10-02",
      dueDate: null,
      category: "telefon",
      payment,
      privateShare,
      note: "",
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    return id;
  }

  beforeEach(async () => {
    await setup("einzelunternehmen");
  });

  describe("Festlegen", () => {
    it("ist frei bis zur ersten Buchung, danach in App und Datenbank gesperrt", async () => {
      const before = company.companySchema.parse(await company.loadCompany());
      expect(before.rechtsform).toBe("einzelunternehmen");
      expect((await guard.settingsLocks(today)).rechtsform).toBeNull();
      await guard.saveCompany(actor, { ...before, rechtsform: "gmbh" }, today);
      expect((await company.loadCompany()).rechtsform).toBe("gmbh");

      await cash.createCashEntry(actor, { kind: "einlage", date: "2026-10-01", amount: 5_000 }, today);
      expect((await guard.settingsLocks(today)).rechtsform).toMatch(/vor der ersten Buchung/);
      const current = company.companySchema.parse(await company.loadCompany());
      await expect(guard.saveCompany(actor, { ...current, rechtsform: "ug" }, today)).rejects.toThrow(/^Rechtsform: Es gibt schon Buchungen/);
      // Auch an der App vorbei und mit einem Datum, an dem die Jahressperre nicht mehr greift
      expect(await failure(sql`update company set rechtsform = 'einzelunternehmen'`)).toMatch(/Rechtsform lässt sich nur vor der ersten Buchung/);
      expect(await failure(guard.saveCompany(actor, { ...current, rechtsform: "ug" }, "2027-01-02"))).toMatch(/Rechtsform/);
      expect((await company.loadCompany()).rechtsform).toBe("gmbh");
      // Andere Felder bleiben änderbar
      await guard.saveCompany(actor, { ...current, name: "Neue Firma GmbH" }, today);
      expect(await company.loadCompany()).toMatchObject({ name: "Neue Firma GmbH", rechtsform: "gmbh" });
    }, 30_000);

    it("GmbH: Kontenrahmen fest ab der ersten Buchung, auch zum Jahreswechsel; im Einzelunternehmen nicht", async () => {
      // Gebucht ist nur im Vorjahr; die Jahressperre greift im neuen Jahr nicht mehr
      const neujahr = "2026-01-05";
      for (const rechtsform of ["gmbh", "einzelunternehmen"] as const) {
        await setup(rechtsform);
        await cash.createCashEntry(actor, { kind: "einlage", date: "2025-12-15", amount: 5_000 }, neujahr);
        const current = company.companySchema.parse(await company.loadCompany());
        if (rechtsform === "gmbh") {
          // Die Vorträge der Bestandskonten stehen im alten Kontenrahmen und kämen im neuen nicht an
          expect((await guard.settingsLocks(neujahr)).kontenrahmen).toMatch(/GmbH und UG/);
          await expect(guard.saveCompany(actor, { ...current, kontenrahmen: "SKR04" }, neujahr)).rejects.toThrow(/^Kontenrahmen: /);
          expect(await failure(sql`update company set kontenrahmen = 'SKR04'`)).toMatch(/Kontenrahmen einer GmbH oder UG/);
          expect((await company.loadCompany()).kontenrahmen).toBe("SKR03");
        } else {
          await guard.saveCompany(actor, { ...current, kontenrahmen: "SKR04" }, neujahr);
          expect((await company.loadCompany()).kontenrahmen).toBe("SKR04");
        }
      }
    }, 30_000);

    it("lehnt unbekannte Rechtsformen und Privatanteile einer GmbH ab", async () => {
      expect(await failure(sql`update company set rechtsform = 'ag'`)).toMatch(/company_rechtsform/);
      const current = company.companySchema.parse(await company.loadCompany());
      expect(company.companySchema.safeParse({ ...current, rechtsform: "gmbh", privateShares: { telefon: 20 } }).success).toBe(false);
      expect(company.companySchema.safeParse({ ...current, rechtsform: "einzelunternehmen", privateShares: { telefon: 20 } }).success).toBe(true);
    });
  });

  describe.each([
    ["SKR03", "0730", "1000", "1890", "1800"],
    ["SKR04", "3510", "1600", "2180", "2100"],
  ] as const)("%s", (kontenrahmen, gesellschafter, kasse, einlage, entnahme) => {
    it.each(["ist", "soll"] as const)(
      "GmbH, %s-Versteuerung: Kasse und ausgelegter Beleg gehen auf das Verrechnungskonto",
      async (versteuerung) => {
        await setup("gmbh", kontenrahmen, versteuerung);
        const ein = await cash.createCashEntry(actor, { kind: "einlage", date: "2026-10-01", amount: 5_000 }, today);
        const aus = await cash.createCashEntry(actor, { kind: "entnahme", date: "2026-10-02", amount: 2_000 }, today);
        expect(await linesOf(ein.id)).toEqual([
          { account: kasse, debit: 5_000, credit: 0 },
          { account: gesellschafter, debit: 0, credit: 5_000 },
        ]);
        expect(await linesOf(aus.id)).toEqual([
          { account: gesellschafter, debit: 2_000, credit: 0 },
          { account: kasse, debit: 0, credit: 2_000 },
        ]);
        expect((await cash.cashBookCsv(2026)).split("\n")[2]).toContain('"Vom Gesellschafter"');

        const beleg = await document("privat");
        await documents.bookDocument(actor, beleg);
        expect((await linesOf(beleg)).at(-1)).toEqual({ account: gesellschafter, debit: 0, credit: 11_900 });
      },
      30_000,
    );

    it("UG wie GmbH, Einzelunternehmen weiter mit Privatkonten", async () => {
      await setup("ug", kontenrahmen);
      const ug = await cash.createCashEntry(actor, { kind: "einlage", date: "2026-10-01", amount: 100 }, today);
      expect((await linesOf(ug.id)).map((l) => l.account)).toEqual([kasse, gesellschafter]);

      await setup("einzelunternehmen", kontenrahmen);
      const ein = await cash.createCashEntry(actor, { kind: "einlage", date: "2026-10-01", amount: 100 }, today);
      const aus = await cash.createCashEntry(actor, { kind: "entnahme", date: "2026-10-01", amount: 100 }, today);
      expect((await linesOf(ein.id)).map((l) => l.account)).toEqual([kasse, einlage]);
      expect((await linesOf(aus.id)).map((l) => l.account)).toEqual([entnahme, kasse]);
    }, 30_000);
  });

  describe("Was es nur im Einzelunternehmen gibt", () => {
    beforeEach(async () => {
      await setup("gmbh");
    });

    it("Privatanteil am Beleg", async () => {
      const beleg = await document("bank", 20);
      await expect(documents.bookDocument(actor, beleg)).rejects.toThrow(/Privatanteil gibt es nur im Einzelunternehmen/);
      expect(await sql`select status from documents where id = ${beleg}`).toEqual([{ status: "neu" }]);
    });

    it("Pauschalen", async () => {
      await expect(pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-09", tage: 5 }, today)).rejects.toThrow(
        /Pauschalen gibt es nur im Einzelunternehmen/,
      );
      expect(await sql`select id from journal_entries`).toEqual([]);
    });

    it("Privatnutzung eines Fahrzeugs", async () => {
      const car = {
        name: "Tesla",
        kind: "kfz" as const,
        method: "linear" as const,
        acquisitionDate: "2024-01-10",
        cost: 4_800_000,
        usefulLifeMonths: 72,
        openingDate: "2026-01-01",
        openingBookValue: 3_200_000,
        disposalDate: null,
        note: "",
      };
      await expect(assets.createAsset(actor, { ...car, privateUse: { listPrice: 5_890_000, drive: "elektro", rate: 25, vat: true } })).rejects.toThrow(
        /nur im Einzelunternehmen/,
      );
      const created = await assets.createAsset(actor, car);
      expect(created.privateUse).toBeNull();
    });

    it("Anlage EÜR und Einkommensteuer; die Umsatzsteuererklärung bleibt", async () => {
      await expect(annual.checkAnnual("euer", 2025, today)).rejects.toThrow(/Eine GmbH gibt keine Anlage EÜR/);
      await expect(annual.checkAnnual("est", 2025, today)).rejects.toThrow(/keine Einkommensteuererklärung/);
      // Die Umsatzsteuer prüft weiter wie bisher; ohne Umsätze meldet sie die Nullerklärung, nicht die Rechtsform
      await expect(annual.checkAnnual("ust", 2025, today)).rejects.toThrow(/Nullerklärung/);
      expect((await annual.annualOverview(2025, today)).rechtsform).toBe("gmbh");
    }, 30_000);
  });
});
