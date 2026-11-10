import { describe, expect, it } from "vitest";
import { markeInNavigation, type NavBedingung, navLinkSichtbar } from "./navigation.ts";

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

// Mehrere Firmen (#504): Das „H“ nimmt die Akzentfarbe der Belege, damit man jede Firma auf einen Blick erkennt
describe("markeInNavigation", () => {
  it("färbt das Zeichen in der gewählten Akzentfarbe, mit lesbarer Schrift", () => {
    expect(markeInNavigation("#1D4ED8")).toEqual({ farbe: "#1D4ED8", schrift: "#FFFFFF" });
    expect(markeInNavigation("#f5d90a")).toEqual({ farbe: "#F5D90A", schrift: "#16211C" });
  });

  it("lässt das Zeichen in der Farbe des Themes, solange die Akzentfarbe ab Werk gilt", () => {
    expect(markeInNavigation("#1F6F5C")).toBeNull();
    expect(markeInNavigation("#1f6f5c")).toBeNull();
  });

  it("nimmt keine Farbe an, die nicht die Form #RRGGBB hat", () => {
    expect(markeInNavigation("red")).toBeNull();
    expect(markeInNavigation("#12345")).toBeNull();
  });
});
