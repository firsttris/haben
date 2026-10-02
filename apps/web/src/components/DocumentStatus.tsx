export function DocumentStatus({
  status,
  extractionStatus,
}: {
  status: "neu" | "gebucht";
  extractionStatus: "keine" | "laeuft" | "fertig" | "fehler";
}) {
  if (status === "gebucht") return <span className="pill pill-ok">Gebucht</span>;
  if (extractionStatus === "laeuft") return <span className="pill pill-info">Wird ausgelesen</span>;
  if (extractionStatus === "fehler") return <span className="pill pill-warn">Prüfen</span>;
  return <span className="pill">Zu prüfen</span>;
}

export const SOURCE_LABEL = { zugferd: "ZUGFeRD", xrechnung: "XRechnung", ki: "KI", manuell: "Hand" } as const;
