import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { strFromU8, unzipSync } from "fflate";
import { useState } from "react";
import { istEinstellungenJson } from "../lib/einstellungsdatei.ts";
import { formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { importSettingsFile } from "../server/functions/export.ts";
import { ConfirmDialog, type ConfirmFact } from "./ConfirmDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { UploadButton } from "./UploadButton.tsx";

const anzahl = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`;

/** Größere Dateien liest die Seite für die Rückfrage nicht selbst; prüfen tut ohnehin der Server */
const FAKTEN_BIS = 20 * 1024 * 1024;

/** Angaben aus der Datei für die Rückfrage, so weit sie sich lesen lassen */
async function fakten(file: File): Promise<ConfirmFact[]> {
  const facts: ConfirmFact[] = [{ label: "Datei", value: file.name }];
  if (file.size > FAKTEN_BIS) return facts;
  try {
    // Nur die JSON und nur bis zur Grenze entpacken; fflate legt den Puffer in der angegebenen Größe an
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => istEinstellungenJson(f.name) && f.originalSize <= FAKTEN_BIS });
    const [json] = Object.values(zip);
    if (!json) return facts;
    const inhalt = JSON.parse(strFromU8(json)) as { company?: { name?: unknown }; exportedAt?: unknown; appVersion?: unknown; contacts?: unknown };
    if (typeof inhalt.company?.name === "string" && inhalt.company.name) facts.push({ label: "Firma", value: inhalt.company.name, strong: true });
    if (typeof inhalt.exportedAt === "string") facts.push({ label: "Exportiert", value: formatDateTime(inhalt.exportedAt) });
    // Beide Instanzen sollten dieselbe Version haben (docs/einrichtung-echtbetrieb.md); so fällt ein Unterschied vor dem Übernehmen auf
    if (typeof inhalt.appVersion === "string") facts.push({ label: "Mit Haben", value: inhalt.appVersion });
    if (Array.isArray(inhalt.contacts)) facts.push({ label: "Kontakte", value: String(inhalt.contacts.length) });
  } catch {
    // Kein ZIP mit lesbarer JSON: Der Server meldet das mit Grund
  }
  return facts;
}

/**
 * Einstellungsdatei einer anderen Instanz übernehmen (#488, Einstellungen › Export). Nur solange die Instanz neu ist;
 * danach bleibt die Karte stehen, bis die Meldung gelesen ist.
 */
export function SettingsImportCard({ neueInstanz }: { neueInstanz: boolean }) {
  const router = useRouter();
  const importFile = useServerFn(importSettingsFile);
  const { busy, notice, setNotice, run } = useAction();
  const [gewaehlt, setGewaehlt] = useState<{ file: File; facts: ConfirmFact[] } | null>(null);

  if (!neueInstanz && !notice) return null;

  async function waehlen([file]: File[]) {
    if (file) setGewaehlt({ file, facts: await fakten(file) });
  }

  async function uebernehmen(file: File) {
    const form = new FormData();
    form.append("datei", file);
    await run(async () => {
      const result = await importFile({ data: form });
      const mail = result.mail === false ? " Absender und Vorlagen der E-Mails fehlen noch: Richte den Versand ein und trage sie dort ein." : "";
      const was = [
        anzahl(result.contacts, "Kontakt", "Kontakte"),
        anzahl(result.articles, "Artikel", "Artikel"),
        anzahl(result.textBlocks, "Textbaustein", "Textbausteine"),
        anzahl(result.layouts, "eigenes Layout", "eigene Layouts"),
      ];
      // Vor dem Neuladen: Danach ist die Instanz nicht mehr neu, und die Karte bleibt nur für die Meldung stehen
      setNotice({ tone: "ok", text: `Einstellungen übernommen, dazu ${was.join(", ")}.${mail}` });
      await router.invalidate();
    });
  }

  return (
    <section className="card" aria-labelledby="settings-import-heading">
      <h2 id="settings-import-heading">Einstellungen übernehmen</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Die Datei aus „Einstellungen exportieren“ einer anderen Instanz, etwa der Testinstanz. Das geht nur, solange hier noch keine Kontakte, Artikel oder
        anderen Stammdaten und keine Belege, Rechnungen oder Buchungen angelegt sind. Firmendaten und Beleggestaltung dieser Instanz werden dabei ersetzt.
        Absender, Vorlagen und Erinnerungen der E-Mails kommen nur mit, wenn der Versand hier schon eingerichtet ist.
      </p>
      <NoticeBanner notice={notice} />
      {neueInstanz && (
        <div className="actions">
          <UploadButton accept="application/zip,.zip" inputLabel="Einstellungsdatei" disabled={busy} onFiles={waehlen}>
            Datei übernehmen …
          </UploadButton>
        </div>
      )}
      <ConfirmDialog
        open={gewaehlt !== null}
        title="Einstellungen übernehmen?"
        confirmLabel="Übernehmen"
        facts={gewaehlt?.facts}
        onClose={() => setGewaehlt(null)}
        onConfirm={() => {
          if (gewaehlt) void uebernehmen(gewaehlt.file);
        }}
      >
        <p>
          Firmendaten, persönliche Angaben und Beleggestaltung dieser Instanz werden durch die aus der Datei ersetzt, Kontakte, Artikel und die übrigen
          Stammdaten kommen dazu.
        </p>
        <p>Zugangsdaten wie Bank, ELSTER-Zertifikat und E-Mail-Versand richtest du hier selbst ein.</p>
      </ConfirmDialog>
    </section>
  );
}
