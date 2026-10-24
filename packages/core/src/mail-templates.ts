/*
 * Vorlagen für E-Mails zu Rechnungen, Angeboten und Mahnungen: Betreff und Text je Art und Sprache, mit Platzhaltern
 * wie {nummer} oder {betrag}. Eine leere Vorlage fällt zurück auf die allgemeine ihrer Gruppe in derselben Sprache
 * (etwa Abschlagsrechnung → Rechnung) und danach auf den eingebauten Standardtext. Betreff und Text fallen einzeln
 * zurück, eine Vorlage nur mit eigenem Betreff behält also den Standardtext.
 */

export type MailLanguage = "de" | "en";

export const MAIL_LANGUAGES: Record<MailLanguage, string> = { de: "Deutsch", en: "Englisch" };

/** Arten mit eigener Vorlage. general: die allgemeine Vorlage, auf die die Art zurückfällt */
export const MAIL_TEMPLATE_KINDS = {
  rechnung: { label: "Rechnung (allgemein)", group: "rechnung", general: null, languages: ["de", "en"] },
  abschlag: { label: "Abschlagsrechnung", group: "rechnung", general: "rechnung", languages: ["de", "en"] },
  schluss: { label: "Schlussrechnung", group: "rechnung", general: "rechnung", languages: ["de", "en"] },
  storno: { label: "Stornorechnung", group: "rechnung", general: "rechnung", languages: ["de", "en"] },
  korrektur: { label: "Rechnungskorrektur", group: "rechnung", general: "rechnung", languages: ["de", "en"] },
  angebot: { label: "Angebot", group: "angebot", general: null, languages: ["de", "en"] },
  // Mahnungen gibt es nur auf Deutsch (das PDF der Mahnung ist deutsch)
  mahnung: { label: "Mahnung (allgemein)", group: "mahnung", general: null, languages: ["de"] },
  "mahnung-1": { label: "Zahlungserinnerung", group: "mahnung", general: "mahnung", languages: ["de"] },
  "mahnung-2": { label: "1. Mahnung", group: "mahnung", general: "mahnung", languages: ["de"] },
  "mahnung-3": { label: "Letzte Mahnung", group: "mahnung", general: "mahnung", languages: ["de"] },
} as const satisfies Record<string, { label: string; group: "rechnung" | "angebot" | "mahnung"; general: string | null; languages: readonly MailLanguage[] }>;

export type MailTemplateKind = keyof typeof MAIL_TEMPLATE_KINDS;

export interface MailTemplate {
  subject: string;
  body: string;
}

/** Gespeicherte Vorlagen, Schlüssel „Art:Sprache“, z. B. „abschlag:en“ */
export type MailTemplates = Record<string, MailTemplate>;

export const mailTemplateKey = (kind: MailTemplateKind, language: MailLanguage) => `${kind}:${language}`;

/** Alle zulässigen Schlüssel, für die Prüfung beim Speichern */
export const MAIL_TEMPLATE_KEYS: string[] = Object.entries(MAIL_TEMPLATE_KINDS).flatMap(([kind, k]) =>
  k.languages.map((language) => mailTemplateKey(kind as MailTemplateKind, language)),
);

/** Eingebaute Standardtexte je Gruppe und Sprache; {art} nennt die genaue Art („Abschlagsrechnung“, „Corrective invoice“) */
export const DEFAULT_MAIL_TEMPLATES: Record<"rechnung" | "angebot" | "mahnung", Partial<Record<MailLanguage, MailTemplate>>> = {
  rechnung: {
    de: {
      subject: "{art} {nummer} von {firma}",
      body: `Guten Tag,

anbei erhalten Sie unsere {art} {nummer} vom {datum} über {betrag}{zahlbar}.

Mit freundlichen Grüßen
{firma}`,
    },
    en: {
      subject: "{art} {nummer} from {firma}",
      body: `Dear Sir or Madam,

please find attached {art} {nummer} dated {datum} for {betrag}{zahlbar}.

Kind regards
{firma}`,
    },
  },
  angebot: {
    de: {
      subject: "Angebot {nummer} von {firma}",
      body: `Guten Tag,

anbei erhalten Sie unser Angebot {nummer} vom {datum} über {betrag}. Es gilt bis zum {gueltig}.

Für Rückfragen sind wir gern für Sie da.

Mit freundlichen Grüßen
{firma}`,
    },
    en: {
      subject: "Quote {nummer} from {firma}",
      body: `Dear Sir or Madam,

please find attached our quote {nummer} dated {datum} for {betrag}. It is valid until {gueltig}.

Please do not hesitate to contact us if you have any questions.

Kind regards
{firma}`,
    },
  },
  mahnung: {
    de: {
      subject: "{stufe} zur Rechnung {nummer}",
      body: `Guten Tag,

anbei erhalten Sie unsere {stufe} zur Rechnung {nummer} vom {datum}. Bitte überweisen Sie den offenen Betrag von {betrag} bis zum {frist}.

Sollten Sie inzwischen bezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.

Mit freundlichen Grüßen
{firma}`,
    },
  },
};

/** Woher ein Feld kommt, für den Hinweis in den Einstellungen */
export type MailTemplateSource = { kind: MailTemplateKind } | "standard";

/**
 * Wirksame Vorlage für Art und Sprache: eigene Vorlage der Art, sonst die allgemeine der Gruppe in derselben Sprache,
 * sonst der Standardtext. Gibt es die Art in der Sprache nicht (Mahnung auf Englisch), gilt die deutsche.
 */
export function resolveMailTemplate(templates: MailTemplates | null | undefined, kind: MailTemplateKind, language: MailLanguage): MailTemplate {
  const entry = MAIL_TEMPLATE_KINDS[kind];
  const lang: MailLanguage = (entry.languages as readonly MailLanguage[]).includes(language) ? language : "de";
  const chain: MailTemplateKind[] = entry.general ? [kind, entry.general] : [kind];
  const fallback = DEFAULT_MAIL_TEMPLATES[entry.group][lang] ?? DEFAULT_MAIL_TEMPLATES[entry.group].de!;
  const pick = (field: keyof MailTemplate) =>
    chain.map((k) => templates?.[mailTemplateKey(k, lang)]?.[field]?.trim()).find((value) => value) ?? fallback[field];
  return { subject: pick("subject"), body: pick("body") };
}

/** Was gilt, wenn das Feld leer bleibt: die allgemeine Vorlage (falls gefüllt) oder der Standardtext */
export function mailTemplateFallback(
  templates: MailTemplates | null | undefined,
  kind: MailTemplateKind,
  language: MailLanguage,
  field: keyof MailTemplate,
): { text: string; source: MailTemplateSource } {
  const entry = MAIL_TEMPLATE_KINDS[kind];
  const general = entry.general ? templates?.[mailTemplateKey(entry.general, language)]?.[field]?.trim() : undefined;
  if (entry.general && general) return { text: general, source: { kind: entry.general } };
  const fallback = DEFAULT_MAIL_TEMPLATES[entry.group][language] ?? DEFAULT_MAIL_TEMPLATES[entry.group].de!;
  return { text: fallback[field], source: "standard" };
}

/** Art der Vorlage für eine Rechnung */
export function invoiceTemplateKind(invoice: { kind: "rechnung" | "storno" | "korrektur"; variant?: "abschlag" | "schluss" | null }): MailTemplateKind {
  if (invoice.kind !== "rechnung") return invoice.kind;
  return invoice.variant ?? "rechnung";
}
