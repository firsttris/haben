import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Öffentliche Adresse, z. B. https://haben.example.de */
  BETTER_AUTH_URL: z.string().url(),
  /** 32 Byte, base64 – verschlüsselt die ELSTER-Zertifikatsdatei */
  HABEN_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, "muss 32 Byte (base64) sein"),
  /** Verzeichnis des entpackten ERiC-Pakets; fehlt es, sendet Haben nur simuliert */
  ERIC_HOME: z.string().optional(),
  ERIC_LOG_DIR: z.string().optional(),
  ERIC_WORKER_PATH: z.string().optional(),
  /** Hersteller-ID für den Echtbetrieb; ohne sie geht nur die Testübermittlung */
  ELSTER_HERSTELLER_ID: z.string().regex(/^\d{5}$/).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}
