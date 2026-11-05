ALTER TABLE "cash_entries" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD COLUMN "tax_shares" jsonb;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD COLUMN "tax_shares_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "write_offs" ADD COLUMN "cash_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_cash_entry_id_cash_entries_id_fk" FOREIGN KEY ("cash_entry_id") REFERENCES "public"."cash_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_entries_invoice" ON "cash_entries" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "write_offs_cash_entry" ON "write_offs" USING btree ("cash_entry_id");--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_invoice_kind" CHECK (("cash_entries"."kind" = 'rechnung') = ("cash_entries"."invoice_id" is not null));--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_payment" CHECK ("write_offs"."transaction_id" is null or "write_offs"."cash_entry_id" is null);