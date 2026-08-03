-- AddColumn to ResultatEndoscopie
ALTER TABLE "ResultatEndoscopie" ADD COLUMN "publicToken" TEXT,
ADD COLUMN "isPublicShared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sharedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "ResultatEndoscopie_publicToken_key" ON "ResultatEndoscopie"("publicToken");

-- CreateIndex
CREATE INDEX "ResultatEndoscopie_publicToken_idx" ON "ResultatEndoscopie"("publicToken");
