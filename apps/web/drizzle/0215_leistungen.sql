CREATE TABLE "service_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"worked_on" date NOT NULL,
	"minutes" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"hourly_rate_cents" integer,
	"non_billable" boolean DEFAULT false NOT NULL,
	"billable_minutes" integer,
	"project" text DEFAULT '' NOT NULL,
	"external_source" text,
	"external_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_entries_minutes" CHECK ("service_entries"."minutes" between 1 and 1440),
	CONSTRAINT "service_entries_billable_minutes" CHECK ("service_entries"."billable_minutes" is null or "service_entries"."billable_minutes" between 1 and 1440),
	CONSTRAINT "service_entries_rate" CHECK ("service_entries"."hourly_rate_cents" is null or "service_entries"."hourly_rate_cents" >= 0),
	CONSTRAINT "service_entries_extern" CHECK (("service_entries"."external_source" is null) = ("service_entries"."external_id" is null))
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "hourly_rate_cents" integer;--> statement-breakpoint
ALTER TABLE "service_entries" ADD CONSTRAINT "service_entries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_entries_extern_key" ON "service_entries" USING btree ("external_source","external_id");--> statement-breakpoint
CREATE INDEX "service_entries_contact" ON "service_entries" USING btree ("contact_id","worked_on");