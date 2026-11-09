import { useState } from "react";

/** Zustand, der einen neuen Wert des Loaders übernimmt: Eine gemerkte Seite kommt nach „Zurück“ sonst mit dem alten Wert wieder */
export function useLoadedState<T>(loaded: T): [T, (value: T | ((current: T) => T)) => void] {
  const [seen, setSeen] = useState(loaded);
  const [value, setValue] = useState(loaded);
  if (loaded !== seen) {
    setSeen(loaded);
    setValue(loaded);
  }
  return [loaded !== seen ? loaded : value, setValue];
}
