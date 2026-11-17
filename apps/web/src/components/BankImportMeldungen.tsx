import { useState } from "react";
import { BankCsvZuordnung, type ImportedCsv } from "./BankCsvZuordnung.tsx";

/** Meldung nach einem Import; `zuordnen` ist die Datei einer Bank, die Haben nicht kennt (#1275) */
export type ImportMessage = { tone: "ok" | "danger" | "info"; text: string; zuordnen?: File };

export function importMessages(r: ImportedCsv): ImportMessage[] {
  return [
    { tone: "ok", text: `${r.filename}: ${r.added} neue Umsätze für ${r.accountName}${r.skipped ? `, ${r.skipped} schon vorhanden` : ""}.` },
    ...(r.gap ? [{ tone: "danger" as const, text: r.gap }] : []),
    ...(r.quelle ? [{ tone: "danger" as const, text: r.quelle }] : []),
    ...r.warnings.map((w) => ({ tone: "info" as const, text: `${r.filename}: ${w}` })),
  ];
}

/** Meldungen des Dateiimports im Bankabgleich, bei einer unbekannten Bank mit dem Knopf zur Spaltenzuordnung */
export function ImportMeldungen({
  messages,
  accounts,
  accountId,
  onImported,
}: {
  messages: ImportMessage[];
  accounts: { id: string; name: string }[];
  accountId: string;
  onImported: (result: ImportedCsv) => void;
}) {
  const [zuordnen, setZuordnen] = useState<File | null>(null);
  return (
    <>
      {messages.length > 0 && (
        <ul className="upload-messages" role="status" style={{ maxWidth: 560 }}>
          {messages.map((m, i) => (
            <li key={i} className={`banner banner-${m.tone}`}>
              {m.text}
              {m.zuordnen && (
                <>
                  {" "}
                  <button type="button" className="btn btn-sm" style={{ whiteSpace: "nowrap" }} onClick={() => setZuordnen(m.zuordnen ?? null)}>
                    Spalten zuordnen
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
            onImported(result);
          }}
        />
      )}
    </>
  );
}
