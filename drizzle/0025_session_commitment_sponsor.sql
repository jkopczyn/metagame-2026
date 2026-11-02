ALTER TABLE "sessions" ADD COLUMN "rsvp_is_commitment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "sponsored" boolean DEFAULT false NOT NULL;