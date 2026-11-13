import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

type Kontenrahmen = "SKR03" | "SKR04";

const COLUMNS = `Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext`;

/** Buchungsstapel eines Jahres wie aus Lexware Office; Zeilen als [Betrag in Cent, S/H, Konto, Gegenkonto, BU, TTMM] */
function stack(year: number, kontenrahmen: Kontenrahmen, rows: [number, "S" | "H", string, string, string, string][]) {
  const skr = kontenrahmen === "SKR03" ? "03" : "04";
  const header = `"EXTF";700;21;"Buchungsstapel";13;${year + 1}0102120000000;;"LO";"";"";1001;12345;${year}0101;4;${year}0101;${year}1231;"Lexware Export";"";1;0;0;"EUR";;"";;;"${skr}";;;"";""`;
  const lines = rows.map(([cents, side, account, contra, bu, ttmm]) => {
    const amount = `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
    return `${amount};"${side}";"EUR";;;;${account};${contra};"${bu}";${ttmm};"";"";;"Test"`;
  });
  return new TextEncoder().encode([header, COLUMNS, ...lines].join("\r\n"));
}

const K = {
  SKR03: { bank: "1200", kapital: "0800", erloes: "8400", aufwand: "4930" },
  SKR04: { bank: "1800", kapital: "2900", erloes: "4400", aufwand: "6815" },
} as const;

describe.skipIf(!testDatabaseUrl)("Abschluss aus dem DATEV-Stapel (Postgres)", () => {
  let sql: postgres.Sql;
  let archive: typeof import("./archive.ts");
  let modul: typeof import("./datev-abschluss.ts");
  let kst: typeof import("../jahreserklaerung/koerperschaft.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    archive = await import("./archive.ts");
    modul = await import("./datev-abschluss.ts");
    kst = await import("../jahreserklaerung/koerperschaft.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(rechtsform: "einzelunternehmen" | "gmbh", kontenrahmen: Kontenrahmen) {
    // Archiv und Angaben sind nur anhängbar; für jeden Fall leer beginnen
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
      await tx`delete from corporate_tax_inputs`;
    });
    await leeren(sql)`truncate company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht GmbH', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              ${kontenrahmen}, 'soll', ${rechtsform})`;
  }

  const upload = (year: number, bytes: Uint8Array) =>
    archive.addArchiveFile(actor, { bytes, filename: `EXTF_Buchungsstapel_${year}.csv`, kind: "datev", year: null });

  describe.each(["SKR03", "SKR04"] as const)("%s", (kontenrahmen) => {
    const k = K[kontenrahmen];

    it("rechnet Bilanz, GuV und Steuern und trägt die Bestände aus dem Vorjahresstapel vor", async () => {
      await setup("gmbh", kontenrahmen);
      await upload(
        2024,
        stack(2024, kontenrahmen, [
          [2_500_000, "S", k.bank, k.kapital, "", "1001"], // Stammkapital eingezahlt
          [11_900, "S", "10001", k.erloes, "", "1503"], // Ausgangsrechnung an Debitor, Automatik 19 %
          [11_900, "S", k.bank, "10001", "", "3003"], // Zahlungseingang
          [1_190, "S", k.aufwand, k.bank, "9", "0204"], // Bürobedarf mit Vorsteuer
        ]),
      );
      await upload(2025, stack(2025, kontenrahmen, [[23_800, "S", k.bank, k.erloes, "", "1006"]]));
      await kst.saveKapgAngaben(actor, 2025, { hebesatz: 400, verlustvortragKst: 0, verlustvortragGewst: 0 });

      const erstes = await modul.datevAbschluss(2024);
      expect(erstes!.vortrag).toBe("keiner");
      expect(erstes!.report.jahresergebnis).toBe(9_000);
      expect(erstes!.steuern).toBeNull();
      expect(erstes!.issues.map((i) => i.text).join(" ")).toContain("Hebesatz");

      const jahr = await modul.datevAbschluss(2025);
      expect(jahr!.vortrag).toBe("vorjahre");
      expect(jahr!.report.jahresergebnis).toBe(20_000);
      expect(jahr!.report.guv.umsatzerloese).toBe(20_000);
      // Bank aus beiden Jahren und Vorsteuer 2024 auf der Aktivseite
      expect(jahr!.report.aktiva).toBe(2_500_000 + 11_900 - 1_190 + 23_800 + 190);
      // Stammkapital, Gewinnvortrag 2024, Jahresüberschuss 2025 und die Umsatzsteuer beider Jahre
      expect(jahr!.report.bilanz["passiva.A"]).toBe(2_500_000 + 9_000 + 20_000);
      expect(jahr!.report.passiva).toBe(jahr!.report.aktiva);
      expect(jahr!.steuern).toMatchObject({ jahresergebnis: 20_000, zvE: 20_000, kst: 3_000 });
      expect(jahr!.issues).toEqual([]);
    });

    it("nimmt die Eröffnungsbuchungen aus dem Stapel statt der Vorjahre", async () => {
      await setup("gmbh", kontenrahmen);
      await upload(2024, stack(2024, kontenrahmen, [[999_900, "S", k.bank, k.kapital, "", "1001"]]));
      await upload(
        2025,
        stack(2025, kontenrahmen, [
          [1_000_000, "S", k.bank, "9000", "", "0101"],
          [1_000_000, "S", "9000", k.kapital, "", "0101"],
        ]),
      );
      const jahr = await modul.datevAbschluss(2025);
      expect(jahr!.vortrag).toBe("stapel");
      expect(jahr!.report.aktiva).toBe(1_000_000);
      expect(jahr!.report.offeneVortraege).toEqual([]);
    });

    it("trägt nur ab dem letzten Vorjahresstapel mit Eröffnungsbuchungen vor", async () => {
      await setup("gmbh", kontenrahmen);
      await upload(2023, stack(2023, kontenrahmen, [[2_500_000, "S", k.bank, k.kapital, "", "0101"]]));
      // 2024 bringt die Bestände zum 1.1.2024 selbst mit; die Buchungen aus 2023 stecken darin schon
      await upload(
        2024,
        stack(2024, kontenrahmen, [
          [2_500_000, "S", k.bank, "9000", "", "0101"],
          [2_500_000, "S", "9000", k.kapital, "", "0101"],
        ]),
      );
      await upload(2025, stack(2025, kontenrahmen, [[23_800, "S", k.bank, k.erloes, "", "1006"]]));
      const jahr = await modul.datevAbschluss(2025);
      expect(jahr!.vortrag).toBe("vorjahre");
      expect(jahr!.report.aktiva).toBe(2_500_000 + 23_800);
      expect(jahr!.report.passiva).toBe(jahr!.report.aktiva);
    });
  });

  it("gibt es nur für GmbH und UG und nur für Jahre mit Buchungen", async () => {
    await setup("gmbh", "SKR03");
    await upload(2025, stack(2025, "SKR03", [[11_900, "S", "1200", "8400", "", "1006"]]));
    expect(await modul.datevAbschluss(2024)).toBeNull();
    await sql`update company set rechtsform = 'einzelunternehmen'`;
    expect(await modul.datevAbschluss(2025)).toBeNull();
  });

  it("warnt, wenn der Stapel in einem anderen Kontenrahmen ist", async () => {
    await setup("gmbh", "SKR04");
    await upload(2025, stack(2025, "SKR03", [[11_900, "S", "1200", "8400", "", "1006"]]));
    const jahr = await modul.datevAbschluss(2025);
    expect(jahr!.issues[0]).toMatchObject({ tone: "fehler", text: expect.stringContaining("anderen Kontenrahmen") });
  });
});
