CREATE TABLE "document_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"category" text NOT NULL,
	"tax_rate" smallint NOT NULL,
	"net" integer NOT NULL,
	"tax" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_splits" ADD CONSTRAINT "document_splits_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_splits_position" ON "document_splits" USING btree ("document_id","position");