CREATE TABLE "document_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"counter_document_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reverses_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_settlements_two" CHECK ("document_settlements"."document_id" <> "document_settlements"."counter_document_id"),
	CONSTRAINT "document_settlements_amount" CHECK ("document_settlements"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "document_settlements" ADD CONSTRAINT "document_settlements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_settlements" ADD CONSTRAINT "document_settlements_counter_document_id_documents_id_fk" FOREIGN KEY ("counter_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_settlements" ADD CONSTRAINT "document_settlements_reverses_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."document_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_settlements_document" ON "document_settlements" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_settlements_counter" ON "document_settlements" USING btree ("counter_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_settlements_reverses" ON "document_settlements" USING btree ("reverses_id");

-- Verrechnungen sind Buchungen ohne Geldfluss: nur anhängen, Aufhebung als Gegenzeile (reverses_id), nie ändern.
CREATE TRIGGER document_settlements_append_only BEFORE UPDATE OR DELETE ON document_settlements
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER document_settlements_audit AFTER INSERT ON document_settlements
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER document_settlements_no_truncate BEFORE TRUNCATE ON document_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
