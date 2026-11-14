import { describe, expect, it } from "vitest";
import { documentSplitPosting } from "./document-split.ts";
import { ACCOUNTS, documentPosting, EXPENSE_CATEGORIES, type PostingLine } from "./posting.ts";

const saldo = (lines: PostingLine[], account: string) => lines.filter((l) => l.account === account).reduce((sum, l) => sum + l.debit - l.credit, 0);

describe("Teilvorsteuer und Kontierung (#433)", () => {
  it.each(["SKR03", "SKR04"] as const)("%s: Aufteilung rundet den Abzug erst je Satz, dann je Sachkonto", (kr) => {
    const totals = { net: 2, tax: 2, gross: 4, taxes: [{ rate: 1900, base: 2, tax: 2, vorsteuerAnteil: 5_000 }] };
    const lines = documentSplitPosting(
      totals,
      [
        { category: "software", taxRate: 1900, net: 1, tax: 1 },
        { category: "buero", taxRate: 1900, net: 1, tax: 1 },
      ],
      kr,
      "einzelunternehmen",
      "bank",
      true,
    );
    expect(saldo(lines, ACCOUNTS[kr].vorsteuer[1900])).toBe(1);
    expect(saldo(lines, EXPENSE_CATEGORIES.software[kr]) + saldo(lines, EXPENSE_CATEGORIES.buero[kr])).toBe(3);
    expect(saldo(lines, ACCOUNTS[kr].verbindlichkeiten)).toBe(-4);
  });

  it("§ 13b mit 20 % Privatanteil und 50 % Abzug: volle Steuerschuld, nur betrieblicher Teil abziehbar", () => {
    const totals = { net: 10_000, tax: 1_900, gross: 10_000, taxes: [{ rate: 1900, base: 10_000, tax: 1_900, vorsteuerAnteil: 5_000 }] };
    const lines = documentPosting(totals, "software", "SKR03", "einzelunternehmen", "bank", true, undefined, 20, "eu");
    expect(saldo(lines, "4964")).toBe(8_760);
    expect(saldo(lines, ACCOUNTS.SKR03.vorsteuerRc)).toBe(760);
    expect(saldo(lines, ACCOUNTS.SKR03.ustRc)).toBe(-1_900);
    expect(saldo(lines, ACCOUNTS.SKR03.privatentnahmen)).toBe(2_380);
    expect(lines.reduce((sum, l) => sum + l.debit - l.credit, 0)).toBe(0);
  });

  it("negative Rechnung und positive Rechnung runden den Teilabzug spiegelbildlich", () => {
    const book = (sign: number) =>
      documentPosting(
        { net: sign * 10, tax: sign * 3, gross: sign * 13, taxes: [{ rate: 1900, base: sign * 10, tax: sign * 3, vorsteuerAnteil: 3_333 }] },
        "software",
        "SKR04",
        "einzelunternehmen",
        "bank",
        true,
      );
    expect(saldo(book(1), ACCOUNTS.SKR04.vorsteuer[1900])).toBe(1);
    expect(saldo(book(-1), ACCOUNTS.SKR04.vorsteuer[1900])).toBe(-1);
    expect(saldo(book(-1), "6837")).toBe(-12);
  });
});
