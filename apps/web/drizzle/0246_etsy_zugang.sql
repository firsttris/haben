CREATE TABLE "etsy_connections" (
	"id" text PRIMARY KEY DEFAULT 'etsy' NOT NULL,
	"keystring" text NOT NULL,
	"shop_id" text DEFAULT '' NOT NULL,
	"shop_name" text DEFAULT '' NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"fetch_from" date NOT NULL,
	"sammelzeilen" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "etsy_connections_id" CHECK ("etsy_connections"."id" = 'etsy')
);
