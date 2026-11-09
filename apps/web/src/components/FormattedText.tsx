import { Fragment, type ReactNode } from "react";
import { type FormattedTextRun, parseTextFormatting } from "@haben/core";

/** Bereits zerlegter Text, etwa aus der Fußzeile, wo die Platzhalter erst danach eingesetzt sind; alles wird nur als Text gerendert */
export function FormattedRuns({ runs }: { runs: readonly FormattedTextRun[] }) {
  return (
    <span className="formatted-text">
      {runs.map((run, index) => {
        let content: ReactNode = run.text;
        if (run.underline) content = <u>{content}</u>;
        if (run.italic) content = <em>{content}</em>;
        if (run.bold) content = <strong>{content}</strong>;
        return <Fragment key={index}>{content}</Fragment>;
      })}
    </span>
  );
}

/** Derselbe Parser wie im PDF; Nutzereingaben werden ausschließlich als Text gerendert. */
export function FormattedText({ text }: { text: string }) {
  return <FormattedRuns runs={parseTextFormatting(text)} />;
}
