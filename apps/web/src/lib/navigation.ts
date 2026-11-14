import { type SettingsArea, settingsAreas } from "./settings-areas.ts";
import { ACCENT_PATTERN, inkOnAccent, needsEdgeOnNav } from "@haben/core";
import type { IconName } from "../components/Icon.tsx";
import { STEUERBERATUNG_START } from "./rollen.ts";

/** Bedingungen, unter denen ein Menüpunkt der Hauptnavigation erscheint */
export interface NavBedingung {
  nurEinzelunternehmen?: true;
  nurKapitalgesellschaft?: true;
  /** Erst mit dem ersten Mitarbeiter; ausgetretene zählen mit, ihre Ab- und Jahresmeldungen stehen noch an */
  nurMitMitarbeitern?: true;
}

export interface NavKontext {
  /** GmbH oder UG */
  gesellschaft: boolean;
  hatMitarbeiter: boolean;
}

export function navLinkSichtbar(link: NavBedingung, { gesellschaft, hatMitarbeiter }: NavKontext): boolean {
  if (gesellschaft && link.nurEinzelunternehmen) return false;
  if (!gesellschaft && link.nurKapitalgesellschaft) return false;
  return !(link.nurMitMitarbeitern && !hatMitarbeiter);
}

/** Zeichen der Firma in der Navigation (#504): Logo der Belege, „H“ in eigener Farbe oder null für das „H“ des Themes */
/** `kante`: helle Innenkante, wenn sich die Farbe in einem Theme nicht mit 3 : 1 von der Navigation abhebt */
export type NavMark = { logo: string } | { background: string; ink: "#FFFFFF" | "#000000"; kante: boolean } | null;

/**
 * Was die Navigation zeigt: das Logo, wenn es gewählt ist und es eins gibt (`logoSha256`), sonst die eigene Farbe mit
 * der Schrift nach dem höheren Kontrast. Die Prüfsumme in der Adresse lädt ein neues Logo, ohne dass ein Cache stört.
 */
export function navMark(setting: { color: string | null; logo: boolean }, logoSha256: string | null): NavMark {
  if (setting.logo && logoSha256) return { logo: `/api/kennzeichen?v=${logoSha256.slice(0, 16)}` };
  if (setting.color && ACCENT_PATTERN.test(setting.color))
    return { background: setting.color.toUpperCase(), ink: inkOnAccent(setting.color), kante: needsEdgeOnNav(setting.color) };
  return null;
}

/** Name der Firma unter „Haben“, damit man sieht, in welcher Instanz man bucht (#504); ohne Namen nichts */
export function firmaInNavigation(name: string): string | null {
  return name.trim() || null;
}

export interface NavLink extends NavBedingung {
  to: string;
  icon: IconName;
  label: string;
}

export interface NavGroup {
  label: string;
  links: readonly NavLink[];
}

/** Hauptnavigation nach Arbeitsbereichen; geteilt von Seitenleiste und Befehlspalette (#617) */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Verkauf",
    links: [
      { to: "/angebote", icon: "quote", label: "Angebote" },
      { to: "/rechnungen", icon: "invoice", label: "Rechnungen" },
      { to: "/lastschriften", icon: "bank", label: "Lastschriften" },
      { to: "/kontakte", icon: "contacts", label: "Kontakte" },
      { to: "/artikel", icon: "article", label: "Artikel" },
      { to: "/leistungen", icon: "calendar", label: "Leistungen" },
      { to: "/textbausteine", icon: "textblock", label: "Textbausteine" },
    ],
  },
  {
    label: "Ausgaben",
    links: [
      { to: "/belege", icon: "receipt", label: "Belege" },
      { to: "/dauerbelege", icon: "calendar", label: "Dauerbelege" },
      { to: "/ueberweisungen", icon: "bank", label: "Überweisungen" },
      // Pauschalen ersetzen Ausgaben des Inhabers, eine GmbH oder UG hat sie nicht
      { to: "/pauschalen", icon: "pauschale", label: "Pauschalen", nurEinzelunternehmen: true },
      { to: "/anlagen", icon: "assets", label: "Anlagen" },
    ],
  },
  {
    label: "Geld",
    links: [
      { to: "/bank", icon: "bank", label: "Bank" },
      { to: "/kasse", icon: "cash", label: "Kasse" },
      { to: "/darlehen", icon: "bank", label: "Darlehen" },
    ],
  },
  {
    label: "Personal",
    links: [
      { to: "/lohn", icon: "payroll", label: "Lohn" },
      // Lohn bleibt immer sichtbar, dort entsteht der erste Mitarbeiter
      { to: "/sv-meldeportal", icon: "mail", label: "SV-Meldeportal", nurMitMitarbeitern: true },
    ],
  },
  {
    label: "Steuern",
    links: [
      { to: "/umsatzsteuer", icon: "vat", label: "Umsatzsteuer" },
      { to: "/jahreserklaerung", icon: "annual", label: "Jahreserklärung" },
      // Gewinnausschüttung und Kapitalertragsteuer gibt es nur für GmbH und UG
      { to: "/ausschuettungen", icon: "cash", label: "Ausschüttungen", nurKapitalgesellschaft: true },
      { to: "/finanzamt", icon: "mail", label: "Finanzamt" },
      { to: "/fristen", icon: "calendar", label: "Fristen" },
    ],
  },
  {
    label: "Buchhaltung",
    links: [
      { to: "/auswertungen", icon: "reports", label: "Auswertungen" },
      { to: "/buchungen", icon: "journal", label: "Buchungen" },
      { to: "/konten", icon: "ledger", label: "Konten" },
      // Bilanz und Abschluss gibt es nur für GmbH und UG
      { to: "/abschluss", icon: "annual", label: "Jahresabschluss", nurKapitalgesellschaft: true },
      { to: "/archiv", icon: "archive", label: "Archiv" },
    ],
  },
];

/** Navigation der Steuerberatung: nur lesen */
export const STEUERBERATUNG_NAV: readonly NavGroup[] = [
  {
    label: "Steuerberatung",
    links: [
      { to: "/auswertungen", icon: "reports", label: "Auswertungen" },
      { to: "/buchungen", icon: "journal", label: "Buchungen" },
      { to: "/konten", icon: "ledger", label: "Konten" },
      { to: "/belege", icon: "receipt", label: "Belege" },
      { to: "/rechnungen", icon: "invoice", label: "Rechnungen" },
    ],
  },
];

export interface SichtbareSeite {
  key: string;
  label: string;
  group: string;
  icon: IconName;
  to: string;
  params?: { id: string };
  externalUrl?: string;
  settingsArea?: SettingsArea;
  keywords?: string;
}

export interface EigeneSeiteNav {
  id: string;
  name: string;
  url: string;
  openInNewTab: boolean;
}

/** Dieselben Seiten wie in der Navigation, gefiltert nach Rolle, Rechtsform, Mitarbeitern und eigenen Seiten (#617) */
export function sichtbareNavSeiten({
  inhaber,
  gesellschaft,
  hatMitarbeiter,
  eigeneSeiten,
  oidcOnly = false,
}: NavKontext & { inhaber: boolean; eigeneSeiten: readonly EigeneSeiteNav[]; oidcOnly?: boolean }): SichtbareSeite[] {
  const gruppen = inhaber ? NAV_GROUPS : STEUERBERATUNG_NAV;
  const seiten: SichtbareSeite[] = [
    {
      key: "uebersicht",
      label: "Übersicht",
      group: "Navigation",
      icon: "overview",
      to: inhaber ? "/" : STEUERBERATUNG_START,
    },
  ];
  for (const group of gruppen) {
    for (const link of group.links) {
      if (!navLinkSichtbar(link, { gesellschaft, hatMitarbeiter })) continue;
      seiten.push({ key: link.to, label: link.label, group: group.label, icon: link.icon, to: link.to });
    }
  }
  if (inhaber) {
    for (const seite of eigeneSeiten) {
      if (seite.openInNewTab) {
        seiten.push({
          key: `seite-${seite.id}`,
          label: seite.name,
          group: "Eigene Seiten",
          icon: "external",
          to: seite.url,
          externalUrl: seite.url,
        });
      } else {
        seiten.push({
          key: `seite-${seite.id}`,
          label: seite.name,
          group: "Eigene Seiten",
          icon: "embed",
          to: "/seiten/$id",
          params: { id: seite.id },
        });
      }
    }
    seiten.push({
      key: "einstellungen",
      label: "Einstellungen",
      group: "Konto",
      icon: "settings",
      to: "/einstellungen",
    });
    for (const area of settingsAreas(oidcOnly)) {
      seiten.push({
        key: `einstellungen-${area.id}`,
        label: area.label,
        group: "Einstellungen",
        icon: "settings",
        to: "/einstellungen",
        settingsArea: area.id,
        keywords: area.hint,
      });
    }
  }
  return seiten;
}
