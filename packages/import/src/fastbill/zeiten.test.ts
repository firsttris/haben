import { describe, expect, it } from "vitest";
import type { FbProject, FbTime } from "./types.ts";
import { isFbTimeBilled, mapFbTime } from "./zeiten.ts";

// Zeiten und Projekte in der Form von time.get/project.get am echten Konto (Feldformen); Namen und Sätze erfunden
const projekt: FbProject = { PROJECT_ID: "301", PROJECT_NAME: "Relaunch Website", CUSTOMER_ID: "601", HOUR_PRICE: "85.00", CURRENCY_CODE: "EUR" };
const projekte = new Map([["301", projekt]]);
const zeit = (fields: Partial<FbTime> = {}): FbTime => ({
  TIME_ID: "4001",
  CUSTOMER_ID: "601",
  PROJECT_ID: "301",
  DATE: "2026-10-14 09:00:00",
  MINUTES: "90",
  BILLABLE_MINUTES: "90",
  COMMENT: "Konzept besprochen",
  ...fields,
});

describe("mapFbTime", () => {
  it("bildet eine offene Zeit mit Arbeitstag, Dauer, Tätigkeit, Projektname und Satz des Projekts ab", () => {
    expect(mapFbTime(zeit(), projekte)).toEqual({
      ok: true,
      time: {
        timeId: "4001",
        customerId: "601",
        workedOn: "2026-10-14",
        minutes: 90,
        billableMinutes: null,
        nonBillable: false,
        description: "Konzept besprochen",
        project: "Relaunch Website",
        hourlyRateCents: 8500,
      },
    });
  });

  it("erkennt abgerechnete Zeiten an der INVOICE_ID; bei offenen fehlt sie", () => {
    expect(isFbTimeBilled(zeit({ INVOICE_ID: "7001" }))).toBe(true);
    expect(isFbTimeBilled(zeit())).toBe(false);
    expect(isFbTimeBilled(zeit({ INVOICE_ID: "0" }))).toBe(false);
  });

  it("übernimmt eine abweichende abrechenbare Dauer, 0 als nicht abrechenbar", () => {
    const kuerzer = mapFbTime(zeit({ BILLABLE_MINUTES: "60" }), projekte);
    expect(kuerzer.ok && [kuerzer.time.billableMinutes, kuerzer.time.nonBillable]).toEqual([60, false]);
    const nichts = mapFbTime(zeit({ BILLABLE_MINUTES: "0" }), projekte);
    expect(nichts.ok && [nichts.time.billableMinutes, nichts.time.nonBillable]).toEqual([null, true]);
  });

  it("nimmt ohne Satz im Projekt den Satz des Kunden in Haben und ohne Projekt den Kunden der Zeit", () => {
    const ohneSatz = mapFbTime(zeit(), new Map([["301", { ...projekt, HOUR_PRICE: "0.00" }]]));
    expect(ohneSatz.ok && ohneSatz.time.hourlyRateCents).toBeUndefined();
    const ohneProjekt = mapFbTime(zeit({ PROJECT_ID: "0" }), projekte);
    expect(ohneProjekt.ok && [ohneProjekt.time.project, ohneProjekt.time.customerId]).toEqual(["", "601"]);
  });

  it("lehnt Zeiten über 24 Stunden, ohne Datum und mit Projekt in Fremdwährung mit Grund ab", () => {
    const gruende = [
      mapFbTime(zeit({ MINUTES: "1500", BILLABLE_MINUTES: "1500" }), projekte),
      mapFbTime(zeit({ DATE: "0000-00-00 00:00:00" }), projekte),
      mapFbTime(zeit(), new Map([["301", { ...projekt, CURRENCY_CODE: "CHF" }]])),
    ].map((m) => (m.ok ? "übernommen" : m.reason));
    expect(gruende).toEqual([expect.stringContaining("24 Stunden"), "Kein Datum.", expect.stringContaining("CHF")]);
  });
});
