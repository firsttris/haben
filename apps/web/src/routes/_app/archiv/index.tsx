import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod/mini";
import { ArchiveFiles } from "../../../components/archiv/ArchiveFiles.tsx";
import { DatevBookings } from "../../../components/archiv/DatevBookings.tsx";
import { LegacyVouchers } from "../../../components/archiv/LegacyVouchers.tsx";
import { Migration } from "../../../components/archiv/Migration.tsx";
import { getDatevBookings, getLegacyVouchers, getMigration } from "../../../server/functions/archive.ts";
import styles from "../../../styles/archiv.css?url";

const searchSchema = z.object({
  ansicht: z.optional(z.enum(["umzug", "belege", "buchungen", "dateien"])),
  jahr: z.optional(z.int().check(z.minimum(2000), z.maximum(2100))),
  richtung: z.optional(z.enum(["alle", "einnahme", "ausgabe"])),
  suche: z.optional(z.string().check(z.maxLength(100))),
  ohneDatei: z.optional(z.boolean()),
  ohneBeleg: z.optional(z.boolean()),
  seite: z.optional(z.int().check(z.minimum(0))),
});

export type ArchiveSearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/_app/archiv/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const view = deps.ansicht ?? "umzug";
    const migration = await getMigration();
    const years = migration.years.map((y) => y.year);
    const year = deps.jahr ?? years[0] ?? new Date().getFullYear() - 1;
    if (view === "belege") {
      const vouchers = await getLegacyVouchers({
        data: { year, direction: deps.richtung ?? "alle", search: deps.suche ?? "", ohneDatei: deps.ohneDatei ?? false },
      });
      return { view, year, years, migration, vouchers } as const;
    }
    if (view === "buchungen") {
      const bookings = await getDatevBookings({
        data: { year, search: deps.suche ?? "", unmatched: deps.ohneBeleg ?? false, page: deps.seite ?? 0 },
      });
      return { view, year, years, migration, bookings } as const;
    }
    return { view, year, years, migration } as const;
  },
  head: () => ({ meta: [{ title: "Archiv · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: ArchivePage,
});

const VIEWS = [
  { value: "umzug", label: "Umzug aus Lexoffice" },
  { value: "belege", label: "Belege" },
  { value: "buchungen", label: "DATEV-Buchungen" },
  { value: "dateien", label: "Originaldateien" },
] as const;

function ArchivePage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Altbestand · unveränderlich archiviert</div>
          <h1>Archiv</h1>
        </div>
        <nav className="archive-tabs" aria-label="Bereich wählen">
          {VIEWS.map((view) => (
            <Link
              key={view.value}
              to="/archiv" activeProps={{}}
              search={{ ansicht: view.value === "umzug" ? undefined : view.value, jahr: search.jahr }}
              className={data.view === view.value ? "chip active" : "chip"}
              aria-current={data.view === view.value ? "page" : undefined}
            >
              {view.label}
            </Link>
          ))}
        </nav>
      </div>
      {data.view === "umzug" && <Migration data={data.migration} />}
      {data.view === "belege" && <LegacyVouchers year={data.year} years={data.years} rows={data.vouchers} search={search} />}
      {data.view === "buchungen" && <DatevBookings year={data.year} years={data.years} data={data.bookings} search={search} />}
      {data.view === "dateien" && <ArchiveFiles files={data.migration.files} kinds={data.migration.kinds} />}
    </>
  );
}
