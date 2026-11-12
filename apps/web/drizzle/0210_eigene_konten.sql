CREATE TABLE "own_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kontenrahmen" "kontenrahmen" NOT NULL,
	"account" text NOT NULL,
	"name" text NOT NULL,
	"parent_category" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "own_accounts_nummer" CHECK ("own_accounts"."account" ~ '^[0-9]{4}$'),
	CONSTRAINT "own_accounts_name" CHECK (length(btrim("own_accounts"."name")) between 1 and 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "own_accounts_nummer_key" ON "own_accounts" USING btree ("kontenrahmen","account");