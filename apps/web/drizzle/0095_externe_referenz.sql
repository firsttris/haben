ALTER TABLE "invoices" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_external_ref" ON "invoices" USING btree ("external_source","external_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_external_ref_pair" CHECK (("invoices"."external_source" is null) = ("invoices"."external_id" is null));