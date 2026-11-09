ALTER TABLE "invoices" ADD COLUMN "payment_method" text DEFAULT 'ueberweisung' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sepa_mandate_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN "payment_method" text DEFAULT 'ueberweisung' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sepa_mandate_id_sepa_mandates_id_fk" FOREIGN KEY ("sepa_mandate_id") REFERENCES "public"."sepa_mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_method" CHECK ("invoices"."payment_method" in ('ueberweisung', 'lastschrift'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_lastschrift_mandat" CHECK (("invoices"."payment_method" = 'lastschrift') = ("invoices"."sepa_mandate_id" is not null));