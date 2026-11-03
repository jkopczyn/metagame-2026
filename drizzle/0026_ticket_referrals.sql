ALTER TABLE "tickets" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "referred_by_payment_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_referred_by_payment_id_tickets_payment_id_fk" FOREIGN KEY ("referred_by_payment_id") REFERENCES "public"."tickets"("payment_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_referred_by_payment_id_idx" ON "tickets" USING btree ("referred_by_payment_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_referralCode_unique" UNIQUE("referral_code");