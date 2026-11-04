import { describe, expect, it } from "vitest";
import { ausschuettungAnteil } from "./ausschuettung.ts";
import { steuerbescheinigung, type SteuerbescheinigungEingabe } from "./steuerbescheinigung.ts";

const aussteller = { name: "Nordlicht Software GmbH", strasse: "Hafenallee 3", plz: "28217", ort: "Bremen", steuernummer: "60/145/12345" };
const erika = { name: "Erika Muster", strasse: "Lindenweg 1", plzOrt: "28195 Bremen", idnr: "86095742719" };

function eingabe(over: Partial<SteuerbescheinigungEingabe> = {}): SteuerbescheinigungEingabe {
  const r = ausschuettungAnteil({ brutto: 1_000_000, ausEinlagekonto: 0, kirchensteuer: 0 });
  return {
    aussteller,
    glaeubiger: erika,
    anteil: { ...r, religionsschluessel: null },
    zahlungstag: "2026-05-05",
    ausstellungstag: "2026-05-06",
    ...over,
  };
}

const betraege = (e: SteuerbescheinigungEingabe) => {
  const r = steuerbescheinigung(e);
  if (!r.ok) throw new Error(r.fehlend.join(" "));
  return Object.fromEntries(r.bescheinigung.zeilen.map((z) => [z.label, z.betrag]));
};

describe("Steuerbescheinigung nach § 45a Abs. 2 EStG (Muster II)", () => {
  it("ohne Kirchensteuer: Kapitalertrag, 25 % KapESt, 5,5 % Soli, Kirchensteuer 0", () => {
    const r = steuerbescheinigung(eingabe());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bescheinigung.glaeubiger).toEqual({ name: "Erika Muster", anschrift: ["Lindenweg 1", "28195 Bremen"], idnr: "86095742719" });
    expect(r.bescheinigung.aussteller.steuernummer).toBe("60/145/12345");
    expect(r.bescheinigung.zahlungstag).toBe("2026-05-05");
    expect(r.bescheinigung.religionsschluessel).toBeNull();
    expect(r.bescheinigung.zeilen).toEqual([
      { label: "Höhe der Kapitalerträge", betrag: 1_000_000 },
      { label: "Kapitalertragsteuer", betrag: 250_000 },
      { label: "Solidaritätszuschlag", betrag: 13_750 },
      { label: "Kirchensteuer zur Kapitalertragsteuer", betrag: 0 },
      { label: "Leistungen aus dem steuerlichen Einlagekonto (§ 27 Abs. 1 bis 7 KStG)", betrag: 0 },
    ]);
  });

  it("mit Kirchensteuer 9 %: ermäßigte KapESt und Religionsschlüssel", () => {
    const r = ausschuettungAnteil({ brutto: 1_000_000, ausEinlagekonto: 0, kirchensteuer: 9 });
    const e = eingabe({ anteil: { ...r, religionsschluessel: "026300" } });
    expect(betraege(e)).toMatchObject({
      Kapitalertragsteuer: 244_498,
      Solidaritätszuschlag: 13_447,
      "Kirchensteuer zur Kapitalertragsteuer": 22_004,
    });
    const b = steuerbescheinigung(e);
    expect(b.ok && b.bescheinigung.religionsschluessel).toBe("026300");
  });

  it("Leistung aus dem Einlagekonto: nicht in den Kapitalerträgen, eigene Zeile", () => {
    const r = ausschuettungAnteil({ brutto: 1_000_000, ausEinlagekonto: 300_000, kirchensteuer: 0 });
    expect(betraege(eingabe({ anteil: { ...r, religionsschluessel: null } }))).toMatchObject({
      "Höhe der Kapitalerträge": 700_000,
      Kapitalertragsteuer: 175_000,
      "Leistungen aus dem steuerlichen Einlagekonto (§ 27 Abs. 1 bis 7 KStG)": 300_000,
    });
  });

  it("ganz aus dem Einlagekonto: Kapitalerträge und Steuern 0", () => {
    const r = ausschuettungAnteil({ brutto: 500_000, ausEinlagekonto: 500_000, kirchensteuer: 9 });
    expect(betraege(eingabe({ anteil: { ...r, religionsschluessel: "026300" } }))).toEqual({
      "Höhe der Kapitalerträge": 0,
      Kapitalertragsteuer: 0,
      Solidaritätszuschlag: 0,
      "Kirchensteuer zur Kapitalertragsteuer": 0,
      "Leistungen aus dem steuerlichen Einlagekonto (§ 27 Abs. 1 bis 7 KStG)": 500_000,
    });
  });

  it("mehrere Gesellschafter: je eine Bescheinigung mit eigenem Anteil", () => {
    const anteile = [
      { g: erika, a: ausschuettungAnteil({ brutto: 600_000, ausEinlagekonto: 60_000, kirchensteuer: 8 }), rs: "010100" },
      {
        g: { name: "Max Muster", strasse: "Am Deich 2", plzOrt: "27568 Bremerhaven", idnr: "57549285017" },
        a: ausschuettungAnteil({ brutto: 400_000, ausEinlagekonto: 40_000, kirchensteuer: 0 }),
        rs: null,
      },
    ];
    const ergebnisse = anteile.map(({ g, a, rs }) => steuerbescheinigung(eingabe({ glaeubiger: g, anteil: { ...a, religionsschluessel: rs } })));
    expect(ergebnisse.map((r) => r.ok && r.bescheinigung.glaeubiger.name)).toEqual(["Erika Muster", "Max Muster"]);
    const zeile = (i: number, label: string) => {
      const r = ergebnisse[i]!;
      return r.ok ? r.bescheinigung.zeilen.find((z) => z.label === label)!.betrag : null;
    };
    expect(zeile(0, "Höhe der Kapitalerträge")).toBe(540_000);
    expect(zeile(1, "Höhe der Kapitalerträge")).toBe(360_000);
    expect(zeile(0, "Kirchensteuer zur Kapitalertragsteuer")).toBeGreaterThan(0);
    expect(zeile(1, "Kirchensteuer zur Kapitalertragsteuer")).toBe(0);
    expect(
      zeile(0, "Leistungen aus dem steuerlichen Einlagekonto (§ 27 Abs. 1 bis 7 KStG)")! +
        zeile(1, "Leistungen aus dem steuerlichen Einlagekonto (§ 27 Abs. 1 bis 7 KStG)")!,
    ).toBe(100_000);
  });

  it("meldet fehlende Angaben statt leer zu drucken", () => {
    const r = steuerbescheinigung(
      eingabe({
        aussteller: { ...aussteller, strasse: "" },
        glaeubiger: { name: "Max Muster", strasse: " ", plzOrt: "27568 Bremerhaven" },
      }),
    );
    expect(r).toEqual({
      ok: false,
      fehlend: [
        "Anschrift der Gesellschaft ist unvollständig (Einstellungen › Firmendaten).",
        "Anschrift von Max Muster fehlt (Jahreserklärung › Angaben zu den Erklärungen).",
        "Steuerliche Identifikationsnummer von Max Muster fehlt (Jahreserklärung › Angaben zu den Erklärungen).",
      ],
    });
  });

  it("nur eine Steuernummer statt der Identifikationsnummer reicht nicht", () => {
    const r = steuerbescheinigung(eingabe({ glaeubiger: { ...erika, idnr: "6014512345" } }));
    expect(r.ok).toBe(false);
  });

  it("Kirchensteuer ohne Religionsschlüssel fehlt", () => {
    const a = ausschuettungAnteil({ brutto: 1_000_000, ausEinlagekonto: 0, kirchensteuer: 9 });
    const r = steuerbescheinigung(eingabe({ anteil: { ...a, religionsschluessel: null } }));
    expect(r).toEqual({ ok: false, fehlend: ["Religionsschlüssel zur Kirchensteuer von Erika Muster fehlt."] });
  });

  it("erst ab dem Zahlungstag", () => {
    expect(steuerbescheinigung(eingabe({ zahlungstag: "2026-05-07", ausstellungstag: "2026-05-06" }))).toEqual({
      ok: false,
      fehlend: ["Die Ausschüttung fließt erst am 07.05.2026 zu; die Bescheinigung gibt es ab diesem Tag."],
    });
    expect(steuerbescheinigung(eingabe({ zahlungstag: "2026-05-06", ausstellungstag: "2026-05-06" })).ok).toBe(true);
  });
});
