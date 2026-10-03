import { describe, expect, it } from "vitest";
import { checkXml, FakeElsterClient, fakeProtokollPdf } from "./fake-client.ts";
import { createElsterClient } from "./factory.ts";
import { EricProcessClient } from "./process-client.ts";
import { parseTransferTicket } from "./ticket.ts";
import { parseVastBeleg } from "./vast.ts";
import { buildUstvaXml, TEST_HERSTELLER_ID } from "./xml.ts";

const xml = (test = true) =>
  buildUstvaXml({
    period: { year: 2026, month: 1 },
    steuernummer13: "9198011310010",
    figures: { kz81: 100_000, kz86: 0, kz66: 0, kz83: 19_000 },
    datenlieferant: { name: "A", strasse: "B", plz: "1", ort: "C" },
    herstellerId: TEST_HERSTELLER_ID,
    produktVersion: "0.1.0",
    test,
  });

describe("FakeElsterClient", () => {
  const client = new FakeElsterClient();

  it("simuliert den Belegabruf mit lesbaren Belegen", async () => {
    const input = { idnr: "02293417683", veranlagungsjahr: 2025, datenlieferant: "Test", herstellerId: TEST_HERSTELLER_ID, test: true };
    const result = await client.fetchBelege(input, new Uint8Array([1]), "1234");
    expect(result.ok).toBe(true);
    expect(result.liste.map((b) => b.belegart)).toEqual(["VaSt_RBM", "VaSt_Pers1"]);
    expect(result.belege.every((b) => b.xml && parseVastBeleg(b.xml).length === 1)).toBe(true);
    expect((await client.fetchBelege({ ...input, idnr: "1" }, new Uint8Array([1]), "1234")).ok).toBe(false);
    expect((await client.fetchBelege(input, new Uint8Array([1]), "")).ok).toBe(false);
  });

  it("akzeptiert gültiges XML", async () => {
    expect((await client.validate(xml())).ok).toBe(true);
  });

  it("lehnt kaputtes XML und fehlende Kz83 ab", async () => {
    expect((await client.validate("<Elster><a></b></Elster>")).ok).toBe(false);
    expect((await client.validate("<Elster><a>")).ok).toBe(false);
    expect((await client.validate("kein xml")).ok).toBe(false);
    const ohneKz83 = await client.validate(xml().replace(/<Kz83>[^<]*<\/Kz83>/, ""));
    expect(ohneKz83.ok).toBe(false);
    expect(ohneKz83.message).toContain("83");
  });

  it("simuliert das Senden mit Ticket und PDF", async () => {
    const result = await client.send(xml(), new Uint8Array([1]), "1234", { test: true });
    expect(result.ok).toBe(true);
    expect(result.transferTicket).toMatch(/^fake-[0-9a-f]{16}$/);
    expect(parseTransferTicket(result.serverResponseXml)).toBe(result.transferTicket);
    expect(Buffer.from(result.pdf!).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("prüft den Testmerker gegen die Option", async () => {
    expect((await client.send(xml(false), new Uint8Array([1]), "1234", { test: true })).ok).toBe(false);
  });
});

describe("fakeProtokollPdf", () => {
  it("ist ein PDF mit stimmender xref-Tabelle", () => {
    const pdf = Buffer.from(fakeProtokollPdf()).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("keine echte \\334bermittlung");
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(startxref).startsWith("xref")).toBe(true);
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => expect(pdf.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
});

describe("checkXml", () => {
  it("erlaubt selbstschließende Elemente", () => {
    expect(checkXml("<Elster><a/><Kz83>1,00</Kz83></Elster>")).toBeUndefined();
  });
});

describe("createElsterClient", () => {
  it("nimmt den Fake ohne ERIC_HOME", () => {
    expect(createElsterClient({})).toBeInstanceOf(FakeElsterClient);
    expect(createElsterClient({ ERIC_HOME: " " })).toBeInstanceOf(FakeElsterClient);
  });

  it("nimmt ERiC mit ERIC_HOME", () => {
    expect(createElsterClient({ ERIC_HOME: "/opt/eric" })).toBeInstanceOf(EricProcessClient);
  });
});
