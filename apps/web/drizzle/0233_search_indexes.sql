CREATE INDEX "contact_persons_name_trgm_idx" ON "contact_persons" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contact_persons_email_trgm_idx" ON "contact_persons" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_name_trgm_idx" ON "contacts" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_kundennummer_trgm_idx" ON "contacts" USING gin ("kundennummer" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_lieferantennummer_trgm_idx" ON "contacts" USING gin ("lieferantennummer" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_email_trgm_idx" ON "contacts" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_ort_trgm_idx" ON "contacts" USING gin ("ort" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_ust_id_trgm_idx" ON "contacts" USING gin ("ust_id" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_iban_trgm_idx" ON "contacts" USING gin ("iban" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_debitor_nr_trgm_idx" ON "contacts" USING gin (("debitor_nr"::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_kreditor_nr_trgm_idx" ON "contacts" USING gin (("kreditor_nr"::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "documents_supplier_name_trgm_idx" ON "documents" USING gin ("supplier_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "documents_invoice_number_trgm_idx" ON "documents" USING gin ("invoice_number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "documents_filename_trgm_idx" ON "documents" USING gin ("filename" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "documents_gross_search_idx" ON "documents" USING btree ("gross");--> statement-breakpoint
CREATE INDEX "invoices_number_trgm_idx" ON "invoices" USING gin ("number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "invoices_buyer_order_reference_trgm_idx" ON "invoices" USING gin ("buyer_order_reference" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "invoices_seller_order_reference_trgm_idx" ON "invoices" USING gin ("seller_order_reference" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "invoices_buyer_name_trgm_idx" ON "invoices" USING gin (("buyer" ->> 'name') gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "invoices_gross_search_idx" ON "invoices" USING btree ("gross");--> statement-breakpoint
CREATE INDEX "invoices_contactId_search_idx" ON "invoices" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "quotes_number_trgm_idx" ON "quotes" USING gin ("number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quotes_buyer_name_trgm_idx" ON "quotes" USING gin (("buyer" ->> 'name') gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quotes_gross_search_idx" ON "quotes" USING btree ("gross");--> statement-breakpoint
CREATE INDEX "quotes_contactId_search_idx" ON "quotes" USING btree ("contact_id");