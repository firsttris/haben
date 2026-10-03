ALTER TABLE "elster_certificates" ADD COLUMN "pin_ciphertext" "bytea";--> statement-breakpoint
ALTER TABLE "elster_certificates" ADD COLUMN "pin_saved_at" timestamp with time zone;