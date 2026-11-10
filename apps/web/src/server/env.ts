import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    OIDC_ONLY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    OIDC_ISSUER: z.string().url().optional(),
    OIDC_SCOPES: z.string().optional(),
    OIDC_CLIENT_ID: z.string().min(1).optional(),
    OIDC_CLIENT_SECRET: z.string().min(1).optional(),
    OIDC_DISPLAY_NAME: z.string().trim().min(1).max(80).optional(),
    /** Name genau eines Claims der UserInfo-Antwort, kein Pfad und kein Ausdruck */
    OIDC_GROUPS_CLAIM: z
      .string()
      // Punkte nur in URL-förmigen Namen (OIDC Core 5.1.2, kollisionsfrei): „realm_access.roles“ sähe wie ein Pfad aus
      .regex(/^(?:https?:\/\/[A-Za-z0-9_:/.-]{1,92}|[A-Za-z0-9_:/-]{1,100})$/, "ein einzelner Claimname aus Buchstaben, Ziffern, _ : / - oder eine URL")
      .default("groups"),
    OIDC_GROUP_INHABER: z.string().optional(),
    OIDC_GROUP_STEUERBERATUNG: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().min(32),
    /** Öffentliche Adresse, z. B. https://haben.example.de */
    BETTER_AUTH_URL: z.string().url(),
    /** Code für die Ersteinrichtung unter /setup; ohne ihn erzeugt Haben beim Start einen und schreibt ihn ins Log */
    HABEN_SETUP_CODE: z.union([z.literal(""), z.string().min(8)]).optional(),
    /** 32 Byte, base64 – verschlüsselt die ELSTER-Zertifikatsdatei und die API-Schlüssel für Lexoffice und sevDesk */
    HABEN_ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, "base64").length === 32, "muss 32 Byte (base64) sein"),
    /** Verzeichnis des entpackten ERiC-Pakets; fehlt es, sendet Haben nur simuliert */
    ERIC_HOME: z.string().optional(),
    ERIC_LOG_DIR: z.string().optional(),
    ERIC_WORKER_PATH: z.string().optional(),
    /** Befehl für den ERiC-Worker statt der eigenen Laufzeit, z. B. ein Skript, das ihn unter QEMU als x86_64 startet (arm64) */
    ERIC_WORKER_COMMAND: z.string().optional(),
    /** Ziel für ERiC, das Haben selbst herunterlädt; gilt, wenn ERIC_HOME nicht gesetzt ist. Im Image ein Volume */
    ERIC_DIR: z.string().default("data/eric"),
    /** Andere Download-Adresse für ERiC, nur zum Testen */
    ERIC_DOWNLOAD_URL: z.string().url().optional(),
    /** Erwartete SHA-256 des ERiC-Pakets; stimmt sie nicht, installiert Haben es nicht */
    ERIC_SHA256: z.union([z.literal(""), z.string().regex(/^[0-9a-fA-F]{64}$/)]).optional(),
    /** Hersteller-ID für den Echtbetrieb; ohne sie geht nur die Testübermittlung */
    ELSTER_HERSTELLER_ID: z
      .string()
      .regex(/^\d{5}$/)
      .optional(),
    /** Ablage der Belegdateien; im Container ein Volume */
    DOCUMENTS_DIR: z.string().default("data/belege"),
    /** Ohne Schlüssel keine KI-Auslesung von Belegen; E-Rechnungen werden trotzdem gelesen */
    ANTHROPIC_API_KEY: z.string().optional(),
    /**
     * Anbieter der KI-Auslesung: „anthropic“ oder „openai-compatible“ (selbst betriebener Dienst wie Ollama, LM Studio, vLLM).
     * Ohne Angabe gilt der selbst betriebene Dienst, sobald EXTRACTION_BASE_URL gesetzt ist, sonst Anthropic mit Schlüssel.
     */
    EXTRACTION_PROVIDER: z.enum(["anthropic", "openai-compatible"]).optional(),
    /** Basis-URL des OpenAI-kompatiblen Dienstes, z. B. http://host.docker.internal:11434/v1 */
    EXTRACTION_BASE_URL: z.string().url().optional(),
    /** Modell des OpenAI-kompatiblen Dienstes, ein Vision-Modell wie qwen2.5vl:7b */
    EXTRACTION_MODEL: z.string().trim().min(1).optional(),
    /** Optionaler Schlüssel des OpenAI-kompatiblen Dienstes (Bearer) */
    EXTRACTION_API_KEY: z.string().optional(),
    /** Wartezeit auf den OpenAI-kompatiblen Dienst; lokale Modelle brauchen auf CPUs mehrere Minuten */
    EXTRACTION_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(3600).default(300),
    /** Höchstens so viele PDF-Seiten gehen als Bild an den OpenAI-kompatiblen Dienst */
    EXTRACTION_MAX_PAGES: z.coerce.number().int().min(1).max(20).default(4),
    /**
     * Was bei PDFs an den OpenAI-kompatiblen Dienst geht (#329): „text-und-bild“ Text der Seiten aus der Textschicht und
     * Seitenbilder, „text“ nur den Text für ein reines Textmodell, „bild“ nur Seitenbilder wie früher
     */
    EXTRACTION_INPUT: z.enum(["text-und-bild", "text", "bild"]).default("text-und-bild"),
    /**
     * Zusätzliche Felder im Request-Body an den OpenAI-kompatiblen Dienst, als JSON-Objekt, z. B.
     * {"reasoning_effort":"none"} für ein Modell, das sonst sein Antwortbudget mit Denken verbraucht. Ohne Angabe
     * geht der Body unverändert raus. `model`, `messages` und `stream` setzt Haben selbst und überschreibt sie.
     */
    EXTRACTION_EXTRA_BODY: z.string().optional(),
    /** Basis-URL der Lexware-Office-API, nur zum Testen oder falls Lexware die Adresse ändert */
    LEXOFFICE_API_URL: z.union([z.literal(""), z.string().url()]).optional(),
    /** Basis-URL der sevDesk-API, nur zum Testen oder falls sevDesk die Adresse ändert */
    SEVDESK_API_URL: z.union([z.literal(""), z.string().url()]).optional(),
    /** Automatischer Kontoabruf: Application ID und privater Schlüssel (PEM oder Pfad zur PEM-Datei) der Enable-Banking-Anwendung */
    ENABLE_BANKING_APP_ID: z.string().optional(),
    ENABLE_BANKING_KEY: z.string().optional(),
    ENABLE_BANKING_KEY_FILE: z.string().optional(),
    ENABLE_BANKING_API_URL: z.string().url().optional(),
  })
  // Unvollständig eingerichteter Dienst: lieber nicht starten als stillschweigend einen anderen Anbieter nehmen
  .superRefine((value, ctx) => {
    // Nur OIDC_ONLY=true schaltet SSO ein; Anbieterwerte allein aktivieren nichts und werden im Standardmodus nicht gelesen
    if (value.OIDC_ONLY) {
      if (value.OIDC_SCOPES && !value.OIDC_SCOPES.split(/\s+/).includes("openid"))
        ctx.addIssue({ code: "custom", path: ["OIDC_SCOPES"], message: "muss openid enthalten" });
      for (const field of ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_GROUP_INHABER", "OIDC_GROUP_STEUERBERATUNG"] as const) {
        if (!value[field]?.trim()) ctx.addIssue({ code: "custom", path: [field], message: "fehlt für den SSO-Modus (OIDC_ONLY=true)" });
      }
      // Gruppen werden exakt verglichen; Leerzeichen am Rand wären ein stiller Konfigurationsfehler
      for (const field of ["OIDC_GROUP_INHABER", "OIDC_GROUP_STEUERBERATUNG"] as const) {
        const group = value[field];
        if (group && group !== group.trim()) ctx.addIssue({ code: "custom", path: [field], message: "ohne Leerzeichen am Anfang oder Ende" });
      }
      if (value.OIDC_GROUP_INHABER && value.OIDC_GROUP_INHABER === value.OIDC_GROUP_STEUERBERATUNG) {
        ctx.addIssue({ code: "custom", path: ["OIDC_GROUP_STEUERBERATUNG"], message: "muss sich von OIDC_GROUP_INHABER unterscheiden" });
      }
      for (const field of ["OIDC_ISSUER", "BETTER_AUTH_URL"] as const) {
        // Eine ungültige URL hat Zod schon gemeldet; superRefine läuft trotzdem
        if (!value[field] || !URL.canParse(value[field])) continue;
        const url = new URL(value[field]);
        const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && process.env.NODE_ENV !== "production"))
        ) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: "OIDC verlangt HTTPS ohne Zugangsdaten, Query oder Fragment (HTTP nur lokal außerhalb des Betriebs)",
          });
        }
      }
    }
    const local = value.EXTRACTION_PROVIDER === "openai-compatible" || (!value.EXTRACTION_PROVIDER && value.EXTRACTION_BASE_URL);
    if (local && !value.EXTRACTION_BASE_URL) {
      ctx.addIssue({ code: "custom", path: ["EXTRACTION_BASE_URL"], message: "fehlt für den OpenAI-kompatiblen Dienst" });
    }
    if (local && !value.EXTRACTION_MODEL) {
      ctx.addIssue({ code: "custom", path: ["EXTRACTION_MODEL"], message: "fehlt für den OpenAI-kompatiblen Dienst" });
    }
    // Ein Tippfehler im JSON soll beim Start auffallen, nicht erst beim ersten Beleg
    if (value.EXTRACTION_EXTRA_BODY?.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value.EXTRACTION_EXTRA_BODY);
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        ctx.addIssue({
          code: "custom",
          path: ["EXTRACTION_EXTRA_BODY"],
          message: 'muss ein JSON-Objekt sein, z. B. {"reasoning_effort":"none"}',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  // Leere Zeilen aus haben.env (z. B. „ELSTER_HERSTELLER_ID=“) gelten als nicht gesetzt
  cached ??= envSchema.parse(
    Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) => value !== "" && (process.env.OIDC_ONLY === "true" || !key.startsWith("OIDC_") || key === "OIDC_ONLY"),
      ),
    ),
  );
  return cached;
}
