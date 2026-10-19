-- Photos, a logo and videos an operator adds to their own prepared page after claiming it.
ALTER TABLE "PreparedOperatorPage" ADD COLUMN "operatorMedia" JSONB;
ALTER TABLE "PreparedOperatorPage" ADD COLUMN "operatorMediaAt" TIMESTAMP(3);
