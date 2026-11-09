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
  // Der Text ab der Stelle steht im gemessenen Element, damit es umbricht wie das Wort; ein eigenes Zeichen (U+200B)
  // wäre selbst eine Umbruchstelle und bliebe am Ende der Zeile davor stehen (UAX #14, LB7/LB8). Das Zeichen gilt nur am Textende.
  marker.textContent = field.value.slice(index) || "​";
  mirror.append(field.value.slice(0, index), marker);
  field.parentElement?.append(mirror);
  const position = { left: marker.offsetLeft + field.clientLeft, top: marker.offsetTop + field.clientTop - field.scrollTop };
  mirror.remove();
  return position;
}
