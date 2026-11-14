import type { ComponentProps } from "react";
import { type Taste, tastenNamen, useApple } from "../lib/tastatur.ts";

/**
 * Tastenkürzel als Tastenkästchen, je System: `<Kuerzel tasten={["mod", "K"]} />` zeigt am Mac „⌘ K“, sonst „Strg K“.
 * Für title und Hinweistexte gibt es `useKuerzelText`, für aria-keyshortcuts `ariaKuerzel` (lib/tastatur.ts).
 */
export function Kuerzel({ tasten, className, ...rest }: { tasten: readonly Taste[] } & Omit<ComponentProps<"span">, "children">) {
  const namen = tastenNamen(tasten, useApple());
  return (
    <span {...rest} className={className ? `kuerzel ${className}` : "kuerzel"}>
      {namen.map((name, index) => (
        <kbd key={index}>{name}</kbd>
      ))}
    </span>
  );
}
