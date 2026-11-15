CREATE TABLE "mcp_oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"secret_hash" text,
	"name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_oauth_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "oauth_client_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "access_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "refresh_hash" text;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "previous_refresh_hash" text;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_oauth_client_id_mcp_oauth_clients_id_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "public"."mcp_oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_refresh_hash_unique" UNIQUE("refresh_hash");