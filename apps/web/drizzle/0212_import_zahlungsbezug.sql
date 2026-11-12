CREATE TABLE "external_import_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_import_id" uuid NOT NULL,
	"original_import_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_import_settlements_different" CHECK ("external_import_settlements"."payment_import_id" <> "external_import_settlements"."original_import_id")
);
--> statement-breakpoint
ALTER TABLE "external_import_settlements" ADD CONSTRAINT "external_import_settlements_payment_import_id_external_imports_id_fk" FOREIGN KEY ("payment_import_id") REFERENCES "public"."external_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_import_settlements" ADD CONSTRAINT "external_import_settlements_original_import_id_external_imports_id_fk" FOREIGN KEY ("original_import_id") REFERENCES "public"."external_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_import_settlements_payment" ON "external_import_settlements" USING btree ("payment_import_id");--> statement-breakpoint
CREATE INDEX "external_import_settlements_original" ON "external_import_settlements" USING btree ("original_import_id");