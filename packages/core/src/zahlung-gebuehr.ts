/*
 * Zahlung und Gebühr eines Zahlungsdienstleisters (PayPal, Stripe, Shopify Payments, eBay): Der Import legt aus einer
 * Zeile mit Brutto und Gebühr zwei Umsätze an. Die Gebühr trägt die Referenz der Zahlung mit einem festen Anhang
 * (`txn_1-gebuehr`, bei Shopify `ref|gebuehr`). Daran erkennt Haben, welche zwei Umsätze zusammengehören, ohne dass
 * die Umsätze selbst oder ihre Kennungen sich ändern.
 */

const SUFFIXE = ["-gebuehr", "|gebuehr"] as const;

/** Referenz der zugehörigen Zahlung, wenn `reference` die einer Gebühr ist */
export function zahlungsReferenz(reference: string | null | undefined): string | null {
  if (!reference) return null;
  for (const suffix of SUFFIXE) {
    if (reference.endsWith(suffix) && reference.length > suffix.length) return reference.slice(0, -suffix.length);
  }
  return null;
}

/** Mögliche Referenzen der Gebühr zu einer Zahlung; die Gebühr selbst hat keine weitere */
export function gebuehrReferenzen(reference: string | null | undefined): string[] {
  if (!reference || zahlungsReferenz(reference)) return [];
  return SUFFIXE.map((suffix) => `${reference}${suffix}`);
}

interface GebuehrUmsatz {
  id: string;
  bankAccountId: string;
  bankReference: string | null;
  amount: number;
  /** Noch nicht zugeordneter Teil, mit dem Vorzeichen des Umsatzes */
  open: number;
}

export interface GruppierterUmsatz<T> {
  /** Die Zahlung, sonst der Umsatz selbst */
  umsatz: T;
  /** Die Gebühr derselben Bewegung, falls beide zusammengefasst sind */
  gebuehr: T | null;
}

/**
 * Fasst eine Zahlung und ihre Gebühr zu einer Zeile zusammen, an der Stelle der Zahlung. Das gilt nur, solange beide ganz
 * offen sind, die Zahlung ein Eingang und die Gebühr ein Abzug ist und die Referenz je Konto genau eine Zahlung und eine
 * Gebühr trifft. Sonst bleiben beide eigene Zeilen: Erstattungen mit gutgeschriebener Gebühr, schon zugeordnete oder
 * teilweise zugeordnete Umsätze und alles, was sich nicht eindeutig zuordnen lässt, sind einzeln erreichbar. Mit `konten`
 * (Zahlungsdienstleister) werden nur Umsätze dieser Konten zusammengefasst; ein Bankkonto kennt keine Gebühr einer Bewegung.
 */
export function gruppiereGebuehren<T extends GebuehrUmsatz>(umsaetze: readonly T[], konten?: ReadonlySet<string>): GruppierterUmsatz<T>[] {
  const key = (account: string, reference: string) => JSON.stringify([account, reference]);
  const zahlungen = new Map<string, T[]>();
  const gebuehren = new Map<string, T[]>();
  for (const u of umsaetze) {
    if (!u.bankReference || (konten && !konten.has(u.bankAccountId))) continue;
    const zahlung = zahlungsReferenz(u.bankReference);
    const [map, ref] = zahlung ? ([gebuehren, zahlung] as const) : ([zahlungen, u.bankReference] as const);
    const k = key(u.bankAccountId, ref);
    map.set(k, [...(map.get(k) ?? []), u]);
  }
  const ganzOffen = (u: T) => u.open === u.amount;
  const gruppen = new Map<string, T>();
  const versteckt = new Set<string>();
  for (const [k, [zahlung, ...weitere]] of zahlungen) {
    const fees = gebuehren.get(k);
    const gebuehr = fees?.length === 1 ? fees[0] : undefined;
    if (!zahlung || weitere.length > 0 || !gebuehr) continue;
    if (zahlung.amount <= 0 || gebuehr.amount >= 0 || !ganzOffen(zahlung) || !ganzOffen(gebuehr)) continue;
    gruppen.set(zahlung.id, gebuehr);
    versteckt.add(gebuehr.id);
  }
  return umsaetze.filter((u) => !versteckt.has(u.id)).map((u) => ({ umsatz: u, gebuehr: gruppen.get(u.id) ?? null }));
}

/**
 * Der Umsatz, den die Bankseite zuerst zeigt: der erste offene unter den sichtbaren Zeilen, sonst der erste sichtbare.
 * Eine in die Zeile der Zahlung aufgegangene Gebühr zählt nicht, auch wenn die Sortierung sie vor die Zahlung stellt.
 */
export function vorauswahlUmsatz<T extends GebuehrUmsatz>(umsaetze: readonly T[], konten?: ReadonlySet<string>): T | undefined {
  const sichtbar = gruppiereGebuehren(umsaetze, konten).map((g) => g.umsatz);
  return sichtbar.find((u) => u.open !== 0) ?? sichtbar[0];
}
