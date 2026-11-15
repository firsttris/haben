import type { ReactNode } from "react";

/** Farbe des Punkts und, ab „notice“, des Worts. Bedeutung siehe DESIGN.md, Abschnitt Status */
export type StatusTone = "neutral" | "ok" | "info" | "warn" | "danger";

/**
 * Wie laut der Status ist:
 * - ohne Angabe: ruhig, nur der Punkt trägt die Farbe (der Normalfall, auch Erledigtes und Storniertes)
 * - "notice": etwas ist zu tun, aber ohne Frist; das Wort steht in der Farbe
 * - "urgent": Frist überschritten oder in höchstens 7 Tagen, Geld steht aus, etwas ist fehlgeschlagen; mit Fläche
 */
export type StatusEmphasis = "notice" | "urgent";

export interface StatusProps {
  tone?: StatusTone;
  emphasis?: StatusEmphasis;
  /** Leerer Ring statt Punkt: noch nicht festgeschrieben (Entwurf) */
  draft?: boolean;
  /** Was der Status gerade heißt, etwa „fällig 23.11.“ oder „seit 40 Tagen“; im Seitenkopf in derselben Zeile */
  detail?: ReactNode;
  /** Auskunft in derselben Zeile statt darunter, für Fließtext und Kopfzeilen von Karten; im Seitenkopf von selbst */
  inline?: boolean;
  children: ReactNode;
}

/** Aussehen eines Status in einer Tabelle Zustand → Aussehen, etwa LOOK in InvoiceStatus */
export type StatusLook = { text: string } & Pick<StatusProps, "tone" | "emphasis" | "draft">;

/** Zustand eines Objekts: Punkt, Wort und eine Auskunft darunter */
export function Status({ tone = "neutral", emphasis, draft = false, detail, inline = false, children }: StatusProps) {
  const className = ["status", `status-${tone}`, emphasis && `status-${emphasis}`, draft && "status-draft", inline && "status-inline"]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={className}>
      <span className="status-label">{children}</span>
      {detail != null && detail !== "" && (
        <>
          {/* Leerzeichen für Screenreader und Kopieren; im Flex-Container unsichtbar */} <span className="status-detail">{detail}</span>
        </>
      )}
    </span>
  );
}

/** Eigenschaft ohne Zustand, etwa „Lieferant“, eine Rolle oder „archiviert“: leise, ohne Punkt */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

/** Ergebnis eines Vorgangs im Protokoll (ELSTER, E-Mail): Erfolg ruhig, Fehler dringend */
export function OutcomeStatus({ ok, children }: { ok: boolean; children: ReactNode }) {
  return ok ? (
    <Status tone="ok" inline>
      {children}
    </Status>
  ) : (
    <Status tone="danger" emphasis="urgent" inline>
      {children}
    </Status>
  );
}
