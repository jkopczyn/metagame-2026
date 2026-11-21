-- Metagame 2026 is over; everything sold before the year column, except the 2027 Egg Tier, admitted to it.
UPDATE "tickets" SET "year" = 2026 WHERE "tier" IS DISTINCT FROM 'Metagame 2027 - Egg Tier';
