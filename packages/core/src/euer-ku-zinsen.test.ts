import { describe, expect, it } from "vitest";
import { computeEuer, type EuerPayment } from "./euer.ts";
import { euerAusZeilen, euerZuordnung } from "./journal-euer.ts";
import { ACCOUNTS, directPosting } from "./posting.ts";
import { STEUER_KONTEN } from "./steuerzahlung.ts";

// Amtliche Anleitung EÜR 2025, Zeilen 12, 16 und 18: KU-Betriebseinnahmen einschließlich Zinsen in Zeile 12;
// die Umsatzsteuererstattung selbst bleibt in Zeile 18. Keine Aussage zum §-19-Gesamtumsatz aus einem Konto.
// https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
const income = (kind: "guthaben" | "erstattung", date: string, amount: number, group?: string): EuerPayment =>
  kind === "guthaben" ? { kind: "zinsertrag", date, amount, group } : { kind: "steuer", date, amount, art: "ust", posten: "zinsen233a", group };
const amount = (euer: ReturnType<typeof computeEuer>, key: string) => euer.einnahmen.find((line) => line.key === key)?.amount ?? 0;

describe("Betriebliche Zinsen in der EÜR nach KU-Monatsstatus", () => {
  it.each(["guthaben", "erstattung"] as const)("%s: nur der KU-Zahlungsmonat gehört in Zeile 12", (kind) => {
    const euer = computeEuer(2026, [income(kind, "2026-01-15", 1_234), income(kind, "2026-02-15", 2_222)], undefined, undefined, [true, false]);
    expect({ z12: amount(euer, "einnahmenKleinunternehmer"), z16: amount(euer, "einnahmenSteuerfrei"), gewinn: euer.gewinn }).toEqual({
      z12: 1_234,
      z16: 2_222,
      gewinn: 3_456,
    });
    expect(euer.monthly.einnahmen.slice(0, 2)).toEqual([1_234, 2_222]);
  });

  it.each([
    ["SKR03", "guthaben"],
    ["SKR04", "guthaben"],
    ["SKR03", "erstattung"],
    ["SKR04", "erstattung"],
  ] as const)("%s/%s: das bestehende Zinskonto folgt dem übergebenen KU-Status", (chart, kind) => {
    const account = kind === "guthaben" ? ACCOUNTS[chart].zinsertraege : STEUER_KONTEN[chart].erstattungszinsen;
    expect(euerZuordnung(chart, account, "sonst", true)).toBe("einnahmenKleinunternehmer");
    expect(euerZuordnung(chart, account, "sonst", false)).toBe("einnahmenSteuerfrei");
  });

  it("behält eine negative Guthabenzinskorrektur in beiden Rechenwegen mit Vorzeichen", () => {
    const euer = computeEuer(2026, [income("guthaben", "2026-01-15", -321)], undefined, undefined, [true]);
    const journal = euerAusZeilen("SKR04", directPosting("zinsertrag", -321, "SKR04", "einzelunternehmen"), "sonst", undefined, true);
    expect(amount(euer, "einnahmenKleinunternehmer")).toBe(-321);
    expect(euer.gewinn).toBe(-321);
    expect(journal.zeilen.einnahmenKleinunternehmer).toBe(-321);
  });

  it("hebt gruppierte Erstattungszinsen ohne Umdeutung in Nachzahlungszinsen auf", () => {
    const euer = computeEuer(
      2026,
      [income("erstattung", "2026-01-15", 123, "aufhebung"), income("erstattung", "2026-01-15", -123, "aufhebung")],
      undefined,
      undefined,
      [true],
    );
    expect({ einnahmen: euer.totalEinnahmen, ausgaben: euer.totalAusgaben, gewinn: euer.gewinn }).toEqual({ einnahmen: 0, ausgaben: 0, gewinn: 0 });
  });

  it("hält Umsatzsteuererstattung in Zeile 18 und private Einkommensteuerzinsen außerhalb der EÜR", () => {
    const euer = computeEuer(
      2026,
      [
        { kind: "steuer", date: "2026-01-15", amount: 300, art: "ust", posten: "steuer" },
        { kind: "steuer", date: "2026-01-15", amount: 500, art: "est", posten: "zinsen233a" },
      ],
      undefined,
      undefined,
      [true],
    );
    expect({ z12: amount(euer, "einnahmenKleinunternehmer"), z16: amount(euer, "einnahmenSteuerfrei"), z18: amount(euer, "erstatteteUst") }).toEqual({
      z12: 0,
      z16: 0,
      z18: 300,
    });
    expect(euer.gewinn).toBe(300);
  });
});
