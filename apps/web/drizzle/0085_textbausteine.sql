CREATE TABLE "text_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"contact_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "text_blocks_kind" CHECK ("text_blocks"."kind" in ('kopf', 'fuss'))
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "intro" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "intro" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN "intro" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "text_blocks" ADD CONSTRAINT "text_blocks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "text_blocks_contact" ON "text_blocks" USING btree ("contact_id");
