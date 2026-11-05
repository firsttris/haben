import type { LstbWerte } from "@haben/core";
import type { LStBInput, LStBStornoInput } from "./lstb.ts";

/** Beispiel einer Bescheinigung 2025 für lstb.test.ts und eric-lstb.test.ts */

export const LSTB_WERTE: LstbWerte = {
  jahr: 2025,
  von: "2025-01-01",
  bis: "2025-12-31",
  bruttoarbeitslohn: 48_000_00,
  lohnsteuer: 5_412_00,
  soli: 0,
  kirchensteuer: 487_08,
  rvArbeitgeber: 4_464_00,
  rvArbeitnehmer: 4_464_00,
  kvArbeitnehmer: 4_248_00,
  pvArbeitnehmer: 864_00,
  avArbeitnehmer: 624_00,
  pkvBasis: null,
  merkmale: [
    { gueltigAb: "2025-01-01", steuerklasse: 1, faktor: 1000, kinderfreibetraege: 0, konfession: "ev" },
    { gueltigAb: "2025-07-01", steuerklasse: 3, faktor: 1000, kinderfreibetraege: 1500, konfession: "rk" },
  ],
};

export const LSTB_BASIS: LStBInput = {
  anweisung: { art: "Neu", kmId: "2025-LST-86095742719-01013112-2475081508152-7-NEU-001" },
  werte: LSTB_WERTE,
  arbeitnehmer: {
    idnr: "86095742719",
    ordnungsmerkmal: "7",
    vorname: "Max",
    nachname: "Beispiel",
    geburtsdatum: "1985-03-27",
    strasse: "Lindenweg 1a",
    plz: "28195",
    ort: "Bremen",
  },
  arbeitgeber: {
    name: "Nordlicht Software GmbH",
    steuernummer13: "2475081508152",
    finanzamt: "Finanzamt Bremen",
    bundesland: "HB",
    strasse: "Hafenallee 3",
    plz: "28217",
    ort: "Bremen",
  },
  herstellerId: "12345",
  produktVersion: "0.1.0",
  test: true,
};

export const LSTB_STORNO: LStBStornoInput = {
  kmId: "2025-LST-86095742719-01013112-2475081508152-7-STO-002",
  refKmId: LSTB_BASIS.anweisung.kmId,
  jahr: 2025,
  idnr: "86095742719",
  ordnungsmerkmal: "7",
  arbeitgeber: LSTB_BASIS.arbeitgeber,
  herstellerId: "12345",
  produktVersion: "0.1.0",
  test: true,
};
