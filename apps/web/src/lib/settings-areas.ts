/** Bereiche der Einstellungen; ?bereich=… in der Adresse wählt einen aus, ohne Angabe gilt „firma“ */
export const SETTINGS_AREAS = [
  { id: "firma", label: "Firma", hint: "Anschrift, Steuern, Bank, Mahnwesen" },
  { id: "persoenlich", label: "Persönliche Angaben", hint: "Für die Einkommensteuer" },
  { id: "rechnungen", label: "Rechnungen", hint: "Nummernkreis und Logo" },
  { id: "elster", label: "ELSTER", hint: "Zertifikat und ERiC" },
  { id: "email", label: "E-Mail", hint: "Versand und Belege-Postfach" },
  { id: "sicherheit", label: "Sicherheit", hint: "Passkeys" },
  { id: "export", label: "Export", hint: "Archiv und DATEV" },
] as const;

export type SettingsArea = (typeof SETTINGS_AREAS)[number]["id"];
