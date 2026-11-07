CREATE TABLE "legacy_voucher_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"transaction_id" text,
	"account_id" text,
	"account_name" text,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_voucher_payments" ADD CONSTRAINT "legacy_voucher_payments_voucher_id_lexoffice_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."lexoffice_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_voucher_payments" ADD CONSTRAINT "legacy_voucher_payments_import_id_lexoffice_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."lexoffice_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_voucher_payments_source_external" ON "legacy_voucher_payments" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "legacy_voucher_payments_voucher" ON "legacy_voucher_payments" USING btree ("voucher_id");--> statement-breakpoint
-- Zahlungsnachweise bleiben unverändert; ein späterer Abruf ergänzt nur fehlende Zahlungen.
CREATE TRIGGER legacy_voucher_payments_append_only BEFORE UPDATE OR DELETE ON legacy_voucher_payments
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER legacy_voucher_payments_audit AFTER INSERT ON legacy_voucher_payments
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
