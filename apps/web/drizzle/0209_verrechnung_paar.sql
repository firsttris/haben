ALTER TABLE "document_settlements" ADD COLUMN "pair_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE INDEX "document_settlements_pair" ON "document_settlements" USING btree ("pair_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_settlements_pair_document" ON "document_settlements" USING btree ("pair_id","document_id");