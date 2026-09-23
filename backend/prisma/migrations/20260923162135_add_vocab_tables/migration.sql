-- AlterTable
ALTER TABLE "Translation" ADD COLUMN     "hardSpans" JSONB;

-- CreateTable
CREATE TABLE "VocabEntry" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "surfaceForm" TEXT NOT NULL,
    "isPhrase" BOOLEAN NOT NULL DEFAULT false,
    "meaning" TEXT NOT NULL,
    "partOfSpeech" TEXT,
    "cefr" TEXT,
    "sourceTrackId" TEXT NOT NULL,
    "sourceLineIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "nextReviewAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReviewedAt" TIMESTAMP(3),

    CONSTRAINT "VocabEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocabOccurrence" (
    "id" TEXT NOT NULL,
    "vocabEntryId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VocabOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpanExplanation" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "selectedText" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpanExplanation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VocabEntry_nextReviewAt_idx" ON "VocabEntry"("nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "VocabEntry_term_isPhrase_key" ON "VocabEntry"("term", "isPhrase");

-- CreateIndex
CREATE UNIQUE INDEX "VocabOccurrence_vocabEntryId_trackId_lineIndex_key" ON "VocabOccurrence"("vocabEntryId", "trackId", "lineIndex");

-- CreateIndex
CREATE UNIQUE INDEX "SpanExplanation_trackId_lineIndex_selectedText_key" ON "SpanExplanation"("trackId", "lineIndex", "selectedText");

-- AddForeignKey
ALTER TABLE "VocabEntry" ADD CONSTRAINT "VocabEntry_sourceTrackId_fkey" FOREIGN KEY ("sourceTrackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabOccurrence" ADD CONSTRAINT "VocabOccurrence_vocabEntryId_fkey" FOREIGN KEY ("vocabEntryId") REFERENCES "VocabEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabOccurrence" ADD CONSTRAINT "VocabOccurrence_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpanExplanation" ADD CONSTRAINT "SpanExplanation_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
