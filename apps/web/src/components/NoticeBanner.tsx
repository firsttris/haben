import type { Ref } from "react";
import type { Notice } from "../lib/use-action.ts";

/** Ergebnis einer Aktion; Fehler als Alarm, alles andere als Status */
export function NoticeBanner({ notice, ref }: { notice: Notice; ref?: Ref<HTMLDivElement> }) {
  if (!notice) return null;
  return (
    <div ref={ref} className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"} style={{ overflowWrap: "anywhere" }}>
      {notice.text}
    </div>
  );
}
