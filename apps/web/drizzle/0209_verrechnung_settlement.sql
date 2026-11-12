ALTER TABLE "document_settlements" ADD COLUMN "settlement_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE INDEX "document_settlements_settlement" ON "document_settlements" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_settlements_settlement_document" ON "document_settlements" USING btree ("settlement_id","document_id");