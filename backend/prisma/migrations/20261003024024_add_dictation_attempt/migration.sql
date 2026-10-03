-- CreateTable
CREATE TABLE "DictationAttempt" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "scopeLines" JSONB,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "totalWords" INTEGER NOT NULL,
    "gapCount" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DictationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DictationAttempt_trackId_createdAt_idx" ON "DictationAttempt"("trackId", "createdAt");

-- AddForeignKey
ALTER TABLE "DictationAttempt" ADD CONSTRAINT "DictationAttempt_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
