import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { confirmLegacyWithoutFile, type getLegacyVoucher } from "../../server/functions/archive.ts";
import { ConfirmDialog, type ConfirmFact } from "../ConfirmDialog.tsx";
import { Field } from "../Field.tsx";
import { NoticeBanner } from "../NoticeBanner.tsx";
import { Status } from "../Status.tsx";
import { ohneBelegText, type OhneBelegGrund } from "./dateistand-texte.ts";

/*
 * Dateistand eines archivierten Belegs (#345): ohne Datei laut Quelle (offen bis zur Bestätigung), bestätigt ohne Datei,
 * Abruf fehlgeschlagen und fehlender Anhang. Die Zustände kommen aus server/modules/archiv/dateistand.ts.
 */

type FileState = Awaited<ReturnType<typeof getLegacyVoucher>>["fileState"];
type FileStatus = FileState["status"];

const LOOK: Partial<Record<FileStatus, { word: string; tone: "warn" | "danger" | "neutral"; emphasis?: "notice" }>> = {
  ohne_beleg: { word: "Ohne Beleg", tone: "warn", emphasis: "notice" },
  ohne_datei: { word: "Keine", tone: "warn", emphasis: "notice" },
  ohne_datei_offen: { word: "Prüfen", tone: "warn", emphasis: "notice" },
  ohne_datei_bestaetigt: { word: "Keine", tone: "neutral" },
  abruf_fehlgeschlagen: { word: "Fehlt", tone: "danger", emphasis: "notice" },
  anhang_fehlt: { word: "Anhang fehlt", tone: "warn", emphasis: "notice" },
};

/** Spalte „Dateien“ in der Liste: Zahl der Dateien oder der Stand, wenn etwas fehlt */
export function FileStatusCell({ status, files }: { status: FileStatus; files: number }) {
  // „Ohne Beleg“ ist ein Merkmal des Imports und kann auch eine Buchung treffen, an der eine Datei hängt; dann zählt die Zahl
  if (status === "ohne_beleg" && files > 0) return <>{files}</>;
  const look = LOOK[status];
  if (!look) return <>{files}</>;
  return (
    <Status tone={look.tone} emphasis={look.emphasis}>
      {look.word}
    </Status>
  );
}

/**
 * Ersetzt die leere Vorschau: was fehlt und was als Nächstes zu tun ist.
 *
 * `grund` unterscheidet die Fälle hinter `ohne_beleg`: Buchung ohne Beleglink, Buchung mit Beleg-GUID und fehlender Datei
 * im Export, und Buchungen fremder Quellen, die das Merkmal ohne GUID setzen. Nur im ersten Fall lädt der Satz zum
 * Bestätigen ein; dort erscheint auch der Knopf.
 */
export function MissingFileBanner({
  status,
  product,
  grund,
  bestaetigbar = false,
}: {
  status: FileStatus;
  product: string;
  grund?: OhneBelegGrund;
  bestaetigbar?: boolean;
}) {
  switch (status) {
    case "abruf_fehlgeschlagen":
      return (
        <div className="banner banner-danger">
          {product} führt eine Datei zu diesem Beleg, der Abruf ist fehlgeschlagen. „Erneut abrufen“ im Umzug versucht es noch einmal und hängt sie an diesen
          Beleg.
        </div>
      );
    case "ohne_datei_offen":
      return (
        <div className="banner banner-info">
          {product} nennt zu diesem Beleg keine Datei. Das heißt nicht sicher, dass es nie eine gab: Sieh in {product} nach und bestätige es rechts.
        </div>
      );
    case "ohne_datei_bestaetigt":
      return <div className="banner banner-info">In {product} ohne Datei, bestätigt. Ein Rechnungsoriginal für den Vorsteuerabzug ersetzt das nicht.</div>;
    case "ohne_beleg":
      return <div className="banner banner-info">{ohneBelegText(grund ?? "quelle_ohne_beleg", product, bestaetigbar)}</div>;
    default:
      return <div className="banner banner-info">Zu diesem Beleg hat {product} keine Datei geliefert.</div>;
  }
}

/** Karte mit Stand, Verlauf und der Bestätigung „ohne Datei“ */
export function FileStateCard({ voucherId, fileState, product, facts }: { voucherId: string; fileState: FileState; product: string; facts: ConfirmFact[] }) {
  // Ohne Verlauf gibt es nichts zu zeigen, außer es lässt sich etwas bestätigen (Buchung ohne Beleg aus dem Stapel)
  if (fileState.history.length === 0 && !fileState.canConfirmWithoutFile) return null;
  const look = LOOK[fileState.status];
  return (
    <section className="card stack" aria-labelledby="file-state-heading">
      <h2 id="file-state-heading" style={{ margin: 0 }}>
        Dateistand
      </h2>
      <Status tone={look?.tone ?? "ok"} detail={fileState.label}>
        {look ? look.word : "Vollständig"}
      </Status>
      {fileState.history.map((h, i) => (
        <div key={i} className="small">
          <span className="muted">{formatDateTime(h.createdAt)}</span> · {h.message}
          {h.by ? ` (${h.by})` : ""}
        </div>
      ))}
      {fileState.canConfirmWithoutFile && (
        <ConfirmWithoutFile voucherId={voucherId} product={product} facts={facts} ohneBeleg={fileState.status === "ohne_beleg"} />
      )}
    </section>
  );
}

function ConfirmWithoutFile({ voucherId, product, facts, ohneBeleg }: { voucherId: string; product: string; facts: ConfirmFact[]; ohneBeleg: boolean }) {
  const router = useRouter();
  const confirm = useServerFn(confirmLegacyWithoutFile);
  const action = useAction();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setOpen(true);
  };
  const onConfirm = () =>
    action.run(async () => {
      await confirm({ data: { id: voucherId, note } });
      await router.invalidate();
      action.setNotice({ tone: "ok", text: "Als ohne Datei bestätigt. Der Abgleich zählt den Beleg jetzt getrennt." });
    });
  return (
    <>
      <form className="stack" onSubmit={onSubmit} noValidate style={{ gap: 12 }}>
        <Field label="Was du geprüft hast" hint={`Optional, etwa „Kassenbeleg verloren“; steht mit deinem Namen im Verlauf.`}>
          {(control) => <input {...control} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <div className="actions">
          <button type="submit" className="btn" disabled={action.busy}>
            {ohneBeleg ? "Buchung ohne Beleg bestätigen" : `In ${product} ohne Datei bestätigen`}
          </button>
        </div>
      </form>
      <NoticeBanner notice={action.notice} />
      <ConfirmDialog
        open={open}
        title="Beleg ohne Datei bestätigen?"
        confirmLabel="Ohne Datei bestätigen"
        facts={facts}
        onConfirm={() => void onConfirm()}
        onClose={() => setOpen(false)}
      >
        <p>
          {ohneBeleg
            ? "Du bestätigst, dass es zu dieser Buchung keinen Einzelbeleg gibt. Haben hält das mit deinem Namen und der Uhrzeit fest."
            : `Du bestätigst, dass es in ${product} zu diesem Beleg keine Datei gibt. Haben hält das mit deinem Namen und der Uhrzeit fest; der Abgleich zählt den Beleg dann nicht mehr als fehlende Datei.`}
          Für den Vorsteuerabzug braucht es weiter die Rechnung (§ 15 Abs. 1 Nr. 1 UStG).
        </p>
      </ConfirmDialog>
    </>
  );
}

/** Kennzahlen im Fortschritt des sevDesk-Abrufs; nur, was nicht null ist */
export function SevdeskFileFacts({ files }: { files: { ohneDatei: number; abrufFehlgeschlagen: number; anhangFehlt: number; nachgeladen: number } }) {
  const facts = [
    { label: "Abruf fehlgeschlagen", value: files.abrufFehlgeschlagen },
    { label: "ohne Datei, zu prüfen", value: files.ohneDatei },
    { label: "Anhang fehlt", value: files.anhangFehlt },
    { label: "Dateien nachgeladen", value: files.nachgeladen },
  ].filter((f) => f.value > 0);
  return (
    <>
      {facts.map((f) => (
        <div key={f.label}>
          <span className="small muted">{f.label}</span>
          <strong>{f.value}</strong>
        </div>
      ))}
    </>
  );
}
