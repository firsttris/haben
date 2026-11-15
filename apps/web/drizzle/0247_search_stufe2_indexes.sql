DROP INDEX "contact_persons_name_trgm_idx";--> statement-breakpoint
DROP INDEX "contact_persons_email_trgm_idx";--> statement-breakpoint
DROP INDEX "contacts_name_trgm_idx";--> statement-breakpoint
DROP INDEX "contacts_kundennummer_trgm_idx";--> statement-breakpoint
DROP INDEX "contacts_lieferantennummer_trgm_idx";--> statement-breakpoint
DROP INDEX "contacts_email_trgm_idx";--> statement-breakpoint
DROP INDEX "contacts_ort_trgm_idx";--> statement-breakpoint
DROP INDEX "contacts_ust_id_trgm_idx";--> statement-breakpoint
DROP INDEX "contacts_iban_trgm_idx";--> statement-breakpoint
DROP INDEX "contacts_debitor_nr_trgm_idx";--> statement-breakpoint
DROP INDEX "contacts_kreditor_nr_trgm_idx";--> statement-breakpoint
DROP INDEX "documents_supplier_name_trgm_idx";--> statement-breakpoint
DROP INDEX "documents_invoice_number_trgm_idx";--> statement-breakpoint
DROP INDEX "documents_filename_trgm_idx";--> statement-breakpoint
DROP INDEX "invoices_number_trgm_idx";--> statement-breakpoint
DROP INDEX "invoices_buyer_order_reference_trgm_idx";--> statement-breakpoint
DROP INDEX "invoices_seller_order_reference_trgm_idx";--> statement-breakpoint
DROP INDEX "invoices_buyer_name_trgm_idx";--> statement-breakpoint
DROP INDEX "quotes_number_trgm_idx";--> statement-breakpoint
DROP INDEX "quotes_buyer_name_trgm_idx";--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "archive_search" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "articles_number_trgm_idx" ON "articles" USING gin (haben_unaccent("number") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "articles_description_trgm_idx" ON "articles" USING gin (haben_unaccent("description") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "assets_name_trgm_idx" ON "assets" USING gin (haben_unaccent("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "assets_account_trgm_idx" ON "assets" USING gin (haben_unaccent("account") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "assets_note_trgm_idx" ON "assets" USING gin (haben_unaccent("note") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bank_transactions_counterparty_name_trgm_idx" ON "bank_transactions" USING gin (haben_unaccent("counterparty_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bank_transactions_purpose_trgm_idx" ON "bank_transactions" USING gin (haben_unaccent("purpose") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bank_transactions_counterparty_iban_trgm_idx" ON "bank_transactions" USING gin (haben_unaccent("counterparty_iban") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bank_transactions_amount_search_idx" ON "bank_transactions" USING btree ("amount");--> statement-breakpoint
CREATE INDEX "bank_transactions_booking_date_search_idx" ON "bank_transactions" USING btree ("booking_date");--> statement-breakpoint
CREATE INDEX "cash_entries_text_trgm_idx" ON "cash_entries" USING gin (haben_unaccent("text") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "employees_vorname_trgm_idx" ON "employees" USING gin (haben_unaccent("vorname") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "employees_nachname_trgm_idx" ON "employees" USING gin (haben_unaccent("nachname") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "journal_entries_description_trgm_idx" ON "journal_entries" USING gin (haben_unaccent("description") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "journal_entries_reverses_idx" ON "journal_entries" USING btree ("reverses_id") WHERE "journal_entries"."reverses_id" is not null;--> statement-breakpoint
CREATE INDEX "journal_lines_debit_search_idx" ON "journal_lines" USING btree ("debit");--> statement-breakpoint
CREATE INDEX "journal_lines_credit_search_idx" ON "journal_lines" USING btree ("credit");--> statement-breakpoint
CREATE INDEX "legacy_order_documents_number_trgm_idx" ON "legacy_order_documents" USING gin (haben_unaccent("number") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "legacy_order_documents_contact_name_trgm_idx" ON "legacy_order_documents" USING gin (haben_unaccent("contact_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "lexoffice_vouchers_number_trgm_idx" ON "lexoffice_vouchers" USING gin (haben_unaccent("number") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "lexoffice_vouchers_contact_name_trgm_idx" ON "lexoffice_vouchers" USING gin (haben_unaccent("contact_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "lexoffice_vouchers_remark_trgm_idx" ON "lexoffice_vouchers" USING gin (haben_unaccent("remark") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "loans_name_trgm_idx" ON "loans" USING gin (haben_unaccent("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "own_accounts_account_trgm_idx" ON "own_accounts" USING gin (haben_unaccent("account") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "own_accounts_name_trgm_idx" ON "own_accounts" USING gin (haben_unaccent("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "pauschalen_description_trgm_idx" ON "pauschalen" USING gin (haben_unaccent("description") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "postfach_documents_dateibezeichnung_trgm_idx" ON "postfach_documents" USING gin (haben_unaccent("dateibezeichnung") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "postfach_documents_zeitraum_trgm_idx" ON "postfach_documents" USING gin (haben_unaccent("veranlagungszeitraum") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "recurring_documents_name_trgm_idx" ON "recurring_documents" USING gin (haben_unaccent("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "recurring_documents_supplier_name_trgm_idx" ON "recurring_documents" USING gin (haben_unaccent("supplier_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "recurring_invoices_name_trgm_idx" ON "recurring_invoices" USING gin (haben_unaccent("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "service_entries_description_trgm_idx" ON "service_entries" USING gin (haben_unaccent("description") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "service_entries_project_trgm_idx" ON "service_entries" USING gin (haben_unaccent("project") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "text_blocks_name_trgm_idx" ON "text_blocks" USING gin (haben_unaccent("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "text_blocks_text_trgm_idx" ON "text_blocks" USING gin (haben_unaccent("text") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contact_persons_name_trgm_idx" ON "contact_persons" USING gin (haben_unaccent("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contact_persons_email_trgm_idx" ON "contact_persons" USING gin (haben_unaccent("email") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_name_trgm_idx" ON "contacts" USING gin (haben_unaccent("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_kundennummer_trgm_idx" ON "contacts" USING gin (haben_unaccent("kundennummer") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_lieferantennummer_trgm_idx" ON "contacts" USING gin (haben_unaccent("lieferantennummer") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_email_trgm_idx" ON "contacts" USING gin (haben_unaccent("email") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_ort_trgm_idx" ON "contacts" USING gin (haben_unaccent("ort") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_ust_id_trgm_idx" ON "contacts" USING gin (haben_unaccent("ust_id") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_iban_trgm_idx" ON "contacts" USING gin (haben_unaccent("iban") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_debitor_nr_trgm_idx" ON "contacts" USING gin (haben_unaccent("debitor_nr"::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contacts_kreditor_nr_trgm_idx" ON "contacts" USING gin (haben_unaccent("kreditor_nr"::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "documents_supplier_name_trgm_idx" ON "documents" USING gin (haben_unaccent("supplier_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "documents_invoice_number_trgm_idx" ON "documents" USING gin (haben_unaccent("invoice_number") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "documents_filename_trgm_idx" ON "documents" USING gin (haben_unaccent("filename") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "invoices_number_trgm_idx" ON "invoices" USING gin (haben_unaccent("number") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "invoices_buyer_order_reference_trgm_idx" ON "invoices" USING gin (haben_unaccent("buyer_order_reference") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "invoices_seller_order_reference_trgm_idx" ON "invoices" USING gin (haben_unaccent("seller_order_reference") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "invoices_buyer_name_trgm_idx" ON "invoices" USING gin (haben_unaccent("buyer" ->> 'name') gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quotes_number_trgm_idx" ON "quotes" USING gin (haben_unaccent("number") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quotes_buyer_name_trgm_idx" ON "quotes" USING gin (haben_unaccent("buyer" ->> 'name') gin_trgm_ops);