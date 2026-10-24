ALTER TABLE "invoices" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_quote" ON "invoices" USING btree ("quote_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quote_kind" CHECK ("invoices"."quote_id" is null or "invoices"."kind" = 'rechnung');