ALTER TABLE "allocations" ADD COLUMN "split_id" uuid;--> statement-breakpoint
CREATE INDEX "allocations_split" ON "allocations" USING btree ("split_id");