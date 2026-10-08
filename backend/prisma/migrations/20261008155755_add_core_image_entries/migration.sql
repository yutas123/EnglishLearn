-- AlterTable
ALTER TABLE "CoreImageNote" ADD COLUMN     "lemma" TEXT;

-- CreateTable
CREATE TABLE "CoreImageEntry" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "coreImage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoreImageEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoreImageUsage" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "selectedText" TEXT NOT NULL,
    "roleInLine" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoreImageUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoreImageIllustration" (
    "entryId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoreImageIllustration_pkey" PRIMARY KEY ("entryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoreImageEntry_term_key" ON "CoreImageEntry"("term");

-- CreateIndex
CREATE INDEX "CoreImageUsage_trackId_idx" ON "CoreImageUsage"("trackId");

-- CreateIndex
CREATE INDEX "CoreImageUsage_entryId_idx" ON "CoreImageUsage"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "CoreImageUsage_trackId_lineIndex_selectedText_key" ON "CoreImageUsage"("trackId", "lineIndex", "selectedText");

-- AddForeignKey
ALTER TABLE "CoreImageUsage" ADD CONSTRAINT "CoreImageUsage_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CoreImageEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoreImageUsage" ADD CONSTRAINT "CoreImageUsage_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoreImageIllustration" ADD CONSTRAINT "CoreImageIllustration_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CoreImageEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
