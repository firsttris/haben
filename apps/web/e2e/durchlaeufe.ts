/**
 * Die Durchläufe der Ende-zu-Ende-Tests, jeder mit eigenem Server und eigener, leerer Datenbank, damit sie
 * parallel laufen: app.spec.ts legt die Daten für das Projekt „mit-daten“ an, die übrigen spielen je ein Thema
 * für sich durch. playwright.config.ts startet die Server, die Tests greifen über databaseUrlFuer direkt auf
 * ihre Datenbank zu, wo sie Daten von außen nachstellen.
 */

export const PORT = Number(process.env.E2E_PORT ?? 3100);
const databaseUrl = process.env.E2E_DATABASE_URL ?? "";

/** Name → Abstand des Ports zu E2E_PORT; der Hauptdurchlauf (app.spec.ts) hat den Port selbst */
export const DURCHLAEUFE = {
  gmbh: 1,
  rechnungen: 2,
  "belege-steuern": 3,
  rueckfragen: 4,
  belegimport: 5,
  "bb-import": 6,
  "beleg-storno": 11,
  "dauerfrist-euer": 12,
  verrechnung: 13,
  firmen: 14,
  passwort: 16,
} as const;
export type Durchlauf = keyof typeof DURCHLAEUFE;

/** Die nachgebaute Enable-Banking-API in belege-steuern.spec.ts; + 7 und + 8 belegen langsame-anfrage und beenden */
export const ENABLE_BANKING_PORT = PORT + 9;

/** Nachgebaute Paketquelle für eigene Layouts in layouts.spec.ts (LAYOUTS_PACKAGES_URL) */
export const LAYOUT_PAKETE_PORT = PORT + 10;

/** Zweiter Server in firmen.spec.ts auf derselben Datenbank, mit so vielen Firmen, dass der Wechsler ein Suchfeld hat */
export const FIRMEN_VIELE_PORT = PORT + 15;

export const portFuer = (durchlauf?: Durchlauf) => PORT + (durchlauf ? DURCHLAEUFE[durchlauf] : 0);

/** Neben der E2E-Datenbank, Name endet wie verlangt auf „e2e“: haben_e2e → haben_gmbh_e2e */
export const databaseUrlFuer = (durchlauf?: Durchlauf, basis = databaseUrl) =>
  durchlauf ? basis.replace(/e2e(\?.*)?$/i, `${durchlauf.replace(/-/g, "_")}_e2e$1`) : basis;

/** Echte Server nutzen optional die App-Anmeldung; direkte SQL-Fixtures behalten databaseUrlFuer. */
export function appDatabaseUrlFuer(durchlauf?: Durchlauf, server: string = durchlauf ?? "ablauf") {
  if (!process.env.E2E_APP_DATABASE_URL) return databaseUrlFuer(durchlauf);
  const url = new URL(databaseUrlFuer(durchlauf, process.env.E2E_APP_DATABASE_URL));
  // Die Identitätsprobe unterscheidet den Hauptserver von den zusätzlichen Servern gegen dieselbe Datenbank.
  url.searchParams.set("application_name", `haben-e2e-${server}`);
  return url.toString();
}

/** Die anderen Firmen im Durchlauf „firmen“ (#504); ihre Instanzen muss es nicht geben. Der zweite Name ist lang und ohne Trennstelle */
export const ANDERE_FIRMEN = [
  { name: "Werkstatt Süd", url: "https://werkstatt.example.de" },
  { name: "Gebäudereinigungsgesellschaft Nordfriesland", url: "https://reinigung.example.de" },
];

/** HABEN_FIRMEN für einen Server unter `eigene`: er selbst als „Studio Nord“ und die anderen */
export const habenFirmen = (eigene: string, andere = ANDERE_FIRMEN) =>
  [{ name: "Studio Nord", url: eigene }, ...andere].map((firma) => `${firma.name}|${firma.url}`).join(";");
