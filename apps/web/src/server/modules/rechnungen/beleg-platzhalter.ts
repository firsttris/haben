import type { BELEG_PLATZHALTER } from "@haben/core";
import { gruppierteIban } from "@haben/core";
import { type InvoiceDocument, type QuoteDocument, texts } from "@haben/einvoice";

/*
 * Platzhalter in Einleitung und Hinweis von Rechnung und Angebot (#1334), auch aus Textbausteinen: Im Entwurf stehen sie
 * als Text, aufgelöst werden sie in der Vorschau und beim Festschreiben. Danach stehen in Rechnung, PDF und XML die
 * Werte, nicht mehr die Platzhalter. Die Namen sind die der E-Mail-Vorlagen; neu sind {leistungszeitraum}, {iban} und
 * {bic}. Unbekannte Platzhalter bleiben stehen (fillTemplate), damit ein Tippfehler auffällt.
 */

/** Ersetzt {name} durch den Wert; unbekannte Platzhalter bleiben stehen. Auch für die E-Mail-Vorlagen (invoice-mail.ts) */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

type Werte = Record<keyof typeof BELEG_PLATZHALTER, string>;

function gemeinsameWerte(doc: InvoiceDocument | QuoteDocument, t: ReturnType<typeof texts>) {
  const { serviceFrom: von, serviceTo: bis } = doc;
  const leistungszeitraum = von && bis && von !== bis ? `${t.date(von)} – ${t.date(bis)}` : von || bis ? t.date((von ?? bis)!) : "";
  return {
    // Im Entwurfs-PDF gibt es noch keine Nummer: „ENTWURF“ wie die Markierung auf dem Blatt
    nummer: doc.number || t.draft.mark,
    datum: t.date(doc.issueDate),
    leistungszeitraum,
    kunde: doc.buyer.name,
    firma: doc.seller.name,
    iban: doc.seller.iban ? gruppierteIban(doc.seller.iban) : "",
    bic: doc.seller.bic ?? "",
  };
}

/** Werte einer Rechnung; der Betrag in der Währung der Rechnung wie in der E-Mail ({betrag}) */
export function rechnungsWerte(doc: InvoiceDocument): Werte {
  const t = texts(doc.language, doc.currency);
  return {
    ...gemeinsameWerte(doc, t),
    art: doc.kind === "rechnung" && doc.variant ? t.variants[doc.variant] : t.titles[doc.kind],
    betrag: t.money(doc.totals.gross),
    faellig: t.date(doc.dueDate),
    gueltig: "",
  };
}

export function angebotsWerte(doc: QuoteDocument): Werte {
  const t = texts(doc.language);
  return { ...gemeinsameWerte(doc, t), art: t.titles.angebot, betrag: t.money(doc.totals.gross), faellig: "", gueltig: t.date(doc.validUntil) };
}

/** Einleitung und Hinweis mit aufgelösten Platzhaltern; alles andere bleibt, wie es ist */
export function mitPlatzhaltern<D extends InvoiceDocument | QuoteDocument>(doc: D, werte: Werte): D {
  return {
    ...doc,
    ...(doc.intro ? { intro: fillTemplate(doc.intro, werte) } : {}),
    ...(doc.note ? { note: fillTemplate(doc.note, werte) } : {}),
  };
}

export const rechnungMitPlatzhaltern = (doc: InvoiceDocument) => mitPlatzhaltern(doc, rechnungsWerte(doc));
export const angebotMitPlatzhaltern = (doc: QuoteDocument) => mitPlatzhaltern(doc, angebotsWerte(doc));

type Texte = { intro: string; note: string; introVorlage: string; noteVorlage: string };

/**
 * Was beim Festschreiben in den Beleg geht (#1334): in intro/note die Werte wie auf dem Blatt, in die Vorlage der Text
 * mit Platzhaltern, aber nur, wenn eingesetzt wurde; ohne Platzhalter bleibt sie leer
 */
export function textMitVorlage(entwurf: Pick<Texte, "intro" | "note">, blatt: { intro?: string; note?: string }): Texte {
  const intro = blatt.intro ?? "";
  const note = blatt.note ?? "";
  return { intro, note, introVorlage: intro === entwurf.intro ? "" : entwurf.intro, noteVorlage: note === entwurf.note ? "" : entwurf.note };
}

/** Einleitung und Hinweis mit Platzhaltern für Kopie, Rechnung aus Angebot und Auftragsbestätigung; ohne Vorlage der Text selbst */
export function mitVorlage(beleg: Texte): Pick<Texte, "intro" | "note"> {
  return { intro: beleg.introVorlage || beleg.intro, note: beleg.noteVorlage || beleg.note };
}
