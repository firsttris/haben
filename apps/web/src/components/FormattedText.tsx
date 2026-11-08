import { Fragment, type ReactNode } from "react";
import { parseTextFormatting } from "@haben/core";

/** Derselbe Parser wie im PDF; Nutzereingaben werden ausschließlich als Text gerendert. */
export function FormattedText({ text }: { text: string }) {
  return (
    <span className="formatted-text">
      {parseTextFormatting(text).map((run, index) => {
        let content: ReactNode = run.text;
        if (run.underline) content = <u>{content}</u>;
        if (run.italic) content = <em>{content}</em>;
        if (run.bold) content = <strong>{content}</strong>;
        return <Fragment key={index}>{content}</Fragment>;
      })}
    </span>
  );
}

export function FormattingHint() {
  return (
    <p className="small formatting-hint">
      Formatierung: <strong>*fett*</strong> · <em>_kursiv_</em> · <u>__unterstrichen__</u>
    </p>
  );
}
