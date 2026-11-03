ALTER TABLE "contacts" ADD COLUMN "is_customer" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_supplier" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lieferantennummer" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "supplier_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_supplier_contact_id_contacts_id_fk" FOREIGN KEY ("supplier_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;