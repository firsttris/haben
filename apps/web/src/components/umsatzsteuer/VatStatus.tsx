import { daysUntil, formatDate, formatDayMonth, relativeDays } from "../../lib/format.ts";
import { Status } from "../Status.tsx";

/** Was der Status einer Voranmeldung braucht: die angezeigte Anmeldung, ein Vermerk der Abgabe und die Frist */
export interface VatStatusFacts {
  current: { status: "draft" | "sent"; sentAt: Date | string | null; berichtigt: boolean } | null;
  /** Tag der außerhalb von Haben vermerkten Abgabe */
  filedOn: string | null;
  dueDate: string;
}

/** Zustand einer Umsatzsteuer-Voranmeldung, auf ihrer Seite und in der Schnellsuche */
export function VatStatus({ current, filedOn, dueDate }: VatStatusFacts) {
  if (!current) return <Status>Noch nicht angelegt</Status>;
  const berichtigt = current.berichtigt ? ", berichtigt" : "";
  if (current.status === "sent") {
    return filedOn ? (
      <Status tone="ok" detail={`${formatDate(filedOn)} (vermerkt)${berichtigt}`}>
        Abgegeben
      </Status>
    ) : (
      <Status tone="ok" detail={`${formatDate(current.sentAt!)}${berichtigt}`}>
        Gesendet
      </Status>
    );
  }
  // Noch nicht gesendet: ab 7 Tagen vor der Frist dringend, wie auf der Seite Fristen
  const days = daysUntil(dueDate);
  return (
    <Status
      draft
      tone={days <= 7 ? "warn" : "neutral"}
      emphasis={days <= 7 ? "urgent" : undefined}
      detail={`fällig ${days < 0 ? relativeDays(days) : formatDayMonth(dueDate)}${berichtigt}`}
    >
      Entwurf
    </Status>
  );
}
