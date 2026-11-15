import { formatEuro, parseEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { formatDate } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { useSubmitCheck } from "../../lib/use-submit-check.ts";
import { fileVatReturnElsewhere } from "../../server/functions/vat.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { NoticeBanner } from "../NoticeBanner.tsx";
import { Field } from "../Field.tsx";
import { FilePicker } from "../FilePicker.tsx";

/**
 * Abgabe außerhalb von Haben vermerken (XML-Import in Mein ELSTER, Erweiterung, KI-Assistent): Tag, Transferticket,
 * Kz 83 und Protokoll aus Mein ELSTER. Danach ist die Anmeldung festgeschrieben wie nach einer Übermittlung über ERiC.
 */
export function AbgabeVermerken({
  returnId,
  kz83,
  blocked,
  today,
  onFiled,
}: {
  returnId: string;
  kz83: number;
  blocked: boolean;
  today: string;
  onFiled: () => void;
}) {
  const router = useRouter();
  const vermerken = useServerFn(fileVatReturnElsewhere);
  const action = useAction();
  const headingId = useId();
  const [filedOn, setFiledOn] = useState(today);
  const [ticket, setTicket] = useState("");
  // Bewusst leer: abgetippt aus dem Protokoll, damit eine Abweichung auffällt
  const [zahllast, setZahllast] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const parsed = parseEuro(zahllast);
  const ready = !blocked && filedOn !== "" && ticket.trim() !== "" && zahllast.trim() !== "" && parsed !== null && file !== null;
  const { form, error, check } = useSubmitCheck({
    filedOn: filedOn === "" ? "Wähle den Tag der Abgabe." : filedOn > today ? `Wähle einen Tag bis ${formatDate(today)}.` : null,
    ticket: ticket.trim() === "" ? "Trag das Transferticket aus dem Übermittlungsprotokoll ein." : null,
    zahllast: parsed === null || zahllast.trim() === "" ? "Trag Kz 83 laut Protokoll ein, etwa 1.234,56." : null,
    file: file ? null : "Wähle das Übermittlungsprotokoll.",
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (check() && ready) setConfirming(true);
  };

  const abgabeVermerken = () => {
    if (!ready || !file) return;
    void action.run(async () => {
      const form = new FormData();
      form.append("id", returnId);
      form.append("filedOn", filedOn);
      form.append("transferTicket", ticket.trim());
      form.append("kz83", String(parsed));
      form.append("protokoll", file);
      const result = await vermerken({ data: form });
      if (!result.ok) throw new Error(result.message);
      onFiled();
      await router.invalidate();
    });
  };

  return (
    <form ref={form} className="card" aria-labelledby={headingId} onSubmit={onSubmit} noValidate>
      <h2 id={headingId}>Außerhalb von Haben abgegeben</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Hast du die Voranmeldung in Mein ELSTER abgegeben (XML-Import, Erweiterung oder KI-Assistent), trägst du hier die Angaben aus dem Übermittlungsprotokoll
        ein. Haben schreibt die Anmeldung dann fest wie nach einer Übermittlung über ERiC; die Frist ist erledigt, und die Zahllast erscheint im Bankabgleich.
      </p>
      <Field label="Tag der Abgabe" error={error("filedOn")}>
        {(control) => <input {...control} type="date" value={filedOn} max={today} onChange={(event) => setFiledOn(event.target.value)} required />}
      </Field>
      <Field label="Transferticket" error={error("ticket")}>
        {(control) => <input {...control} value={ticket} onChange={(event) => setTicket(event.target.value)} autoComplete="off" spellCheck={false} required />}
      </Field>
      <Field
        label="Kz 83 laut Protokoll"
        hint={<>Muss der Voranmeldung entsprechen ({formatEuro(kz83)}), sonst lehnt Haben den Vermerk ab.</>}
        error={error("zahllast")}
      >
        {(control) => <input {...control} inputMode="decimal" className="mono" value={zahllast} onChange={(event) => setZahllast(event.target.value)} />}
      </Field>
      <Field label="Übermittlungsprotokoll (PDF)" error={error("file")}>
        {(control) => <FilePicker {...control} accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />}
      </Field>
      {blocked && <p className="small muted">Erst den Entwurf speichern; vermerkt wird die gespeicherte Anmeldung.</p>}
      <div className="actions">
        <button type="submit" className="btn" disabled={action.busy || blocked}>
          Abgabe vermerken
        </button>
      </div>
      <NoticeBanner notice={action.notice} />
      <ConfirmDialog
        open={confirming}
        title="Voranmeldung als abgegeben vermerken?"
        confirmLabel="Abgabe vermerken"
        // Auch bei geschlossenem Dialog ausgewertet; ein leeres Datum darf formatDate nicht erreichen
        facts={
          ready
            ? [
                { label: "Tag der Abgabe", value: formatDate(filedOn) },
                { label: "Transferticket", value: ticket.trim() },
                { label: "Kz 83", value: formatEuro(parsed ?? 0), strong: true },
              ]
            : []
        }
        onConfirm={abgabeVermerken}
        onClose={() => setConfirming(false)}
      >
        <p>Haben schreibt die Voranmeldung fest. Ändern lässt sie sich danach nicht mehr; Korrekturen gehen nur über eine berichtigte Anmeldung.</p>
      </ConfirmDialog>
    </form>
  );
}
