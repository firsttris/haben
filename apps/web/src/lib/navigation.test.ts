import { describe, expect, it } from "vitest";
import { type NavBedingung, navLinkSichtbar } from "./navigation.ts";

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
