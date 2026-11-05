import { describe, expect, it } from "vitest";
import { lohnabrechnung, type LohnStammdaten } from "./lohnabrechnung/index.ts";
import { lohnsteuerbescheinigung, lstbFrist, lstbKmId, lstbWerteGleich, type LstbAbrechnung, type LstbEingabe } from "./lohnsteuerbescheinigung.ts";

/**
 * Lohnsteuerbescheinigung aus den Abrechnungen eines Jahres: Zeilen des amtlichen Musters 2026 als Summen der
 * festgeschriebenen Abrechnungen (die Beträge je Monat sind in lohnabrechnung.test.ts belegt), Bescheinigungszeitraum,
 * Merkmale und alles, was Haben nicht bescheinigt.
 */

const GGF: LohnStammdaten = {
  art: "ggf",
  monatsgehalt: 6000_00,
  eintritt: "2024-01-01",
  austritt: null,
  steuerklasse: 1,
  faktor: 1000,
  kinderfreibetraege: 0,
  konfession: "ev",
  kv: { art: "gesetzlich", zusatzbeitrag: 290 },
  pflege: { kinderlosenzuschlag: true, kinderUnter25: 0 },
  umlagen: { u1: null, u2: 0 },
  minijob: { rvBefreit: false, pauschsteuer: false },
};

const ANGESTELLT: LohnStammdaten = {
  ...GGF,
  art: "beschaeftigt",
  monatsgehalt: 4000_00,
  konfession: null,
  kv: { art: "gesetzlich", zusatzbeitrag: 310 },
  pflege: { kinderlosenzuschlag: false, kinderUnter25: 1 },
  umlagen: { u1: 160, u2: 44 },
};

const MINIJOB: LohnStammdaten = { ...GGF, art: "minijob", monatsgehalt: 603_00, konfession: null, minijob: { rvBefreit: false, pauschsteuer: true } };

function abrechnung(stammdaten: LohnStammdaten, monat: number): LstbAbrechnung {
  const r = lohnabrechnung({ jahr: 2026, monat, stammdaten, bundesland: "HB" });
  if (!r.ok) throw new Error(r.meldung);
  return {
    monat,
    zahltag: `2026-${String(monat).padStart(2, "0")}-28`,
    stammdaten,
    steuerBrutto: r.steuerBrutto,
    svBrutto: r.svBrutto,
    lohnsteuer: r.lohnsteuer,
    soli: r.soli,
    kirchensteuer: r.kirchensteuer,
    sv: r.sv,
  };
}

const monate = (von: number, bis: number) => Array.from({ length: bis - von + 1 }, (_, i) => von + i);

const eingabe = (stammdaten: LohnStammdaten, mehr: Partial<LstbEingabe> = {}): LstbEingabe => ({
  jahr: 2026,
  eintritt: stammdaten.eintritt,
  austritt: stammdaten.austritt,
  entwuerfe: [],
  heute: "2027-01-15",
  ...mehr,
  abrechnungen: mehr.abrechnungen ?? monate(1, 12).map((m) => abrechnung(stammdaten, m)),
});

function bereit(e: LstbEingabe) {
  const r = lohnsteuerbescheinigung(e);
  if (r.status !== "bereit") throw new Error(`${r.status}: ${r.meldung}`);
  return r.werte;
}

describe("lohnsteuerbescheinigung", () => {
  it("Gesellschafter-Geschäftsführer: Zeilen 3 bis 6 als Jahressumme, keine Beiträge (Selbstzahler ohne Zuschuss)", () => {
    const monat = abrechnung(GGF, 1);
    const w = bereit(eingabe(GGF));
    expect(w).toMatchObject({
      jahr: 2026,
      von: "2026-01-01",
      bis: "2026-12-31",
      bruttoarbeitslohn: 72_000_00,
      lohnsteuer: 12 * monat.lohnsteuer,
      soli: 12 * monat.soli,
      kirchensteuer: 12 * monat.kirchensteuer,
      rvArbeitgeber: 0,
      rvArbeitnehmer: 0,
      kvArbeitnehmer: 0,
      pvArbeitnehmer: 0,
      avArbeitnehmer: 0,
      pkvBasis: null,
    });
    expect(w.merkmale).toEqual([{ gueltigAb: "2026-01-01", steuerklasse: 1, faktor: 1000, kinderfreibetraege: 0, konfession: "ev" }]);
  });

  it("Beschäftigter: Zeilen 22a, 23a und 25 bis 27 aus den Anteilen, der Zusatzbeitrag in Zeile 25", () => {
    const m = abrechnung(ANGESTELLT, 1);
    const w = bereit(eingabe(ANGESTELLT));
    expect(w.bruttoarbeitslohn).toBe(48_000_00);
    expect(w.rvArbeitgeber).toBe(12 * m.sv.rv.ag);
    expect(w.rvArbeitnehmer).toBe(12 * m.sv.rv.an);
    expect(w.kvArbeitnehmer).toBe(12 * (m.sv.kv.an + m.sv.kvZusatz.an));
    expect(w.pvArbeitnehmer).toBe(12 * m.sv.pv.an);
    expect(w.avArbeitnehmer).toBe(12 * m.sv.av.an);
    expect(w.kirchensteuer).toBe(0);
    expect(w.rvArbeitnehmer).toBeGreaterThan(0);
  });

  it("Midijob (Übergangsbereich): bescheinigt die tatsächlich gezahlten Anteile, obwohl die Bemessung unter dem Entgelt liegt", () => {
    // § 20 Abs. 2a SGB IV: Im Übergangsbereich ist die beitragspflichtige Einnahme kleiner als das Entgelt; mit der
    // Beitragsbemessungsgrenze der Krankenversicherung (§ 223 Abs. 3 SGB V) hat das nichts zu tun
    const midijob = { ...ANGESTELLT, monatsgehalt: 1500_00 };
    const m = abrechnung(midijob, 1);
    expect(m.sv.bemessung.kvPv).toBeLessThan(m.svBrutto);
    const w = bereit(eingabe(midijob));
    expect(w.bruttoarbeitslohn).toBe(18_000_00);
    expect(w.rvArbeitnehmer).toBe(12 * m.sv.rv.an);
    expect(w.kvArbeitnehmer).toBe(12 * (m.sv.kv.an + m.sv.kvZusatz.an));
  });

  it("Austritt zum Monatsende: Zeitraum bis dahin, fertig schon im laufenden Jahr", () => {
    const s = { ...GGF, austritt: "2026-06-30" };
    const w = bereit(eingabe(s, { abrechnungen: monate(1, 6).map((m) => abrechnung(s, m)), heute: "2026-07-01" }));
    expect([w.von, w.bis, w.bruttoarbeitslohn]).toEqual(["2026-01-01", "2026-06-30", 36_000_00]);
    // Am Tag des Austritts ist das Lohnkonto noch nicht abgeschlossen
    expect(lohnsteuerbescheinigung(eingabe(s, { abrechnungen: monate(1, 6).map((m) => abrechnung(s, m)), heute: "2026-06-30" })).status).toBe("offen");
  });

  it("Eintritt im Jahr: Zeitraum ab dem Eintritt", () => {
    const s = { ...GGF, eintritt: "2026-04-01" };
    const w = bereit(eingabe(s, { abrechnungen: monate(4, 12).map((m) => abrechnung(s, m)) }));
    expect([w.von, w.bis]).toEqual(["2026-04-01", "2026-12-31"]);
  });

  it("Merkmale je Änderung mit dem ersten Tag des Monats", () => {
    const ab = { ...GGF, steuerklasse: 3 as const, kinderfreibetraege: 1500, konfession: null };
    const w = bereit(eingabe(GGF, { abrechnungen: [...monate(1, 4).map((m) => abrechnung(GGF, m)), ...monate(5, 12).map((m) => abrechnung(ab, m))] }));
    expect(w.merkmale).toEqual([
      { gueltigAb: "2026-01-01", steuerklasse: 1, faktor: 1000, kinderfreibetraege: 0, konfession: "ev" },
      { gueltigAb: "2026-05-01", steuerklasse: 3, faktor: 1000, kinderfreibetraege: 1500, konfession: null },
    ]);
  });

  it("privat versicherter Geschäftsführer: Basisbeitrag des letzten Monats und Summe des Jahres", () => {
    const s: LohnStammdaten = { ...GGF, kv: { art: "privat", basisbeitrag: 650_00, arbeitgeberzuschuss: 0 } };
    expect(bereit(eingabe(s)).pkvBasis).toEqual({ letzterMonat: 650_00, jahr: 7800_00 });
  });

  it("Minijob mit Pauschsteuer: keine Bescheinigung (§ 41b Abs. 6 EStG)", () => {
    const r = lohnsteuerbescheinigung(eingabe(MINIJOB));
    expect(r).toEqual({ status: "keine", meldung: expect.stringContaining("§ 41b Abs. 6 EStG") });
    expect(lohnsteuerbescheinigung(eingabe(GGF, { abrechnungen: [] })).status).toBe("keine");
  });

  it("noch nicht fertig: laufendes Jahr, fehlender Monat, Entwurf", () => {
    expect(lohnsteuerbescheinigung(eingabe(GGF, { heute: "2026-12-31" }))).toMatchObject({ status: "offen", meldung: expect.stringContaining("31.12.2026") });
    const ohneMaerz = eingabe(GGF).abrechnungen.filter((a) => a.monat !== 3);
    expect(lohnsteuerbescheinigung(eingabe(GGF, { abrechnungen: ohneMaerz }))).toMatchObject({ status: "offen", meldung: expect.stringContaining("März") });
    // Nur ein Entwurf, etwa nach dem Storno der einzigen Abrechnung: offen, nicht „keine“
    expect(lohnsteuerbescheinigung(eingabe(GGF, { abrechnungen: [], entwuerfe: [11] }))).toMatchObject({
      status: "offen",
      meldung: expect.stringContaining("November"),
    });
    expect(lohnsteuerbescheinigung(eingabe(GGF, { abrechnungen: ohneMaerz, entwuerfe: [3] }))).toMatchObject({
      status: "offen",
      meldung: expect.stringContaining("Entwurf"),
    });
  });

  it("nicht unterstützt statt falsch: Teilmonat, Minijob gemischt, Entgelt über der BBG der KV, Abrechnung außerhalb", () => {
    const mitte = { ...GGF, austritt: "2026-06-15" };
    expect(lohnsteuerbescheinigung(eingabe(mitte, { abrechnungen: monate(1, 5).map((m) => abrechnung(mitte, m)) })).status).toBe("nicht-unterstuetzt");
    const gemischt = [...monate(1, 6).map((m) => abrechnung(MINIJOB, m)), ...monate(7, 12).map((m) => abrechnung(GGF, m))];
    expect(lohnsteuerbescheinigung(eingabe(GGF, { abrechnungen: gemischt })).status).toBe("nicht-unterstuetzt");
    const hoch = { ...ANGESTELLT, monatsgehalt: 6000_00 };
    expect(lohnsteuerbescheinigung(eingabe(hoch))).toMatchObject({
      status: "nicht-unterstuetzt",
      meldung: expect.stringContaining("Beitragsbemessungsgrenze"),
    });
    expect(lohnsteuerbescheinigung(eingabe(GGF, { austritt: "2026-05-31" })).status).toBe("nicht-unterstuetzt");
    // Dezemberlohn später als drei Wochen nach Jahresende: sonstiger Bezug des Folgejahres (R 39b.2 Abs. 2 Satz 2 Nr. 8 LStR)
    const spaet = eingabe(GGF).abrechnungen.map((a) => (a.monat === 12 ? { ...a, zahltag: "2027-01-22" } : a));
    expect(lohnsteuerbescheinigung(eingabe(GGF, { abrechnungen: spaet }))).toMatchObject({ status: "nicht-unterstuetzt", meldung: expect.stringContaining("2027") });
  });

  it("Werte vergleichen", () => {
    const a = bereit(eingabe(GGF));
    expect(lstbWerteGleich(a, structuredClone(a))).toBe(true);
    // Postgres gibt jsonb mit anderer Reihenfolge der Schlüssel zurück
    const umgestellt = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(lstbWerteGleich(a, umgestellt)).toBe(true);
    expect(lstbWerteGleich(a, { ...a, lohnsteuer: a.lohnsteuer + 1 })).toBe(false);
  });
});

describe("lstbFrist", () => {
  it("letzter Tag im Februar des Folgejahres, am Wochenende der nächste Werktag", () => {
    // 28.2.2027 ist ein Sonntag
    expect(lstbFrist(2026, "HB")).toBe("2027-03-01");
    // 29.2.2028 ist ein Dienstag (Schaltjahr)
    expect(lstbFrist(2027, null)).toBe("2028-02-29");
    expect(lstbFrist(2025, null)).toBe("2026-03-02");
  });
});

describe("lstbKmId", () => {
  it("wie in den Beispielen zur Schnittstelle, mit laufender Nummer", () => {
    const id = lstbKmId({
      jahr: 2025,
      idnr: "20013456978",
      von: "2025-01-01",
      bis: "2025-12-31",
      steuernummer13: "5313058590230",
      ordnungsmerkmal: "42",
      art: "Korrektur",
      nummer: 2,
    });
    expect(id).toBe("2025-LST-20013456978-01013112-5313058590230-42-KOR-002");
    expect(id.length).toBeLessThanOrEqual(100);
  });
});
