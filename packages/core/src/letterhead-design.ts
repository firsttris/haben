import { z } from "zod";
import { ACCENT_PATTERN, DEFAULT_ACCENT } from "./accent.ts";
import { footerIssues, MAX_FOOTER_COLUMNS, MAX_FOOTER_TEXT, MIN_FOOTER_COLUMNS } from "./footer-template.ts";

/**
 * Layout eines Belegs. Heute gibt es nur das eingebaute „klassisch“; eigene Vorlagen (Roadmap Platz 7, #113) bekommen eine
 * eigene Art, damit Auswahl und Momentaufnahme eingebaute und eigene Layouts unterscheiden können.
 */
export interface LayoutRef {
  kind: "eingebaut";
  id: string;
}

export interface LayoutEntry extends LayoutRef {
  name: string;
}

export const BUILTIN_LAYOUTS: readonly LayoutEntry[] = [{ kind: "eingebaut", id: "klassisch", name: "Klassisch" }];

export const DEFAULT_LAYOUT: LayoutRef = { kind: "eingebaut", id: "klassisch" };

/** Belegarten mit eigener Layoutwahl; Storno und Korrektur folgen der Rechnung, sie entstehen aus derselben Vorlage */
export const LAYOUT_DOCUMENT_TYPES = ["rechnung", "angebot", "auftragsbestaetigung", "lieferschein", "mahnung"] as const;
export type LayoutDocumentType = (typeof LAYOUT_DOCUMENT_TYPES)[number];

export const LAYOUT_DOCUMENT_LABELS: Record<LayoutDocumentType, string> = {
  rechnung: "Rechnung, Storno und Korrektur",
  angebot: "Angebot",
  auftragsbestaetigung: "Auftragsbestätigung",
  lieferschein: "Lieferschein",
  mahnung: "Mahnung",
};

export type LayoutAssignment = Record<LayoutDocumentType, LayoutRef>;

/** Größte Maße des Logos in mm; „m“ ist das bisherige Maß. Auch „l“ endet über dem Anschriftfeld (Rand 20 + 24 < 45 mm, DIN 5008) */
export const LOGO_SIZES = {
  s: { height: 12, width: 40 },
  m: { height: 18, width: 60 },
  l: { height: 24, width: 80 },
} as const;
export type LogoSize = keyof typeof LOGO_SIZES;
export type LogoPosition = "links" | "rechts";

/** Was die Gestaltung auf dem Blatt ändert, ohne Inhalt und Layoutwahl */
export interface LetterheadOptions {
  logoSize: LogoSize;
  logoPosition: LogoPosition;
  foldMarks: boolean;
  giroCode: boolean;
  customerNumber: boolean;
  /** Spalte USt je Position; bei mehreren Steuersätzen bleibt sie stehen, siehe showsVatColumn */
  vatColumn: boolean;
  /** Eigene Spalten der Fußzeile mit Platzhaltern; null = automatisch aus den Firmendaten */
  footerColumns: string[] | null;
}

/** Gestaltung eines Briefkopf-Profils (#113). Neue Einstellungen brauchen eine Vorgabe in DEFAULT_DESIGN, ältere Zeilen kennen sie nicht */
export interface LetterheadDesign extends LetterheadOptions {
  layouts: LayoutAssignment;
  /** #RRGGBB */
  accent: string;
}

export const DEFAULT_OPTIONS: LetterheadOptions = {
  logoSize: "m",
  logoPosition: "rechts",
  foldMarks: true,
  giroCode: true,
  customerNumber: true,
  vatColumn: true,
  footerColumns: null,
};

export const DEFAULT_DESIGN: LetterheadDesign = {
  ...DEFAULT_OPTIONS,
  layouts: Object.fromEntries(LAYOUT_DOCUMENT_TYPES.map((type) => [type, DEFAULT_LAYOUT])) as LayoutAssignment,
  accent: DEFAULT_ACCENT,
};

/** Vervollständigt gespeicherte Gestaltung um Einstellungen, die es beim Speichern noch nicht gab */
export function designWithDefaults(stored: Partial<LetterheadDesign> | null | undefined): LetterheadDesign {
  return { ...DEFAULT_DESIGN, ...stored, layouts: { ...DEFAULT_DESIGN.layouts, ...stored?.layouts } };
}

/**
 * Die Spalte darf nur entfallen, wenn alle Positionen denselben Satz haben: Dann nennt ihn die Summe eindeutig. Bei mehreren
 * Sätzen zeigt erst die Spalte, welche Position wie besteuert ist (§ 14 Abs. 4 Nr. 7 und 8 UStG).
 */
export const showsVatColumn = (vatColumn: boolean, rates: number): boolean => vatColumn || rates > 1;

/** Steuersätze in den Zeilen des Blatts; anders als die Summen zählen optionale und alternative Positionen eines Angebots mit */
export const distinctVatRates = (lines: readonly { taxRate: number }[]): number => new Set(lines.map((line) => line.taxRate)).size;

/** Was das Panel und die Einstellungen ändern dürfen; die Layoutwahl kommt mit dem zweiten Layout dazu */
export const letterheadDesignInputSchema = z
  .object({
    accent: z.string().regex(ACCENT_PATTERN),
    logoSize: z.enum(["s", "m", "l"]),
    logoPosition: z.enum(["links", "rechts"]),
    foldMarks: z.boolean(),
    giroCode: z.boolean(),
    customerNumber: z.boolean(),
    vatColumn: z.boolean(),
    footerColumns: z
      .array(z.string().max(MAX_FOOTER_TEXT))
      .min(MIN_FOOTER_COLUMNS)
      .max(MAX_FOOTER_COLUMNS)
      .refine((columns) => footerIssues(columns).length === 0)
      .nullable(),
  })
  .partial();
export type LetterheadDesignInput = z.infer<typeof letterheadDesignInputSchema>;
