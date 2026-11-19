/** Hinweise im Rechnungseditor (#1253): Klartext zuerst, Paragraf daneben; nur Anzeige, sie ändern nichts an Buchung oder Steuer */

/** Tooltip am Knopf „Festschreiben“; für Tastatur und Handy beschreibt ihn der Banner unten (`FINALIZE_HINT_ID`) mit derselben Folge */
export const FINALIZE_HINT = "Danach nicht mehr änderbar, Haben vergibt die Nummer";

/**
 * Erster Satz der Rückfrage beim Festschreiben einer Rechnung. Sagt nichts über Buchung: Eine Anzahlungsanforderung bucht bei GmbH und UG
 * nichts (`advanceInvoicePosting` in `advance-invoice.ts`), alles andere schon; Nummer, PDF und XML entstehen immer (docs/rechnungen.md,
 * „Was beim Festschreiben passiert“).
 */
export const FINALIZE_DIALOG_TEXT = "Haben vergibt die Nummer und erzeugt PDF und XML.";

/** Entscheidungshilfe zum E-Rechnungsformat, siehe docs/rechnungen.md, „Format wählen“ */
export const FORMAT_HINT =
  "ZUGFeRD passt für die meisten Kunden. XRechnung nur, wenn der Kunde sie verlangt, etwa Behörden mit Leitweg-ID; CII und UBL sind zwei Schreibweisen davon, im Zweifel CII.";

export const FINALIZE_HINT_ID = "invoice-finalize-hint";

export type ServiceHintState = "angebot" | "teilleistung" | "normal" | "rechnung";

/**
 * Welcher Hinweis zu „Leistung von“ und „Leistung bis“ passt: Im Angebot erscheint ohne Angabe keine Zeile (`quote.ts`); bei einer Abschlagsrechnung mit erbrachter
 * Teilleistung ist das Feld Pflicht (`finalizeIssues` in `invoices.ts`); an einer normalen Rechnung (kein Abschlag, EUR, regulär) löst ein eingetragener
 * Tag das Vorauszahlungsverfahren aus, leer nicht (`advanceProcedure` in `advance-procedure.ts`); sonst, auch bei Schlussrechnung, Storno und Korrektur,
 * gilt leer das Rechnungsdatum wie in PDF und XML (`servicePeriod`, `leistungsdatum`). Dauerbelege haben ihr eigenes Formular (`RecurringForm`).
 */
export function serviceHintState(editor: {
  kind: string;
  variant: string | null;
  advanceType: string;
  currency: string;
  taxTreatment: string;
}): ServiceHintState {
  if (editor.kind === "angebot") return "angebot";
  if (editor.kind !== "rechnung") return "rechnung";
  if (editor.variant === "abschlag" && editor.advanceType === "teilleistung") return "teilleistung";
  return editor.variant === null && editor.currency === "EUR" && editor.taxTreatment === "regulaer" ? "normal" : "rechnung";
}

const ZEITRAUM = "Leistungszeitraum, wenn er vom Rechnungsdatum abweicht. Beide leer: gilt das Rechnungsdatum.";
const NORMAL = `Tag oder Zeitraum der Leistung, wenn er vom Rechnungsdatum abweicht. Beide leer: Auf der Rechnung steht das Rechnungsdatum. Wirkung auf die Umsatzsteuer bei Zahlung vor der Leistung:`;
const ANGEBOT = "Geplanter Leistungszeitraum. Leer: steht nicht im Angebot.";

/** Text je Feld und Zustand: Nur bei erbrachter Teilleistung unterscheiden sich die Felder, dort ist allein „Leistung von“ Pflicht */
export const SERVICE_HINT_TEXT: Record<ServiceHintState, { von: string; bis: string }> = {
  angebot: { von: ANGEBOT, bis: ANGEBOT },
  teilleistung: { von: "Tag der erbrachten Teilleistung, Pflicht.", bis: "Nur bei einem Zeitraum: sein letzter Tag, er zählt dann als Leistungstag." },
  normal: { von: NORMAL, bis: NORMAL },
  rechnung: { von: ZEITRAUM, bis: ZEITRAUM },
};

export const ADVANCE_DOCS = "https://haben.app/rechnungen.html#vorauszahlung-auf-normale-rechnungen";

/** Ein gemeinsamer Hinweis für beide Felder, bei erbrachter Teilleistung je Feld einer */
export const serviceHintIds = (state: ServiceHintState) =>
  state === "teilleistung"
    ? { von: "invoice-service-hint-von", bis: "invoice-service-hint-bis" }
    : { von: "invoice-service-hint", bis: "invoice-service-hint" };

/** Hinweis unter „Leistung von“ und „Leistung bis“; die Felder verweisen mit `serviceHintIds` darauf */
export function ServiceHint({ state }: { state: ServiceHintState }) {
  const ids = serviceHintIds(state);
  const text = SERVICE_HINT_TEXT[state];
  return (
    <>
      <span id={ids.von} className="field-hint" style={{ gridColumn: "1 / -1" }}>
        {text.von}
        {state === "normal" && (
          <>
            {" "}
            <a href={ADVANCE_DOCS} target="_blank" rel="noreferrer">
              Vorauszahlung auf normale Rechnungen
            </a>
          </>
        )}
      </span>
      {ids.bis !== ids.von && (
        <span id={ids.bis} className="field-hint" style={{ gridColumn: "1 / -1" }}>
          {text.bis}
        </span>
      )}
    </>
  );
}

export const FOREIGN_CURRENCY_DOCS = "https://haben.app/rechnungen.html#rechnungen-in-fremdwährung";

/** Hinweis bei einer Fremdwährung, drei kurze Sätze; Einzelheiten stehen in der Doku, `id` verbindet ihn mit Währung und Kurs */
export function ForeignCurrencyHint({ currencyCode, rateInfo }: { currencyCode: string; rateInfo: string | null }) {
  return (
    <span id="invoice-currency-hint" className="small" style={{ gridColumn: "1 / -1" }}>
      {rateInfo && <strong>{rateInfo}. </strong>}
      Beträge in {currencyCode || "der Fremdwährung"}, die Umsatzsteuer zusätzlich in Euro. Gebucht wird in Euro; leerer Kurs = Umsatzsteuer-Umrechnungskurs des
      Leistungsmonats, sobald veröffentlicht. Kein GiroCode, keine Abschlags- oder Schlussrechnung, keine Mahnung aus Haben.{" "}
      <a href={FOREIGN_CURRENCY_DOCS} target="_blank" rel="noreferrer">
        Rechnungen in Fremdwährung
      </a>
    </span>
  );
}
