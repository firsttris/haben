CREATE TABLE "vat_return_filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vat_return_id" uuid NOT NULL,
	"filed_on" date NOT NULL,
	"transfer_ticket" text NOT NULL,
	"kz83" integer NOT NULL,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "vat_return_id" uuid;--> statement-breakpoint
ALTER TABLE "vat_return_filings" ADD CONSTRAINT "vat_return_filings_vat_return_id_vat_returns_id_fk" FOREIGN KEY ("vat_return_id") REFERENCES "public"."vat_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vat_return_filings_return" ON "vat_return_filings" USING btree ("vat_return_id");--> statement-breakpoint
CREATE INDEX "vat_return_filings_sha256" ON "vat_return_filings" USING btree ("sha256");--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_vat_return_id_vat_returns_id_fk" FOREIGN KEY ("vat_return_id") REFERENCES "public"."vat_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_vat_return" ON "allocations" USING btree ("vat_return_id");--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_vat_return_kind" CHECK ("allocations"."vat_return_id" is null or "allocations"."kind" = 'ustVorauszahlung');