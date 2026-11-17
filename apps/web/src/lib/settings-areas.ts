/** Bereiche der Einstellungen; ?bereich=… in der Adresse wählt einen aus. Ohne Angabe zeigt der Desktop „firma“,
    das Handy die Liste aller Bereiche. `hint` ist der Untertext (ein Satz in Klartext, eine Zeile, ohne Klammern),
    `keywords` sind Fachwörter, die nur die Schnellsuche kennt (#1253) */
export const SETTINGS_AREAS = [
  { id: "firma", label: "Firma", hint: "Anschrift, Steuern, Bank, Mahnwesen" },
  { id: "persoenlich", label: "Persönliche Angaben", hint: "Steuer-ID, Veranlagung, Ehegatte" },
  { id: "bereiche", label: "Bereiche", hint: "Menüpunkte ein- und ausblenden" },
  { id: "rechnungen", label: "Rechnungen", hint: "Nummern, Zahlungspläne, Anhänge" },
  { id: "gestaltung", label: "Beleggestaltung", hint: "Logo, Briefpapier, Farbe, Fußzeile" },
  { id: "elster", label: "ELSTER", hint: "Zertifikat und Übermittlung", keywords: "ERiC" },
  { id: "email", label: "E-Mail", hint: "Versand, Postfach für Belege" },
  { id: "bank", label: "Bank", hint: "Kontoabruf, Google Play, App Store" },
  { id: "konten", label: "Eigene Konten", hint: "Sachkonten mit eigener Nummer" },
  { id: "sicherheit", label: "Sicherheit", hint: "Passkeys, Passwort, Zugänge" },
  { id: "waehrung", label: "Fremdwährung", hint: "Umrechnungskurse zur Umsatzsteuer", keywords: "USt BMF" },
  { id: "ki", label: "KI-Assistenten und API", hint: "Zugang, Schlüssel, Belegauslesung", keywords: "Assistenten MCP API-Tokens Belege auslesen" },
  { id: "seiten", label: "Eigene Seiten", hint: "Eigene Werkzeuge im Menü" },
  { id: "export", label: "Export", hint: "Jahresarchiv, Steuerberatung", keywords: "DATEV Ablage Backup Prüfung Version" },
] as const;

/** Im SSO-Modus ersetzt „Zugänge“ den Bereich Sicherheit: Passkeys, Passwort und Einladungen gibt es dort nicht */
const SSO_ACCOUNTS_AREA = { id: "zugaenge", label: "Zugänge", hint: "Per SSO angemeldete Konten" } as const;
export type SettingsArea = (typeof SETTINGS_AREAS)[number]["id"] | "zugaenge";
export const settingsAreas = (only: boolean): { id: SettingsArea; label: string; hint: string; keywords?: string }[] =>
  SETTINGS_AREAS.map((area) => (only && area.id === "sicherheit" ? SSO_ACCOUNTS_AREA : area));
