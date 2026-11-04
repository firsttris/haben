import { describe, expect, it } from "vitest";
import { ausschuettungAnteil } from "./ausschuettung.ts";
import { steuerbescheinigung, type SteuerbescheinigungEingabe } from "./steuerbescheinigung.ts";

const aussteller = { name: "Nordlicht Software GmbH", strasse: "Hafenallee 3", plz: "28217", ort: "Bremen", steuernummer: "60/145/12345" };
const erika = { name: "Erika Muster", strasse: "Lindenweg 1", plzOrt: "28195 Bremen", idnr: "86095742719" };

// Wortlaut der Zeilen aus Muster II (BMF-Schreiben vom 16. Mai 2025, Anlage, Seite 38 und 39)
const NR1 = "Kapitalerträge im Sinne des § 43 Abs. 1 Satz 1 Nr. 1 EStG";
const KAPEST = "Summe Kapitalertragsteuer in Höhe von 25 % oder wegen einbehaltener Kirchensteuer entsprechend geminderter Kapitalertragsteuerbetrag";
const SOLI = "Summe Solidaritätszuschlag";
const KIST = "Summe Kirchensteuer zur Kapitalertragsteuer";
const RELIGION = "kirchensteuererhebende Religionsgemeinschaft";
const EINLAGE = "Leistungen aus dem steuerlichen Einlagekonto (§ 27 Abs. 1 – 7 KStG)";

function eingabe(over: Partial<SteuerbescheinigungEingabe> = {}): SteuerbescheinigungEingabe {
  const r = ausschuettungAnteil({ brutto: 1_000_000, ausEinlagekonto: 0, kirchensteuer: 0 });
  return {
    aussteller,
    glaeubiger: erika,
    anteil: { ...r, religionsschluessel: null },
    beschluss: { datum: "2026-04-28", geschaeftsjahr: 2025 },
    zahlungstag: "2026-05-05",
    ausstellungstag: "2026-05-06",
    ...over,
  };
}

const betraege = (e: SteuerbescheinigungEingabe) => {
  const r = steuerbescheinigung(e);
  if (!r.ok) throw new Error(r.fehlend.join(" "));
  return Object.fromEntries(r.bescheinigung.zeilen.flatMap((z) => ("betrag" in z ? [[z.label, z.betrag]] : [])));
};

describe("Steuerbescheinigung nach § 45a Abs. 2 EStG (Muster II)", () => {
  it("ohne Kirchensteuer: Zeilen in Wortlaut und Reihenfolge des Musters, mit den Fußnoten zur Anlage KAP", () => {
    const r = steuerbescheinigung(eingabe());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bescheinigung.glaeubiger).toEqual({ name: "Erika Muster", anschrift: ["Lindenweg 1", "28195 Bremen"], idnr: "86095742719" });
    expect(r.bescheinigung.aussteller.steuernummer).toBe("60/145/12345");
    expect(r.bescheinigung.zahlungstag).toBe("2026-05-05");
    expect(r.bescheinigung.zeilen).toEqual([
      { label: NR1, betrag: 1_000_000 },
      { label: KAPEST, betrag: 250_000 },
      { label: SOLI, betrag: 13_750, fussnote: "Bei Verwendung der Anlage KAP: Eintragung in Zeile 40." },
      { label: KIST, betrag: 0, fussnote: "Bei Verwendung der Anlage KAP: Eintragung in Zeile 41." },
      { label: EINLAGE, betrag: 0 },
    ]);
  });

  it("nennt Beschluss, Zahlungstag und Zeitraum wie Alternative 1 des Musters", () => {
    const r = steuerbescheinigung(eingabe());
    expect(r.ok && { beschlusstag: r.bescheinigung.beschlusstag, zeitraum: r.bescheinigung.zeitraum }).toEqual({
      beschlusstag: "2026-04-28",
      zeitraum: "das Geschäftsjahr 2025",
    });
    // Vor diesem Stand gebuchte Ausschüttungen kennen das Geschäftsjahr nicht
    const alt = steuerbescheinigung(eingabe({ beschluss: { datum: "2026-04-28", geschaeftsjahr: null } }));
    expect(alt.ok && alt.bescheinigung.zeitraum).toBeNull();
  });

  it("mit Kirchensteuer 9 %: ermäßigte KapESt und die Religionsgemeinschaft mit Namen unter der Kirchensteuer", () => {
    const r = ausschuettungAnteil({ brutto: 1_000_000, ausEinlagekonto: 0, kirchensteuer: 9 });
    const e = eingabe({ glaeubiger: { ...erika, religionsgemeinschaft: "römisch-katholisch" }, anteil: { ...r, religionsschluessel: "026300" } });
    expect(betraege(e)).toMatchObject({ [KAPEST]: 244_498, [SOLI]: 13_447, [KIST]: 22_004 });
    const b = steuerbescheinigung(e);
    expect(b.ok && b.bescheinigung.zeilen.map((z) => z.label)).toEqual([NR1, KAPEST, SOLI, KIST, RELIGION, EINLAGE]);
    expect(b.ok && b.bescheinigung.zeilen[4]).toEqual({ label: RELIGION, text: "römisch-katholisch" });
  });

  it("Leistung aus dem Einlagekonto: nicht in den Kapitalerträgen, eigene Zeile", () => {
    const r = ausschuettungAnteil({ brutto: 1_000_000, ausEinlagekonto: 300_000, kirchensteuer: 0 });
    expect(betraege(eingabe({ anteil: { ...r, religionsschluessel: null } }))).toMatchObject({
      [NR1]: 700_000,
      [KAPEST]: 175_000,
      [EINLAGE]: 300_000,
    });
  });

  it("ganz aus dem Einlagekonto: Kapitalerträge und Steuern 0, keine Religionsgemeinschaft nötig", () => {
    const r = ausschuettungAnteil({ brutto: 500_000, ausEinlagekonto: 500_000, kirchensteuer: 9 });
    expect(betraege(eingabe({ anteil: { ...r, religionsschluessel: "026300" } }))).toEqual({
      [NR1]: 0,
      [KAPEST]: 0,
      [SOLI]: 0,
      [KIST]: 0,
      [EINLAGE]: 500_000,
    });
  });

  it("mehrere Gesellschafter: je eine Bescheinigung mit eigenem Anteil", () => {
    const anteile = [
      {
        g: { ...erika, religionsgemeinschaft: "evangelisch" },
        a: ausschuettungAnteil({ brutto: 600_000, ausEinlagekonto: 60_000, kirchensteuer: 8 }),
        rs: "010100",
      },
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
      const z = r.ok ? r.bescheinigung.zeilen.find((x) => x.label === label) : undefined;
      return z && "betrag" in z ? z.betrag : null;
    };
    expect(zeile(0, NR1)).toBe(540_000);
    expect(zeile(1, NR1)).toBe(360_000);
    expect(zeile(0, KIST)).toBeGreaterThan(0);
    expect(zeile(1, KIST)).toBe(0);
    expect(zeile(0, EINLAGE)! + zeile(1, EINLAGE)!).toBe(100_000);
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

  it("Kirchensteuer ohne Namen der Religionsgemeinschaft fehlt; der Religionsschlüssel allein genügt nicht", () => {
    const a = ausschuettungAnteil({ brutto: 1_000_000, ausEinlagekonto: 0, kirchensteuer: 9 });
    const r = steuerbescheinigung(eingabe({ anteil: { ...a, religionsschluessel: "026300" } }));
    expect(r).toEqual({
      ok: false,
      fehlend: ["Kirchensteuererhebende Religionsgemeinschaft von Erika Muster fehlt (Jahreserklärung › Angaben zu den Erklärungen)."],
    });
  });

  // Muster II, Alternative 1: „für … (Zeitraum)“ gehört zum Inhalt; Rz. 1 des BMF-Schreibens vom 16.05.2025 erlaubt keine
  // Abweichung. Ausschüttungen, die vor dem Feld „Geschäftsjahr“ gebucht wurden, bekommen deshalb keine Bescheinigung.
  it("ohne Geschäftsjahr der Ausschüttung keine Bescheinigung", () => {
    expect(steuerbescheinigung(eingabe({ beschluss: { datum: "2026-04-28", geschaeftsjahr: null } }))).toEqual({
      ok: false,
      fehlend: [expect.stringContaining("Geschäftsjahr")],
    });
  });

  it("erst ab dem Zahlungstag", () => {
    expect(steuerbescheinigung(eingabe({ zahlungstag: "2026-05-07", ausstellungstag: "2026-05-06" }))).toEqual({
      ok: false,
      fehlend: ["Die Ausschüttung fließt erst am 07.05.2026 zu; die Bescheinigung gibt es ab diesem Tag."],
    });
    expect(steuerbescheinigung(eingabe({ zahlungstag: "2026-05-06", ausstellungstag: "2026-05-06" })).ok).toBe(true);
  });
});
