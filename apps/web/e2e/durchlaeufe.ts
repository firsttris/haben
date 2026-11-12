/**
 * Die Durchläufe der Ende-zu-Ende-Tests, jeder mit eigenem Server und eigener, leerer Datenbank, damit sie
 * parallel laufen: app.spec.ts legt die Daten für das Projekt „mit-daten“ an, die übrigen spielen je ein Thema
 * für sich durch. playwright.config.ts startet die Server, die Tests greifen über databaseUrlFuer direkt auf
 * ihre Datenbank zu, wo sie Daten von außen nachstellen.
 */

export const PORT = Number(process.env.E2E_PORT ?? 3100);
const databaseUrl = process.env.E2E_DATABASE_URL ?? "";

/** Name → Abstand des Ports zu E2E_PORT; der Hauptdurchlauf (app.spec.ts) hat den Port selbst */
export const DURCHLAEUFE = { gmbh: 1, rechnungen: 2, "belege-steuern": 3, rueckfragen: 4, belegimport: 5, "bb-import": 6, "dauerfrist-euer": 12 } as const;
export type Durchlauf = keyof typeof DURCHLAEUFE;

/** Die nachgebaute Enable-Banking-API in belege-steuern.spec.ts; + 7 und + 8 belegen langsame-anfrage und beenden */
export const ENABLE_BANKING_PORT = PORT + 9;

/** Nachgebaute Paketquelle für eigene Layouts in layouts.spec.ts (LAYOUTS_PACKAGES_URL) */
export const LAYOUT_PAKETE_PORT = PORT + 10;

export const portFuer = (durchlauf?: Durchlauf) => PORT + (durchlauf ? DURCHLAEUFE[durchlauf] : 0);

/** Neben der E2E-Datenbank, Name endet wie verlangt auf „e2e“: haben_e2e → haben_gmbh_e2e */
export const databaseUrlFuer = (durchlauf?: Durchlauf) =>
  durchlauf ? databaseUrl.replace(/e2e(\?.*)?$/i, `${durchlauf.replace(/-/g, "_")}_e2e$1`) : databaseUrl;
