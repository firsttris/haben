ALTER TABLE "annual_submissions" ADD COLUMN "filed_on" date;--> statement-breakpoint
ALTER TABLE "annual_submissions" ADD COLUMN "note" text;--> statement-breakpoint
CREATE UNIQUE INDEX "annual_submissions_vermerk" ON "annual_submissions" USING btree ("form","year") WHERE "annual_submissions"."kind" = 'vermerk';