import { formatEuro } from "@haben/core";
import { formatDate } from "../../lib/format.ts";
import type { ZahlungMitKorrektur } from "@haben/core";
import { type Detail, korrekturText, type Posten, type RestArt } from "./-bank-daten.ts";

const REST_LABEL = { skonto: "als Skonto", forderungsausfall: "als Forderungsausfall", skontoErhalten: "als erhaltenes Skonto" } as const;

/**
 * Knöpfe, die den Rest einer Zuordnung ausbuchen: als Gebühr, als Kursdifferenz, als Skonto oder Forderungsausfall, und
 * die Sammelzuordnung aller Gebühren eines Monats zum Sammelbeleg des Dienstleisters. Gleicht eine offene Korrektur der
 * Rechnung den Rest aus, steht statt der Ausbuchung die Aufteilung auf Rechnung und Korrektur (#1398); bleibt danach
 * genau ein Skonto auf den geminderten Betrag, bucht ein Knopf Aufteilung und Skonto zusammen.
 *
 * Den Sammelknopf gibt es bei jedem gewählten Beleg und beim besten Vorschlag, wenn dieser der Sammelbeleg des Monats ist
 * (siehe sammelrechnungVorschlag): der Klick ordnet alle offenen Gebührenzeilen des Monats zu, die Gutschriften nur,
 * wenn alles zusammen genau den Beleg ergibt (allocateFeesToDocument).
 */
export function RestAktionen({
  target,
  tx,
  sammelrechnung,
  mitSammel,
  angebot: { feeRest, rest, restKinds, exchangeDifference, korrektur },
  busy,
  onFeeRest,
  onSammel,
  onRest,
  onKorrektur,
  onKorrekturSkonto,
}: {
  target: Posten | undefined;
  tx: Detail["transaction"];
  sammelrechnung: Detail["sammelrechnung"];
  mitSammel: boolean;
  angebot: { feeRest: number; rest: number; restKinds: RestArt[]; exchangeDifference: number; korrektur: ZahlungMitKorrektur | undefined };
  busy: boolean;
  onFeeRest: () => void;
  onSammel: (documentId: string) => void;
  onRest: (kind: RestArt | "kursdifferenz") => void;
  onKorrektur: () => void;
  /** Bucht Aufteilung und Skonto; fehlt er, bucht das schon der Hauptknopf (bester Treffer) */
  onKorrekturSkonto: (() => void) | undefined;
}) {
  return (
    <>
      {korrektur && korrektur.skonto === 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={onKorrektur} disabled={busy}>
            Mit {korrekturText(korrektur.corrections)} aufteilen
          </button>
          <span className="small muted">
            Der Rest von {formatEuro(rest)} entspricht {korrektur.corrections.length === 1 ? "der offenen" : "den offenen"}{" "}
            {korrekturText(korrektur.corrections)}: Der Kunde hat die Rechnung abzüglich der Korrektur gezahlt. Die Aufteilung ordnet die Zahlung allen zu,
            Rechnung und Korrektur sind danach bezahlt.
          </span>
        </div>
      )}
      {korrektur && korrektur.skonto !== 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {onKorrekturSkonto && (
            <button type="button" className="btn" onClick={onKorrekturSkonto} disabled={busy}>
              Mit {korrekturText(korrektur.corrections)} zuordnen, Rest {formatEuro(korrektur.skonto)} als Skonto
            </button>
          )}
          <span className="small muted">
            Der Kunde hat die {korrekturText(korrektur.corrections)} abgezogen und vom geminderten Betrag Skonto: Die Aufteilung ordnet die Zahlung Rechnung und
            Korrektur zu, nur die {formatEuro(korrektur.skonto)} werden als Skonto ausgebucht.
          </span>
        </div>
      )}
      {feeRest !== 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={onFeeRest} disabled={busy}>
            Voll zuordnen, Rest {formatEuro(Math.abs(feeRest))} als Gebühr
          </button>
          <span className="small muted">
            Für Auszahlungen von PayPal, Stripe oder Shopify: Die Rechnung gilt als voll bezahlt, die einbehaltene Gebühr wird Aufwand (Nebenkosten des
            Geldverkehrs).
          </span>
        </div>
      )}
      {target?.type === "document" && tx.amount < 0 && tx.purpose.startsWith("Gebühr") && mitSammel && (
        <div className="stack" style={{ gap: 8 }}>
          <button type="button" className="btn" disabled={busy} onClick={() => onSammel(target.id)}>
            Alle offenen Gebühren aus {formatDate(tx.bookingDate).slice(3)} diesem Beleg zuordnen
          </button>
          <span className="small muted">Für die monatliche Sammelrechnung des Dienstleisters: Vorsteuer bzw. § 13b laufen einmal über den Beleg.</span>
          {sammelrechnung && target.id !== sammelrechnung.documentId && (
            <span className="small muted">
              Die offenen Gebühren und Gutschriften von {formatDate(tx.bookingDate).slice(3)} ergeben {formatEuro(Math.abs(sammelrechnung.summe))}, der Beleg
              steht mit {formatEuro(Math.abs(target.open))} offen.
            </span>
          )}
        </div>
      )}
      {exchangeDifference !== 0 && target && (
        <div className="stack" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={() => onRest("kursdifferenz")} disabled={busy}>
            Ausgleichen, {formatEuro(Math.abs(exchangeDifference))} als Kursdifferenz
          </button>
          <span className="small muted">
            {target.type === "invoice" ? "Rechnung" : "Beleg"} in {target.currency}: Die Zahlung weicht vom umgerechneten Betrag ab. Die Abweichung wird{" "}
            {exchangeDifference > 0 ? "Ertrag" : "Aufwand"} aus Kursdifferenzen, die Umsatzsteuer bleibt beim Kurs{" "}
            {target.type === "invoice" ? "der Rechnung" : "des Belegs"}.
          </span>
        </div>
      )}
      {restKinds.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="actions">
            {restKinds.map((k) => (
              <button key={k} type="button" className="btn" onClick={() => onRest(k)} disabled={busy}>
                Rest {formatEuro(Math.abs(rest))} {REST_LABEL[k]}
              </button>
            ))}
          </div>
          <span className="small muted">
            {restKinds.includes("skontoErhalten")
              ? "Du hast Skonto abgezogen: Der Beleg ist erledigt, die Vorsteuer wird anteilig gemindert."
              : "Der Kunde hat weniger gezahlt: Skonto oder Forderungsausfall mindern Erlöse und Umsatzsteuer anteilig (§ 17 UStG); die Rechnung ist erledigt."}
          </span>
        </div>
      )}
    </>
  );
}
