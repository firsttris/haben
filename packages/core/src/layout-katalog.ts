import { DEFAULT_ACCENT } from "./accent.ts";
import type { LetterheadFont, LogoPosition } from "./letterhead-design.ts";

/*
 * Katalog der eingebauten Layouts (#113): Name, Vorlagen, Vorgaben für Schrift und Akzentfarbe, erlaubte Stellen für das
 * Logo und Optionen. Die Gestaltung liest ihn und zeigt nur, was ein Layout kann; die Vorlage bekommt die aufgelösten Werte.
 *
 * Optionen: Ein Layout erklärt höchstens drei Optionen mit festen Werten, in fester Reihenfolge. Ein Wert darf nur von
 * Optionen davor abhängen (wenn), nie von späteren; so gibt es keinen Kreis. Ist ein gewählter Wert durch eine frühere
 * Option gesperrt, gilt der erste erlaubte; die Wahl bleibt gespeichert. Sind alle Werte einer Option gesperrt, gilt sie
 * nicht (etwa die Kerndaten bei Klar in der Fassung „Klassisch“). Zwei Werte, die sich gleichrangig ausschließen, gehören in
 * dieselbe Option. layout-katalog.test.ts prüft das für jedes Layout.
 */

export interface LayoutOptionWert {
  id: string;
  name: string;
  /** Nur erlaubt, wenn frühere Optionen einen dieser Werte haben, etwa { fuss: ["unten"] } */
  wenn?: Record<string, readonly string[]>;
  /** Andere erlaubte Stellen für das Logo, solange dieser Wert gilt */
  logo?: readonly LogoPosition[];
  /** Vorlage für Belege und Mahnungen, wenn dieser Wert sie bestimmt (etwa der Fuß unten oder rechts) */
  vorlagen?: LayoutVorlagen;
  /** Andere Vorgaben für Schrift oder Akzentfarbe, solange dieser Wert gilt */
  vorgaben?: Partial<LayoutVorgaben>;
}

export interface LayoutVorgaben {
  font: LetterheadFont;
  accent: string;
}

export interface LayoutOption {
  id: string;
  name: string;
  werte: readonly LayoutOptionWert[];
}

export interface LayoutVorlagen {
  beleg: string;
  mahnung: string;
}

export interface EingebautesLayout {
  id: string;
  name: string;
  beschreibung: string;
  vorlagen: LayoutVorlagen;
  vorgaben: LayoutVorgaben;
  logo: readonly LogoPosition[];
  optionen: readonly LayoutOption[];
}

export const MAX_LAYOUT_OPTIONEN = 3;

const vorlagen = (name: string): LayoutVorlagen => ({ beleg: `layout-${name}.typ`, mahnung: `layout-${name}-mahnung.typ` });

const kerndaten = (werte: readonly LayoutOptionWert[]): LayoutOption => ({ id: "kerndaten", name: "Kerndaten", werte });

/** In der Reihenfolge der Auswahl; das bisherige Layout ist Klar in der Fassung „Klassisch“ */
export const EINGEBAUTE_LAYOUTS: readonly EingebautesLayout[] = [
  {
    id: "klar",
    name: "Klar",
    beschreibung: "Schlicht und serifenlos, Kerndaten an einer feinen Linie oder auf einer Karte in der Akzentfarbe",
    vorlagen: vorlagen("klar"),
    vorgaben: { font: "inter", accent: DEFAULT_ACCENT },
    logo: ["rechts", "links", "mitte"],
    optionen: [
      {
        id: "fassung",
        name: "Fassung",
        werte: [
          { id: "standard", name: "Standard" },
          // Das Layout von Haben vor #113 (rechnung.typ, mahnung.typ); bestehende Installationen bekommen es per Migration 0312
          { id: "klassisch", name: "Klassisch", vorlagen: { beleg: "rechnung.typ", mahnung: "mahnung.typ" }, vorgaben: { font: "plex-sans" } },
        ],
      },
      kerndaten([
        { id: "linie", name: "Mit Linie", wenn: { fassung: ["standard"] }, vorlagen: vorlagen("klar") },
        { id: "karte", name: "Auf Karte", wenn: { fassung: ["standard"] }, vorlagen: vorlagen("klar-karte") },
      ]),
    ],
  },
  {
    id: "modern",
    name: "Modern",
    beschreibung: "Große Überschrift, viel Luft, offene Tabelle",
    vorlagen: vorlagen("modern"),
    vorgaben: { font: "nunito-sans", accent: DEFAULT_ACCENT },
    logo: ["rechts", "links", "mitte"],
    optionen: [
      {
        id: "akzent",
        name: "Akzentfarbe",
        werte: [
          { id: "farbig", name: "Farbig" },
          { id: "sparsam", name: "Sparsam" },
        ],
      },
      {
        id: "fusslinie",
        name: "Linie über dem Fuß",
        werte: [
          { id: "ohne", name: "Ohne" },
          { id: "mit", name: "Mit" },
        ],
      },
    ],
  },
  {
    id: "strukturiert",
    name: "Strukturiert",
    beschreibung: "Tabellen mit Gitter, weitere Referenzen als eigener Block, für viele Angaben",
    vorlagen: vorlagen("strukturiert"),
    vorgaben: { font: "plex-sans", accent: DEFAULT_ACCENT },
    logo: ["rechts", "links", "mitte"],
    optionen: [
      {
        id: "infoblock",
        name: "Infoblock",
        werte: [
          { id: "gitter", name: "Als Tabelle" },
          { id: "kasten", name: "Im Kasten" },
        ],
      },
    ],
  },
  {
    id: "elegant",
    name: "Elegant",
    beschreibung: "Serifenschrift, ruhig, Fuß in einer Randspalte oder unten",
    vorlagen: vorlagen("elegant-rechts"),
    vorgaben: { font: "literata", accent: DEFAULT_ACCENT },
    logo: ["rechts", "links", "mitte"],
    optionen: [
      {
        id: "fuss",
        name: "Fuß",
        werte: [
          { id: "rechts", name: "In der Randspalte", vorlagen: vorlagen("elegant-rechts"), logo: ["rechts", "links"] },
          { id: "unten", name: "Unten", vorlagen: vorlagen("elegant-unten") },
        ],
      },
      kerndaten([
        { id: "liste", name: "Liste" },
        { id: "zweispaltig", name: "Zweispaltig", wenn: { fuss: ["unten"] } },
      ]),
    ],
  },
  {
    id: "premium",
    name: "Atelier",
    beschreibung: "Display-Serif, Haarlinien in Gold, viel Weißraum",
    vorlagen: vorlagen("premium-unten"),
    vorgaben: { font: "figtree", accent: "#B5862A" },
    logo: ["rechts", "links", "mitte"],
    optionen: [
      {
        id: "fuss",
        name: "Fuß",
        werte: [
          { id: "unten", name: "Unten", vorlagen: vorlagen("premium-unten") },
          { id: "rechts", name: "In der Randspalte", vorlagen: vorlagen("premium-rechts") },
        ],
      },
      kerndaten([
        { id: "liste", name: "Liste" },
        { id: "zweispaltig", name: "Zweispaltig", wenn: { fuss: ["unten"] } },
      ]),
    ],
  },
];

/** Standard für neue Installationen; bestehende bekommen per Migration Klar in der Fassung „Klassisch“ */
export const STANDARD_LAYOUT_ID = "klar";

export function eingebautesLayout(id: string): EingebautesLayout | undefined {
  return EINGEBAUTE_LAYOUTS.find((layout) => layout.id === id);
}

/** Ob ein Wert bei den schon aufgelösten früheren Optionen erlaubt ist */
export const wertErlaubt = (wert: LayoutOptionWert, frueher: Readonly<Record<string, string>>): boolean =>
  Object.entries(wert.wenn ?? {}).every(([option, erlaubt]) => erlaubt.includes(frueher[option] ?? ""));

/**
 * Optionen eines Layouts aufgelöst: der gewählte Wert, wenn es ihn gibt und er erlaubt ist, sonst der erste erlaubte.
 * Unbekannte Optionen und solche ohne erlaubten Wert fallen weg.
 */
export function layoutOptionen(layout: EingebautesLayout, gewaehlt: Readonly<Record<string, string>> = {}): Record<string, string> {
  const aufgeloest: Record<string, string> = {};
  for (const option of layout.optionen) {
    const erlaubt = option.werte.filter((wert) => wertErlaubt(wert, aufgeloest));
    const wahl = erlaubt.find((wert) => wert.id === gewaehlt[option.id]) ?? erlaubt[0];
    if (wahl) aufgeloest[option.id] = wahl.id;
  }
  return aufgeloest;
}

const gewaehlteWerte = (layout: EingebautesLayout, optionen: Readonly<Record<string, string>>) =>
  layout.optionen.flatMap((option) => option.werte.filter((wert) => wert.id === optionen[option.id]));

/** Vorlagen für die aufgelösten Optionen: die eines Werts, der sie bestimmt, sonst die des Layouts */
export function layoutVorlagen(layout: EingebautesLayout, optionen: Readonly<Record<string, string>>): LayoutVorlagen {
  return gewaehlteWerte(layout, optionen).find((wert) => wert.vorlagen)?.vorlagen ?? layout.vorlagen;
}

/** Vorgaben für Schrift und Akzentfarbe bei den aufgelösten Optionen: die des Layouts, ergänzt um die eines Werts */
export function layoutVorgaben(layout: EingebautesLayout, optionen: Readonly<Record<string, string>>): LayoutVorgaben {
  return Object.assign({}, layout.vorgaben, ...gewaehlteWerte(layout, optionen).map((wert) => wert.vorgaben ?? {}));
}

/** Erlaubte Stellen für das Logo bei den aufgelösten Optionen */
export function layoutLogo(layout: EingebautesLayout, optionen: Readonly<Record<string, string>>): readonly LogoPosition[] {
  return gewaehlteWerte(layout, optionen).find((wert) => wert.logo)?.logo ?? layout.logo;
}

/** Stelle des Logos: die gewählte, wenn das Layout sie erlaubt, sonst die erste erlaubte */
export function logoStelle(layout: EingebautesLayout, optionen: Readonly<Record<string, string>>, gewaehlt: LogoPosition): LogoPosition {
  const erlaubt = layoutLogo(layout, optionen);
  return erlaubt.includes(gewaehlt) ? gewaehlt : (erlaubt[0] ?? gewaehlt);
}

/** Gespeicherte Wahl ohne Unbekanntes: nur Layouts, Optionen und Werte aus dem Katalog; gesperrte Werte bleiben gespeichert */
export function bekannteLayoutOptionen(gewaehlt: Readonly<Record<string, Readonly<Record<string, string>>>>): Record<string, Record<string, string>> {
  const ergebnis: Record<string, Record<string, string>> = {};
  for (const [id, werte] of Object.entries(gewaehlt)) {
    const layout = eingebautesLayout(id);
    if (!layout) continue;
    ergebnis[id] = Object.fromEntries(
      layout.optionen.flatMap((option) => (option.werte.some((wert) => wert.id === werte[option.id]) ? [[option.id, werte[option.id]!]] : [])),
    );
  }
  return ergebnis;
}

export interface OptionZurWahl {
  id: string;
  name: string;
  /** Aufgelöster Wert, wie ihn das Blatt setzt */
  wert: string;
  /** Alle Werte; gesperrte zeigt die Gestaltung ausgegraut */
  werte: { id: string; name: string; erlaubt: boolean }[];
}

/** Optionen für die Gestaltung: je Option der aufgelöste Wert und welche Werte bei den früheren erlaubt sind; ohne erlaubten Wert fällt sie weg */
export function optionenZurWahl(layout: EingebautesLayout, gewaehlt: Readonly<Record<string, string>> = {}): OptionZurWahl[] {
  const aufgeloest = layoutOptionen(layout, gewaehlt);
  return layout.optionen.flatMap((option) => {
    const wert = aufgeloest[option.id];
    if (wert === undefined) return [];
    const werte = option.werte.map(({ id, name, ...rest }) => ({ id, name, erlaubt: wertErlaubt({ id, name, ...rest }, aufgeloest) }));
    return [{ id: option.id, name: option.name, wert, werte }];
  });
}
