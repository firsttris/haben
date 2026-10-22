/** Position eines Belegs in der Belegliste und seine Nachbarn, zum Durcharbeiten ohne Umweg über die Liste */
export interface DocumentNavigation {
  /** 1-basiert; 0, wenn der Beleg nicht in der Liste steht */
  position: number;
  total: number;
  previousId: string | null;
  nextId: string | null;
  /** Nächster Beleg „Zu prüfen“ nach diesem, am Ende der Liste wieder von vorn; ohne den Beleg selbst */
  nextOpenId: string | null;
}

/** `rows` in der Reihenfolge der Belegliste (`listDocuments`) */
export function documentNavigation(rows: readonly { id: string; status: string }[], id: string): DocumentNavigation {
  const index = rows.findIndex((row) => row.id === id);
  const after = index < 0 ? rows : [...rows.slice(index + 1), ...rows.slice(0, index)];
  return {
    position: index + 1,
    total: rows.length,
    previousId: index > 0 ? rows[index - 1]!.id : null,
    nextId: index >= 0 && index < rows.length - 1 ? rows[index + 1]!.id : null,
    nextOpenId: after.find((row) => row.status === "neu")?.id ?? null,
  };
}
