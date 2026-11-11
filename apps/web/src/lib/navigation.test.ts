import { describe, expect, it } from "vitest";
import { type NavBedingung, navLinkSichtbar, navMark } from "./navigation.ts";

/** Lohn ohne Bedingung */
const lohn: NavBedingung = {};
const svMeldeportal = { to: "/sv-meldeportal", nurMitMitarbeitern: true } as const;
const pauschalen = { to: "/pauschalen", nurEinzelunternehmen: true } as const;
const ausschuettungen = { to: "/ausschuettungen", nurKapitalgesellschaft: true } as const;

describe("navLinkSichtbar", () => {
  it("zeigt das SV-Meldeportal erst, wenn es einen Mitarbeiter gibt; Lohn immer", () => {
    expect(navLinkSichtbar(svMeldeportal, { gesellschaft: false, hatMitarbeiter: false })).toBe(false);
    expect(navLinkSichtbar(svMeldeportal, { gesellschaft: false, hatMitarbeiter: true })).toBe(true);
    expect(navLinkSichtbar(svMeldeportal, { gesellschaft: true, hatMitarbeiter: true })).toBe(true);
    expect(navLinkSichtbar(lohn, { gesellschaft: false, hatMitarbeiter: false })).toBe(true);
    expect(navLinkSichtbar(lohn, { gesellschaft: true, hatMitarbeiter: false })).toBe(true);
  });

  it("richtet Pauschalen und Ausschüttungen nach der Rechtsform", () => {
    expect(navLinkSichtbar(pauschalen, { gesellschaft: false, hatMitarbeiter: false })).toBe(true);
    expect(navLinkSichtbar(pauschalen, { gesellschaft: true, hatMitarbeiter: false })).toBe(false);
    expect(navLinkSichtbar(ausschuettungen, { gesellschaft: false, hatMitarbeiter: false })).toBe(false);
    expect(navLinkSichtbar(ausschuettungen, { gesellschaft: true, hatMitarbeiter: false })).toBe(true);
  });
});

describe("navMark", () => {
  it("ab Werk das „H“ des Themes", () => {
    expect(navMark({ color: null, logo: false }, null)).toBeNull();
    expect(navMark({ color: null, logo: false }, "a".repeat(64))).toBeNull();
  });

  it("eigene Farbe mit der Schrift nach dem höheren Kontrast", () => {
    expect(navMark({ color: "#1D4ED8", logo: false }, null)).toEqual({ background: "#1D4ED8", ink: "#FFFFFF" });
    expect(navMark({ color: "#f5d90a", logo: false }, null)).toEqual({ background: "#F5D90A", ink: "#000000" });
  });

  it("das Logo nur, wenn es gewählt ist und es eins gibt; sonst wieder die Farbe", () => {
    const sha = "0123456789abcdef".repeat(4);
    expect(navMark({ color: "#1D4ED8", logo: true }, sha)).toEqual({ logo: "/api/kennzeichen?v=0123456789abcdef" });
    expect(navMark({ color: "#1D4ED8", logo: true }, null)).toEqual({ background: "#1D4ED8", ink: "#FFFFFF" });
    expect(navMark({ color: null, logo: true }, null)).toBeNull();
    expect(navMark({ color: "#1D4ED8", logo: false }, sha)).toEqual({ background: "#1D4ED8", ink: "#FFFFFF" });
  });

  it("eine ungültige Farbe ergibt das „H“ des Themes statt eines kaputten Stils", () => {
    for (const color of ["red", "#1D4ED", "url(x)", ""]) expect(navMark({ color, logo: false }, null)).toBeNull();
  });
});
