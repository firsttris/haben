ALTER TABLE "service_entries" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "service_entries" ADD CONSTRAINT "service_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_entries_invoice" ON "service_entries" USING btree ("invoice_id");