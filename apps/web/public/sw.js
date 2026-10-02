// Haben: minimaler Service Worker, damit sich die App installieren lässt.
// Er speichert bewusst nichts zwischen: Buchhaltungsdaten bleiben auf dem Server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
