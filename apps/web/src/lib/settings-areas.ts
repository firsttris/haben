/** Bereiche der Einstellungen; ?bereich=… in der Adresse wählt einen aus, ohne Angabe gilt „firma“ */
export const SETTINGS_AREAS = [
  { id: "firma", label: "Firma", hint: "Anschrift, Steuern, Bank, Mahnwesen" },
  { id: "persoenlich", label: "Persönliche Angaben", hint: "Für die Einkommensteuer" },
  { id: "rechnungen", label: "Rechnungen", hint: "Nummern, Logo, Farbe" },
  { id: "elster", label: "ELSTER", hint: "Zertifikat und ERiC" },
  { id: "email", label: "E-Mail", hint: "Versand und Belege-Postfach" },
  { id: "bank", label: "Bank", hint: "Automatischer Kontoabruf" },
  { id: "sicherheit", label: "Sicherheit", hint: "Passkeys, Zugänge" },
  { id: "waehrung", label: "Fremdwährung", hint: "Umrechnungskurse des BMF" },
  { id: "ki", label: "KI-Assistenten und API", hint: "MCP und REST-API mit Tokens" },
  { id: "seiten", label: "Eigene Seiten", hint: "Eigene Werkzeuge im Menü" },
  { id: "export", label: "Export", hint: "Archiv, DATEV, Prüfung, Backup" },
] as const;

export type SettingsArea = (typeof SETTINGS_AREAS)[number]["id"];
