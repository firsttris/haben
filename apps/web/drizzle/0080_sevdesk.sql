CREATE TABLE "sevdesk_connection" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"bookkeeping_version" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sevdesk_connection_single_row" CHECK ("sevdesk_connection"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "sevdesk_id" text;--> statement-breakpoint
ALTER TABLE "lexoffice_imports" ADD COLUMN "source" text DEFAULT 'lexoffice' NOT NULL;--> statement-breakpoint
ALTER TABLE "lexoffice_vouchers" ADD COLUMN "source" text DEFAULT 'lexoffice' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_sevdesk_id_unique" UNIQUE("sevdesk_id");