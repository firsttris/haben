import { Link } from "@tanstack/react-router";
import type { ArchiveSearch } from "../../routes/_app/archiv/index.tsx";

/** Jahre mit Daten als Chips; behält die übrigen Filter der Ansicht */
export function YearSwitch({ year, years, search }: { year: number; years: number[]; search: ArchiveSearch }) {
  const options = [...new Set([...years, year])].sort((a, b) => b - a);
  return (
    <nav className="filter-row" aria-label="Jahr wählen">
      {options.map((y) => (
        <Link
          key={y}
          to="/archiv" activeProps={{}}
          search={{ ...search, jahr: y, seite: undefined }}
          className={y === year ? "chip active" : "chip"}
          aria-current={y === year ? "page" : undefined}
        >
          {y}
        </Link>
      ))}
    </nav>
  );
}
