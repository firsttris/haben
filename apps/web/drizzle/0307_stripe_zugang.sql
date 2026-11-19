CREATE TABLE "stripe_connections" (
	"id" text PRIMARY KEY DEFAULT 'stripe' NOT NULL,
	"account_id" text NOT NULL,
	"key_hint" text DEFAULT '' NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"fetch_from" date NOT NULL,
	"abruf_start" date NOT NULL,
	"rhythmus" text DEFAULT 'taeglich' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_connections_id" CHECK ("stripe_connections"."id" = 'stripe'),
	CONSTRAINT "stripe_connections_rhythmus" CHECK ("stripe_connections"."rhythmus" in ('stuendlich', 'taeglich', 'woechentlich'))
);
