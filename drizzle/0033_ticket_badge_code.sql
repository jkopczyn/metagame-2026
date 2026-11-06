ALTER TABLE "tickets" ADD COLUMN "badge_code" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_badgeCode_unique" UNIQUE("badge_code");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_badge_code_range" CHECK ("tickets"."badge_code" between 0 and 9999);