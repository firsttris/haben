CREATE TABLE "asset_depreciations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"depreciation" integer NOT NULL,
	"disposal" integer DEFAULT 0 NOT NULL,
	"entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"method" text NOT NULL,
	"account" text NOT NULL,
	"acquisition_date" date NOT NULL,
	"cost" integer NOT NULL,
	"useful_life_months" smallint,
	"document_id" uuid,
	"opening_date" date,
	"opening_book_value" integer,
	"opening_entry_id" uuid,
	"disposal_date" date,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_document_id_unique" UNIQUE("document_id"),
	CONSTRAINT "assets_opening_complete" CHECK (("assets"."opening_date" is null) = ("assets"."opening_book_value" is null)),
	CONSTRAINT "assets_cost_positive" CHECK ("assets"."cost" > 0)
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "asset" jsonb;--> statement-breakpoint
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_depreciations_year" ON "asset_depreciations" USING btree ("asset_id","year");