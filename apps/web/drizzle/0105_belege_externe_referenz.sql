ALTER TABLE "documents" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_external_ref" ON "documents" USING btree ("external_source","external_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_external_ref_pair" CHECK (("documents"."external_source" is null) = ("documents"."external_id" is null));