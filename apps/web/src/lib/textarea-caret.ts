const MIRRORED = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "textTransform",
  "tabSize",
] as const;

export interface CaretPosition {
  left: number;
  top: number;
  height: number;
}

/**
 * Position eines Zeichens relativ zum Textfeld. Eine textarea verrät keine Koordinaten, darum wird ihr Text
 * in einem unsichtbaren Element gleicher Maße nachgesetzt und dort gemessen.
 */
export function caretPosition(field: HTMLTextAreaElement, index: number): CaretPosition {
  const style = getComputedStyle(field);
  const mirror = document.createElement("div");
  for (const property of MIRRORED) mirror.style[property] = style[property];
  Object.assign(mirror.style, {
    position: "absolute",
    top: "0",
    left: "0",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    boxSizing: "border-box",
    width: `${field.clientWidth}px`,
  });
  const marker = document.createElement("span");
  marker.textContent = "​";
  // Der Text hinter der Stelle gehört dazu, sonst bricht ein angefangenes Wort anders um
  mirror.append(field.value.slice(0, index), marker, field.value.slice(index));
  field.parentElement?.append(mirror);
  const position = { left: marker.offsetLeft + field.clientLeft, top: marker.offsetTop + field.clientTop - field.scrollTop, height: marker.offsetHeight };
  mirror.remove();
  return position;
}
