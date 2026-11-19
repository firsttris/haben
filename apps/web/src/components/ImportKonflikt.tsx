import { formatEuro } from "@haben/core";
import { isInternalProvider } from "@haben/import/anbieter";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { resolveBankConflict } from "../server/functions/bank.ts";
import { FormDialog } from "./FormDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

/*
 * Konflikt im Abruf klären (#306, 3b): Die Bank oder Etsy liefert einen schon übernommenen Umsatz mit anderem Betrag,
 * Buchungstag oder anderer Art. Bis zur Entscheidung nimmt Haben den Abruf dieses Kontos nicht an. Überschrieben wird nie.
 */

type Umsatz = { bookingDate: string; amount: number; counterpartyName: string | null; purpose: string | null };

export interface ImportKonfliktDaten {
  id: string;
  bankAccountId: string;
  sourceEventId: string;
  previous: Umsatz & { id: string; open: number };
  delivered: Umsatz & { currency: string };
}

const betrag = (cents: number) => `${cents > 0 ? "+" : "−"}${formatEuro(Math.abs(cents))}`;

function Spalte({ titel, umsatz, zuordnung }: { titel: string; umsatz: Umsatz; zuordnung?: string }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="section-label">{titel}</div>
      <div>{formatDate(umsatz.bookingDate)}</div>
      <div className="amount" style={{ fontWeight: 600 }}>
        {betrag(umsatz.amount)}
      </div>
      <div>{umsatz.counterpartyName || "–"}</div>
      <div className="small muted" style={{ overflowWrap: "anywhere" }}>
        {umsatz.purpose || "–"}
      </div>
      {zuordnung && <div className="small">{zuordnung}</div>}
    </div>
  );
}

/** Wer liefert: der Bankabruf (Bank › Automatischer Abruf), der Etsy-Abruf (Einstellungen › Bank) oder ein Dienst über den REST-Import */
const QUELLEN = {
  bank: { wer: "Die Bank", von: "von der Bank", angaben: "der Bank", abruf: "aus dem Abruf dieses Kontos" },
  etsy: { wer: "Etsy", von: "von Etsy", angaben: "von Etsy", abruf: "aus dem Etsy-Abruf" },
  extern: { wer: "Der Dienst", von: "vom Dienst", angaben: "des Dienstes", abruf: "aus dieser Quelle" },
} as const;

/** Texte zum Anbieter einer Quelle (`import_sources.provider`) */
export const quelleZuAnbieter = (provider: string): keyof typeof QUELLEN => (provider === "etsy" ? "etsy" : isInternalProvider(provider) ? "bank" : "extern");

const ENTSCHEIDUNGEN = [
  {
    value: "keep",
    label: "Bisherigen Umsatz behalten",
    hint: (angaben: string) => `Die Angaben ${angaben} gelten künftig als bekannt; ein neuer Umsatz entsteht nicht.`,
  },
  {
    value: "add",
    label: "Als weiteren Umsatz übernehmen",
    hint: () =>
      "Haben legt den gelieferten Umsatz zusätzlich an. Der bisherige bleibt mit seinen Zuordnungen stehen; beide bekommen einen Hinweis aufeinander.",
  },
] as const;

/** Knopf und Dialog für die offenen Konflikte einer Verbindung; nacheinander, ältester zuerst */
export function KonfliktKlaeren({
  konflikte,
  disabled,
  quelle = "bank",
  onGeklaert,
}: {
  konflikte: ImportKonfliktDaten[];
  disabled: boolean;
  quelle?: keyof typeof QUELLEN;
  /** Der letzte offene Konflikt ist geklärt; die Etsy-Karte behält dann die Zeile für die Bestätigung */
  onGeklaert?: () => void;
}) {
  const router = useRouter();
  const resolve = useServerFn(resolveBankConflict);
  const { busy, notice, run } = useAction();
  const [open, setOpen] = useState(false);
  const [entscheidung, setEntscheidung] = useState<"keep" | "add">("keep");
  const [geklaert, setGeklaert] = useState(false);
  const konflikt = konflikte[0];
  // Die Meldung an der Verbindung stammt vom letzten Abruf und bleibt bis zum nächsten stehen
  if (!konflikt && !open)
    return geklaert ? (
      <span role="status" className="small muted" style={{ alignSelf: "center" }}>
        Geklärt; der nächste Abruf übernimmt das Konto wieder.
      </span>
    ) : null;

  async function absenden(event: FormEvent) {
    event.preventDefault();
    if (!konflikt) return;
    const ok = await run(async () => {
      await resolve({ data: { conflictId: konflikt.id, decision: entscheidung } });
      await router.invalidate();
    });
    if (ok && konflikte.length <= 1) {
      setOpen(false);
      setGeklaert(true);
      onGeklaert?.();
    }
    if (ok) setEntscheidung("keep");
  }

  const { wer, von, angaben, abruf } = QUELLEN[quelle];
  const zuordnung = konflikt
    ? konflikt.previous.open === 0
      ? "Ganz zugeordnet"
      : konflikt.previous.open === konflikt.previous.amount
        ? "Noch nicht zugeordnet"
        : `Noch offen: ${formatEuro(Math.abs(konflikt.previous.open))}`
    : undefined;

  return (
    <>
      <button type="button" className="btn" disabled={disabled || busy || !konflikt} onClick={() => setOpen(true)}>
        {konflikte.length > 1 ? `Konflikte klären (${konflikte.length})` : "Konflikt klären"}
      </button>
      <FormDialog
        open={open && konflikt !== undefined}
        title={konflikte.length > 1 ? `Konflikt klären (1 von ${konflikte.length})` : "Konflikt klären"}
        onClose={() => !busy && setOpen(false)}
      >
        {konflikt && (
          <form onSubmit={(event) => void absenden(event)}>
            <p style={{ margin: 0 }}>
              {wer} liefert diesen Umsatz ({konflikt.sourceEventId}) jetzt anders als beim ersten Abruf. Bis du entscheidest, übernimmt Haben {abruf} nichts.
              Die Entscheidung lässt sich nicht zurücknehmen.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <Spalte titel="Bisher in Haben" umsatz={konflikt.previous} {...(zuordnung ? { zuordnung } : {})} />
              <Spalte titel={`Jetzt ${von}`} umsatz={konflikt.delivered} />
            </div>
            <fieldset className="choice-group">
              <legend>Was soll Haben tun?</legend>
              {ENTSCHEIDUNGEN.map((e) => (
                <div key={e.value} className="checkbox-hinted">
                  <label className="checkbox">
                    <input
                      type="radio"
                      name="entscheidung"
                      value={e.value}
                      checked={entscheidung === e.value}
                      onChange={() => setEntscheidung(e.value)}
                      aria-describedby={`konflikt-${e.value}-hint`}
                    />
                    <span>{e.label}</span>
                  </label>
                  <span id={`konflikt-${e.value}-hint`} className="field-hint">
                    {e.hint(angaben)}
                  </span>
                </div>
              ))}
            </fieldset>
            <NoticeBanner notice={notice} />
            <div className="actions">
              <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
                Abbrechen
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Kläre …" : "Klären"}
              </button>
            </div>
          </form>
        )}
      </FormDialog>
    </>
  );
}

/** Stichtag eines Kontos (#306), hinter dem Konto am Abruf: ab dann kommen seine Umsätze aus dem Bankabruf */
export function stichtagText(stichtage: { bankAccountId: string; cutoverDate: string; filesBefore: boolean }[], bankAccountId: string): string {
  const s = stichtage.find((x) => x.bankAccountId === bankAccountId);
  return s ? ` (Bankabruf seit ${formatDate(s.cutoverDate)}${s.filesBefore ? ", davor Dateien oder FinTS" : ""})` : "";
}

type Bezug = { id: string; bookingDate: string; amount: number };

/** Hinweis in der Detailansicht: am bisherigen Umsatz die nach einem Konflikt übernommenen, am übernommenen der bisherige */
export function KlaerungHinweis({ klaerung }: { klaerung: { provider: string; added: Bezug[]; previous: Bezug | null } | null }) {
  if (!klaerung) return null;
  const { wer } = QUELLEN[quelleZuAnbieter(klaerung.provider)];
  const verweis = (u: Bezug) => (
    <Link from="/bank" to="/bank" search={(prev) => ({ ...prev, umsatz: u.id })}>
      {formatDate(u.bookingDate)}, {betrag(u.amount)}
    </Link>
  );
  return (
    <div className="banner banner-info" role="note">
      {klaerung.added.length > 0 && (
        <p style={{ margin: 0 }}>
          {wer} hat diesen Umsatz später anders geliefert. Nach dem Konflikt steht er zusätzlich als eigener Umsatz da:{" "}
          {klaerung.added.map((u, i) => (
            <span key={u.id}>
              {i > 0 && " · "}
              {verweis(u)}
            </span>
          ))}
          .
        </p>
      )}
      {klaerung.previous && (
        <p style={{ margin: 0 }}>Nach einem Konflikt im Abruf als weiterer Umsatz übernommen. Bisheriger Umsatz: {verweis(klaerung.previous)}.</p>
      )}
    </div>
  );
}
