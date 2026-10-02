import { Link, Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { Icon, type IconName } from "../components/Icon.tsx";
import { authClient } from "../lib/auth-client.ts";
import { getAuthState } from "../server/functions/setup.ts";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const state = await getAuthState();
    if (!state.initialized) throw redirect({ to: "/setup" });
    if (!state.user) throw redirect({ to: "/login" });
    return { user: state.user };
  },
  component: AppLayout,
});

/** Bereiche aus dem Plan, die in späteren Phasen kommen */
const LATER: { label: string; icon: IconName; phase: number }[] = [
  { label: "Rechnungen", icon: "invoice", phase: 2 },
  { label: "Belege", icon: "receipt", phase: 3 },
  { label: "Bank", icon: "bank", phase: 4 },
  { label: "Buchungen", icon: "journal", phase: 4 },
];

const LATER_AFTER: { label: string; icon: IconName; phase: number }[] = [
  { label: "Auswertungen", icon: "reports", phase: 5 },
  { label: "Kontakte", icon: "contacts", phase: 2 },
];

function LaterLink({ label, icon, phase }: { label: string; icon: IconName; phase: number }) {
  return (
    <span className="nav-link" aria-disabled="true" title={`Folgt in Phase ${phase}`}>
      <Icon name={icon} />
      {label}
    </span>
  );
}

function AppLayout() {
  const { user } = Route.useRouteContext();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    await router.navigate({ to: "/login" });
  }

  return (
    <div className="shell">
      <nav className="nav" aria-label="Hauptnavigation">
        <Link to="/" className="brand">
          <span className="brand-mark">H</span>Haben
        </Link>
        <Link to="/" className="nav-link" activeOptions={{ exact: true }}>
          <Icon name="overview" />
          Übersicht
        </Link>
        {LATER.map((item) => (
          <LaterLink key={item.label} {...item} />
        ))}
        <Link to="/umsatzsteuer" className="nav-link">
          <Icon name="vat" />
          Umsatzsteuer
        </Link>
        {LATER_AFTER.map((item) => (
          <LaterLink key={item.label} {...item} />
        ))}
        <Link to="/einstellungen" className="nav-link">
          <Icon name="settings" />
          Einstellungen
        </Link>
        <div className="nav-spacer" />
        <div className="nav-foot">
          <span>Geschäftsjahr {new Date().getFullYear()}</span>
          <span>{user.name}</span>
          {/* AGPL § 13: Nutzer im Netz bekommen den Quellcode */}
          <a href="https://github.com/firsttris/haben" style={{ color: "inherit" }}>
            Quellcode (AGPL)
          </a>
          <button type="button" onClick={signOut}>
            Abmelden
          </button>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
