import { formatEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { errorMessage, formatDate } from "../../lib/format.ts";
import { decideLegacyAccountingType } from "../../server/functions/archive.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";

type Kind = "erloes" | "aufwand";

const LABEL: Record<Kind, string> = { erloes: "Erlöskonto", aufwand: "Aufwandskonto" };

const EFFECT: Record<Kind, string> = {
  erloes: "Haben führt die Gutschrift dann als Minderung der Einnahmen, mit der Umsatzsteuer in Kz 81.",
  aufwand: "Haben führt die Gutschrift dann als Ausgabe-Gutschrift, mit der Vorsteuer in Kz 66.",
};

type Props = {
  voucher: {
    id: string;
    number: string;
    date: string;
    gross: number;
    accountingType: { stamm: Kind | "unklar" | null; hand: Kind | null } | null;
    accountingTypeIssue: string | null;
    accountingTypeDecidable: boolean;
  };
};

/** Kontoart einer sevDesk-Gutschrift auf ein Buchungskonto: Herkunft zeigen und, solange der Kontostamm sie nicht klärt, von Hand festlegen (#888) */
export function AccountingTypeDecision({ voucher }: Props) {
  const router = useRouter();
  const [asked, setAsked] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const status = useRef<HTMLParagraphElement>(null);
  // Der Auslöser verschwindet mit der Entscheidung; der Fokus geht auf die Meldung statt an den Anfang der Seite. Erst nach dem
  // Rendern: Vorher ist die Meldung noch verborgen und nimmt keinen Fokus an.
  useEffect(() => {
    if (done) status.current?.focus();
  }, [done]);
  const kinds = voucher.accountingType;
  if (!kinds) return null;
  const { stamm, hand } = kinds;
  // Ohne Hinweis gilt eine Art: die des Kontostamms, wenn er sie nennt, sonst die von Hand
  const current = voucher.accountingTypeIssue ? null : stamm === "erloes" || stamm === "aufwand" ? stamm : hand;
  const choices: Kind[] = !voucher.accountingTypeDecidable ? [] : current ? (current === "erloes" ? ["aufwand"] : ["erloes"]) : ["erloes", "aufwand"];

  async function decide(kind: Kind) {
    setBusy(true);
    setError("");
    setDone("");
    try {
      await decideLegacyAccountingType({ data: { id: voucher.id, kind } });
      await router.invalidate();
      setDone(`Als ${LABEL[kind]} festgelegt.`);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {voucher.accountingTypeIssue && (
        <p className="banner banner-info" role="status">
          {voucher.accountingTypeIssue}
        </p>
      )}
      {current && (
        <dl className="facts">
          <dt>Buchungskonto</dt>
          <dd>
            {LABEL[current]}, {current === hand && !(stamm === "erloes" || stamm === "aufwand") ? "von Hand festgelegt" : "aus dem Kontostamm von sevDesk"}
          </dd>
        </dl>
      )}
      {choices.length > 0 && (
        <div className="actions">
          {choices.map((kind) => (
            <button key={kind} type="button" className="btn btn-sm" disabled={busy} onClick={() => setAsked(kind)}>
              {current ? `Stattdessen als ${LABEL[kind]} festlegen` : `Als ${LABEL[kind]} festlegen`}
            </button>
          ))}
        </div>
      )}
      <p ref={status} className="small muted" role="status" tabIndex={-1} style={{ margin: 0 }} hidden={!done}>
        {done}
      </p>
      {error && (
        <p role="alert" className="banner banner-danger">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={asked !== null}
        title={`Kontoart von ${voucher.number || "Gutschrift"} festlegen?`}
        confirmLabel={asked ? `Als ${LABEL[asked]} festlegen` : ""}
        onClose={() => setAsked(null)}
        onConfirm={() => asked && decide(asked)}
        facts={[
          { label: "Gutschrift", value: voucher.number || "–" },
          { label: "Datum", value: formatDate(voucher.date) },
          { label: "Betrag", value: formatEuro(Math.abs(voucher.gross)), strong: true },
          { label: "Kontoart", value: asked ? LABEL[asked] : "" },
        ]}
      >
        <p>{asked && EFFECT[asked]}</p>
        <p>
          Die Archivkopie bleibt unverändert; die Entscheidung steht als Nachtrag im Audit-Log. Ruft Haben später den Kontostamm aus sevDesk ab, geht dieser
          vor.
        </p>
      </ConfirmDialog>
    </>
  );
}
