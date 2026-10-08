-- Indizes auf Fremdschlüssel- und Datumsspalten, Eindeutigkeit (ein Nutzer, ein Storno je Rechnung, ein
-- laufender Lexoffice-Abruf) und Verweise der Storno-Spalten. Neue Fremdschlüssel und CHECKs mit NOT VALID:
-- Sie gelten für neue Zeilen, Bestandsdaten lassen die Migration nicht scheitern.
-- Die in 0011, 0016, 0018 und 0020 von Hand angelegten Constraints stehen jetzt in schema.ts; ihre
-- ADD-CONSTRAINT-Anweisungen sind hier entfernt, weil es sie in der Datenbank schon gibt.
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_reverses_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."allocations"("id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_opening_entry_fk" FOREIGN KEY ("opening_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_reverses_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."cash_entries"("id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_corrects_fk" FOREIGN KEY ("corrects_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "pauschalen" ADD CONSTRAINT "pauschalen_reverses_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."pauschalen"("id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "vat_returns" ADD CONSTRAINT "vat_returns_corrects_fk" FOREIGN KEY ("corrects_id") REFERENCES "public"."vat_returns"("id") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
CREATE INDEX "allocations_transaction" ON "allocations" USING btree ("transaction_id");
--> statement-breakpoint
CREATE INDEX "allocations_invoice" ON "allocations" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX "allocations_document" ON "allocations" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX "audit_log_at" ON "audit_log" USING btree ("at");
--> statement-breakpoint
CREATE INDEX "audit_log_row" ON "audit_log" USING btree ("table_name","row_id");
--> statement-breakpoint
CREATE INDEX "bank_transactions_account_date" ON "bank_transactions" USING btree ("bank_account_id","booking_date");
--> statement-breakpoint
CREATE INDEX "dunnings_invoice" ON "dunnings" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice" ON "invoice_lines" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX "invoices_corrects" ON "invoices" USING btree ("corrects_id");
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE kind = 'storno' AND status = 'final' GROUP BY corrects_id HAVING count(*) > 1) THEN
    RAISE WARNING 'Eine Rechnung hat mehrere Stornos; der Index invoices_one_storno fehlt, bis das geklärt ist.';
  ELSE
    CREATE UNIQUE INDEX "invoices_one_storno" ON "invoices" USING btree ("corrects_id") WHERE "invoices"."kind" = 'storno' and "invoices"."status" = 'final';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX "journal_entries_date" ON "journal_entries" USING btree ("date");
--> statement-breakpoint
CREATE INDEX "journal_entries_source" ON "journal_entries" USING btree ("source_type","source_id");
--> statement-breakpoint
CREATE INDEX "journal_lines_entry" ON "journal_lines" USING btree ("entry_id");
--> statement-breakpoint
CREATE INDEX "journal_lines_account" ON "journal_lines" USING btree ("account");
--> statement-breakpoint
-- Liegengebliebene Läufe bis auf den neuesten beenden, sonst scheitert der Index
UPDATE "lexoffice_imports" SET "status" = 'fehler', "error" = 'Abgebrochen (Server neu gestartet).', "finished_at" = now()
  WHERE "status" = 'laeuft' AND "id" <> (SELECT "id" FROM "lexoffice_imports" WHERE "status" = 'laeuft' ORDER BY "started_at" DESC LIMIT 1);
--> statement-breakpoint
CREATE UNIQUE INDEX "lexoffice_imports_one_running" ON "lexoffice_imports" USING btree ("status") WHERE "lexoffice_imports"."status" = 'laeuft';
--> statement-breakpoint
DO $$ BEGIN
  IF (SELECT count(*) FROM "user") > 1 THEN
    RAISE WARNING 'Es gibt mehr als ein Konto; der Index user_single fehlt, bis eines gelöscht ist.';
  ELSE
    CREATE UNIQUE INDEX "user_single" ON "user" USING btree ((true));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_target" CHECK (("allocations"."kind" <> 'invoice' or "allocations"."invoice_id" is not null) and ("allocations"."kind" <> 'document' or "allocations"."document_id" is not null)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_corrects_original" CHECK ("invoices"."kind" = 'rechnung' or "invoices"."corrects_id" is not null) NOT VALID;
