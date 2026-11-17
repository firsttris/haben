import { useState } from "react";
import { BankCsvZuordnung, type ImportedCsv, type ZuordnungKonto } from "./BankCsvZuordnung.tsx";

/**
 * Meldung nach einem Import. `datei` ist eine Datei, deren Spalten sich zuordnen lassen (#1275): eine unbekannte Bank
 * („Spalten zuordnen“) oder eine, die Haben mit der Zuordnung am Konto gelesen hat („Zuordnung ändern“).
 */
export type ImportMessage = { tone: "ok" | "danger" | "info"; text: string; datei?: { file: File; aktion: "Spalten zuordnen" | "Zuordnung ändern" } };

type Importiert = Omit<ImportedCsv, "mitZuordnung" | "zuordnungGespeichert"> & Partial<Pick<ImportedCsv, "mitZuordnung" | "zuordnungGespeichert">>;

export function importMessages(r: Importiert, file?: File): ImportMessage[] {
  const gespeichert = r.zuordnungGespeichert ? ` Spaltenzuordnung für ${r.accountName} gespeichert.` : "";
  return [
    {
      tone: "ok",
      text: `${r.filename}: ${r.added} neue Umsätze für ${r.accountName}${r.skipped ? `, ${r.skipped} schon vorhanden` : ""}.${gespeichert}`,
      datei: r.mitZuordnung && file ? { file, aktion: "Zuordnung ändern" } : undefined,
    },
    ...(r.gap ? [{ tone: "danger" as const, text: r.gap }] : []),
    ...(r.quelle ? [{ tone: "danger" as const, text: r.quelle }] : []),
    ...r.warnings.map((w) => ({ tone: "info" as const, text: `${r.filename}: ${w}` })),
  ];
}

/** Meldungen des Dateiimports im Bankabgleich, mit dem Knopf zur Spaltenzuordnung */
export function ImportMeldungen({
  messages,
  accounts,
  accountId,
  onImported,
}: {
  messages: ImportMessage[];
  accounts: ZuordnungKonto[];
  accountId: string;
  onImported: (result: ImportedCsv, file: File) => void;
}) {
  const [zuordnen, setZuordnen] = useState<File | null>(null);
  return (
    <>
      {messages.length > 0 && (
        <ul className="upload-messages" role="status" style={{ maxWidth: 560 }}>
          {messages.map((m, i) => (
            <li key={i} className={`banner banner-${m.tone}`}>
              {m.text}
              {m.datei && (
                <>
                  {" "}
                  <button type="button" className="btn btn-sm" style={{ whiteSpace: "nowrap" }} onClick={() => setZuordnen(m.datei?.file ?? null)}>
                    {m.datei.aktion}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {zuordnen && (
        <BankCsvZuordnung
          file={zuordnen}
          accounts={accounts}
          accountId={accountId}
          onClose={() => setZuordnen(null)}
          onImported={(result) => {
            setZuordnen(null);
            onImported(result, zuordnen);
          }}
        />
      )}
    </>
  );
}
