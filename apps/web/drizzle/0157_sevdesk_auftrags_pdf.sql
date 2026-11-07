CREATE TABLE "legacy_order_pdf_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"bookkeeping_version" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_order_pdf_attempts" ADD CONSTRAINT "legacy_order_pdf_attempts_order_id_legacy_order_documents_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."legacy_order_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legacy_order_pdf_attempts_order" ON "legacy_order_pdf_attempts" USING btree ("order_id");