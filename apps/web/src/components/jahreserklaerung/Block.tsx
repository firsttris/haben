import type { ReactNode } from "react";

/** Zuklappbarer Teil einer Jahreserklärung; im Titel steht, was darin liegt oder gespeichert ist */
export function Block({ title, summary, open, children }: { title: string; summary: string; open: boolean; children: ReactNode }) {
  return (
    <details className="est-block" open={open}>
      <summary>
        <span className="est-block-title">{title}</span>
        <span className="small muted">{summary}</span>
      </summary>
      <div className="stack" style={{ gap: 12, paddingTop: 12 }}>
        {children}
      </div>
    </details>
  );
}
