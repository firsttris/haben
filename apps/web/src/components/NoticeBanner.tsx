import type { Notice } from "../lib/use-action.ts";

/** Ergebnis einer Aktion; Fehler als Alarm, alles andere als Status */
export function NoticeBanner({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"} style={{ overflowWrap: "anywhere" }}>
      {notice.text}
    </div>
  );
}
