CREATE TABLE "paypal_connections" (
	"id" text PRIMARY KEY DEFAULT 'paypal' NOT NULL,
	"account_id" text NOT NULL,
	"key_hint" text DEFAULT '' NOT NULL,
	"sandbox" boolean DEFAULT false NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"zeitzone" text DEFAULT 'Europe/Berlin' NOT NULL,
	"fetch_from" date NOT NULL,
	"abruf_start" date NOT NULL,
	"rhythmus" text DEFAULT 'taeglich' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paypal_connections_id" CHECK ("paypal_connections"."id" = 'paypal'),
	CONSTRAINT "paypal_connections_rhythmus" CHECK ("paypal_connections"."rhythmus" in ('stuendlich', 'taeglich', 'woechentlich'))
);
