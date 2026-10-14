import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { THEME_SCRIPT } from "../lib/theme.ts";
import styles from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#16211C" },
      { title: "Haben" },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "stylesheet", href: styles },
    ],
  }),
  component: () => (
    <Document>
      <Outlet />
    </Document>
  ),
});

function Document({ children }: { children: ReactNode }) {
  // Service Worker nur fürs Installieren als App (Kamera, Teilen-Menü)
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return (
    // data-theme setzt das Skript vor dem Hydrieren; der Server kennt die Wahl nicht
    <html lang="de" suppressHydrationWarning>
      <head>
        {/* Theme vor dem ersten Zeichnen setzen, sonst blitzt das Standardschema auf */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
