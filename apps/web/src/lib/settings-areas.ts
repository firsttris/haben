/** Bereiche der Einstellungen; ?bereich=… in der Adresse wählt einen aus. Ohne Angabe zeigt der Desktop „firma“,
    das Handy die Liste aller Bereiche */
export const SETTINGS_AREAS = [
  { id: "firma", label: "Firma", hint: "Anschrift, Steuern, Bank, Mahnwesen" },
  { id: "persoenlich", label: "Persönliche Angaben", hint: "Steuer-ID, Veranlagung, Ehegatte" },
  { id: "rechnungen", label: "Rechnungen", hint: "Nummern, Zahlungspläne, Anhänge" },
  { id: "gestaltung", label: "Beleggestaltung", hint: "Logo, Briefpapier, Farbe, Fußzeile" },
  { id: "elster", label: "ELSTER", hint: "Zertifikat und ERiC" },
  { id: "email", label: "E-Mail", hint: "Versand, Postfach für Belege" },
  { id: "bank", label: "Bank", hint: "Kontoabruf, Google Play, App Store" },
  { id: "sicherheit", label: "Sicherheit", hint: "Passkeys, Passwort, Zugänge" },
  { id: "waehrung", label: "Fremdwährung", hint: "USt-Umrechnungskurse des BMF" },
  { id: "ki", label: "KI-Assistenten und API", hint: "MCP, API-Tokens, Belegauslesung" },
  { id: "seiten", label: "Eigene Seiten", hint: "Eigene Werkzeuge im Menü" },
  { id: "export", label: "Export", hint: "Jahresarchiv, DATEV, Backup, Prüfung" },
] as const;

/** Im SSO-Modus ersetzt „Zugänge“ den Bereich Sicherheit: Passkeys, Passwort und Einladungen gibt es dort nicht */
const SSO_ACCOUNTS_AREA = { id: "zugaenge", label: "Zugänge", hint: "Per SSO angemeldete Konten" } as const;
export const settingsAreas = (only: boolean) => SETTINGS_AREAS.map((area) => (only && area.id === "sicherheit" ? SSO_ACCOUNTS_AREA : area));
export type SettingsArea = (typeof SETTINGS_AREAS)[number]["id"] | "zugaenge";
