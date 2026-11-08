import type { Notice } from "../lib/use-action.ts";
import { useRevealWhen } from "../lib/use-page-head.ts";

/** Ergebnis einer Aktion; Fehler als Alarm, alles andere als Status */
export function NoticeBanner({ notice }: { notice: Notice }) {
  const ref = useRevealWhen<HTMLDivElement>(notice);
  if (!notice) return null;
  return (
    <div ref={ref} className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"} style={{ overflowWrap: "anywhere" }}>
      {notice.text}
    </div>
  );
}
