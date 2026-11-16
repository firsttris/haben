import { formatDayMonth } from "../lib/format.ts";
import { Status } from "./Status.tsx";

type Zustand = { status: "neu" | "gebucht"; extractionStatus: "keine" | "laeuft" | "fertig" | "fehler"; cancelled?: boolean };

/** Das Wort des Status; die Belegliste sortiert nach demselben Text, den die Zelle zeigt */
export function documentStatusText({ status, extractionStatus, cancelled = false }: Zustand): string {
  if (status === "gebucht") return cancelled ? "Storniert" : "Gebucht";
  if (extractionStatus === "laeuft") return "Wird ausgelesen";
  return extractionStatus === "fehler" ? "Prüfen" : "Zu prüfen";
}

export function DocumentStatus({
  status,
  extractionStatus,
  cancelled = false,
  cancelledOn,
  lockedAt,
  uploadedAt,
}: {
  status: "neu" | "gebucht";
  extractionStatus: "keine" | "laeuft" | "fertig" | "fehler";
  /** Gebucht und per Gegenbuchung storniert (#237) */
  cancelled?: boolean;
  /** Für die Auskunft unter dem Status, soweit bekannt */
  cancelledOn?: string | null;
  lockedAt?: string | Date | null;
  uploadedAt?: string | Date | null;
}) {
  const text = documentStatusText({ status, extractionStatus, cancelled });
  if (status === "gebucht" && cancelled)
    return (
      <Status tone="danger" detail={cancelledOn ? `am ${formatDayMonth(cancelledOn)}` : null}>
        {text}
      </Status>
    );
  if (status === "gebucht")
    return (
      <Status tone="ok" detail={lockedAt ? `am ${formatDayMonth(lockedAt)}` : null}>
        {text}
      </Status>
    );
  if (extractionStatus === "laeuft") return <Status tone="info">{text}</Status>;
  // Ohne Auslesung bleibt der Beleg liegen, bis jemand die Angaben von Hand einträgt
  if (extractionStatus === "fehler")
    return (
      <Status tone="warn" emphasis="urgent" detail="Auslesen fehlgeschlagen">
        {text}
      </Status>
    );
  // Der Eingang wartet auf dich, wie „3 zu prüfen“ im Seitenkopf
  return (
    <Status tone="warn" emphasis="notice" detail={uploadedAt ? `hochgeladen ${formatDayMonth(uploadedAt)}` : null}>
      {text}
    </Status>
  );
}

export const SOURCE_LABEL = { zugferd: "ZUGFeRD", xrechnung: "XRechnung", ki: "KI", manuell: "Hand" } as const;
