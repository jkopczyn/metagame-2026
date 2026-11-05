CREATE TABLE "hat_steals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hat_id" text NOT NULL,
	"user_id" text NOT NULL,
	"stolen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hat_steals_hat_id_known" CHECK ("hat_steals"."hat_id" in ('wizard', 'saucer', 'fuzzy', 'slouch', 'tricorn', 'crown'))
);
--> statement-breakpoint
ALTER TABLE "hat_steals" ADD CONSTRAINT "hat_steals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hat_steals" ADD CONSTRAINT "hat_steals_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hat_steals_hat_stolen_at_idx" ON "hat_steals" USING btree ("hat_id","stolen_at");