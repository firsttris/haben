import { useEffect, useState } from "react";

/**
 * Reagiert auf eine CSS-Media-Query im Browser. Am Server und beim ersten Render gilt `false`, damit Hydration
 * ohne Abweichung durchläuft.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
