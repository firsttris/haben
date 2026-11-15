CREATE TABLE "legacy_file_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"import_id" uuid,
	"state" text NOT NULL,
	"role" text,
	"source_file_id" text,
	"message" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_file_states" ADD CONSTRAINT "legacy_file_states_voucher_id_lexoffice_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."lexoffice_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_file_states" ADD CONSTRAINT "legacy_file_states_import_id_lexoffice_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."lexoffice_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legacy_file_states_voucher" ON "legacy_file_states" USING btree ("voucher_id","created_at");