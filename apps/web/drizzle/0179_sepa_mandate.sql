CREATE TABLE "sepa_mandate_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sepa_mandate_revocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"revoked_on" date NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sepa_mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"signed_on" date NOT NULL,
	"scheme" text NOT NULL,
	"first_sequence" text NOT NULL,
	"last_collection_before" date,
	"debtor_name" text NOT NULL,
	"debtor_iban" text NOT NULL,
	"debtor_bic" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sepa_mandates_scheme" CHECK ("sepa_mandates"."scheme" in ('CORE', 'B2B')),
	CONSTRAINT "sepa_mandates_first_sequence" CHECK ("sepa_mandates"."first_sequence" in ('FRST', 'RCUR')),
	CONSTRAINT "sepa_mandates_reference_format" CHECK ("sepa_mandates"."reference" ~ '^[A-Za-z0-9+?/:().,'' -]{1,35}$'),
	CONSTRAINT "sepa_mandates_last_collection" CHECK ("sepa_mandates"."last_collection_before" is null or "sepa_mandates"."last_collection_before" >= "sepa_mandates"."signed_on"),
	CONSTRAINT "sepa_mandates_rcur_with_collection" CHECK ("sepa_mandates"."last_collection_before" is null or "sepa_mandates"."first_sequence" = 'RCUR')
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "glaeubiger_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sepa_mandate_files" ADD CONSTRAINT "sepa_mandate_files_mandate_id_sepa_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."sepa_mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_mandate_revocations" ADD CONSTRAINT "sepa_mandate_revocations_mandate_id_sepa_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."sepa_mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_mandates" ADD CONSTRAINT "sepa_mandates_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sepa_mandate_files_mandate" ON "sepa_mandate_files" USING btree ("mandate_id");--> statement-breakpoint
CREATE INDEX "sepa_mandate_files_sha256" ON "sepa_mandate_files" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "sepa_mandate_revocations_mandate" ON "sepa_mandate_revocations" USING btree ("mandate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sepa_mandates_reference" ON "sepa_mandates" USING btree (lower("reference"));--> statement-breakpoint
CREATE INDEX "sepa_mandates_contact" ON "sepa_mandates" USING btree ("contact_id");