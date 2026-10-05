// Haben: minimaler Service Worker, damit sich die App installieren lässt.
// Er speichert bewusst nichts zwischen: Buchhaltungsdaten bleiben auf dem Server.
// Ohne fetch-Handler: Chrome verlangt ihn fürs Installieren nicht mehr, und ein leerer
// Handler weckt den Service Worker nur unnötig bei jeder Anfrage.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
