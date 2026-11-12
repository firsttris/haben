import { readFileSync } from "node:fs";
import { NAV_BACKGROUNDS } from "@haben/core";
import { describe, expect, it } from "vitest";
import { firmaInNavigation, type NavBedingung, navLinkSichtbar, navMark } from "./navigation.ts";

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
    expect(navMark({ color: "#1D4ED8", logo: false }, null)).toEqual({ background: "#1D4ED8", ink: "#FFFFFF", kante: true });
    expect(navMark({ color: "#f5d90a", logo: false }, null)).toEqual({ background: "#F5D90A", ink: "#000000", kante: false });
  });

  it("das Logo nur, wenn es gewählt ist und es eins gibt; sonst wieder die Farbe", () => {
    const sha = "0123456789abcdef".repeat(4);
    expect(navMark({ color: "#1D4ED8", logo: true }, sha)).toEqual({ logo: "/api/kennzeichen?v=0123456789abcdef" });
    expect(navMark({ color: "#1D4ED8", logo: true }, null)).toEqual({ background: "#1D4ED8", ink: "#FFFFFF", kante: true });
    expect(navMark({ color: null, logo: true }, null)).toBeNull();
    expect(navMark({ color: "#1D4ED8", logo: false }, sha)).toEqual({ background: "#1D4ED8", ink: "#FFFFFF", kante: true });
  });

  it("eine ungültige Farbe ergibt das „H“ des Themes statt eines kaputten Stils", () => {
    for (const color of ["red", "#1D4ED", "url(x)", ""]) expect(navMark({ color, logo: false }, null)).toBeNull();
  });
});

// Mehrere Firmen (#504): Der Name aus den Firmendaten zeigt, in welcher Instanz man gerade arbeitet
describe("firmaInNavigation", () => {
  it("zeigt den Namen der Firma ohne Leerzeichen am Rand", () => {
    expect(firmaInNavigation("  Mustermann IT · Max Mustermann ")).toBe("Mustermann IT · Max Mustermann");
  });

  it("zeigt nichts, solange die Firmendaten keinen Namen haben", () => {
    expect(firmaInNavigation("")).toBeNull();
    expect(firmaInNavigation(" \t\n")).toBeNull();
  });
});

// Die Kontrastregel für die Innenkante rechnet mit den Hintergründen der Navigation; sie müssen mit --nav der Themes in
// styles.css übereinstimmen, sonst stimmt die Entscheidung für ein Theme nicht
describe("NAV_BACKGROUNDS", () => {
  it("entspricht --nav aller Themes in styles.css", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const imCss = [...css.matchAll(/--nav:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]!.toUpperCase());
    expect([...new Set(imCss)].sort()).toEqual([...NAV_BACKGROUNDS].sort());
  });
});
