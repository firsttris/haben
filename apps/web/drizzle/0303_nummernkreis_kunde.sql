DROP INDEX "invoices_number_counter";--> statement-breakpoint
DROP INDEX "quotes_number_counter";--> statement-breakpoint
-- PK (year) entfällt; Kreise unterscheidet der Unique auf (year, contact_id) NULLS NOT DISTINCT (#1426)
ALTER TABLE "invoice_number_counters" DROP CONSTRAINT "invoice_number_counters_pkey";--> statement-breakpoint
ALTER TABLE "quote_number_counters" DROP CONSTRAINT "quote_number_counters_pkey";--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "invoice_counter_per_customer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "quote_counter_per_customer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_number_counters" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "number_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "quote_number_counters" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "number_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_contact_id_contacts_id_fk" FOREIGN KEY ("number_contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_number_counters" ADD CONSTRAINT "quote_number_counters_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_number_contact_id_contacts_id_fk" FOREIGN KEY ("number_contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Gleiche laufende Nummer in zwei Kreisen erlaubt, im selben Kreis nicht: NULLS NOT DISTINCT lässt den gemeinsamen
-- Kreis (NULL) mit sich selbst kollidieren; von Hand ergänzt, weil drizzle es an Indexen nicht kennt. Der Filter hält
-- Entwürfe ohne Nummernkreis (number_year NULL) aus dem Index.
CREATE UNIQUE INDEX "invoices_number_counter" ON "invoices" USING btree ("number_year","number_contact_id","number_counter") NULLS NOT DISTINCT WHERE "invoices"."number_year" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_number_counter" ON "quotes" USING btree ("number_year","number_contact_id","number_counter") NULLS NOT DISTINCT WHERE "quotes"."number_year" is not null;--> statement-breakpoint
ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_year_contact_id_unique" UNIQUE NULLS NOT DISTINCT("year","contact_id");--> statement-breakpoint
ALTER TABLE "quote_number_counters" ADD CONSTRAINT "quote_number_counters_year_contact_id_unique" UNIQUE NULLS NOT DISTINCT("year","contact_id");
