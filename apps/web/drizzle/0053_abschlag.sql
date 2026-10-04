ALTER TABLE "invoice_lines" ADD COLUMN "deduction_of" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "variant" text;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_deduction_of_invoices_id_fk" FOREIGN KEY ("deduction_of") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_variant_kind" CHECK ("invoices"."variant" is null or "invoices"."kind" = 'rechnung');