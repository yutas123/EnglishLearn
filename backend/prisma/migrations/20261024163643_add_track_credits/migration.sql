-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "leadVocalNote" TEXT,
ADD COLUMN     "songwriterNote" TEXT,
ADD COLUMN     "vocalParts" JSONB;
