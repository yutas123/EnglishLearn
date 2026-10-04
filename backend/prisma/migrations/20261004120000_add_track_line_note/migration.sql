-- CreateTable
CREATE TABLE "TrackLineNote" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackLineNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackLineNote_trackId_lineIndex_key" ON "TrackLineNote"("trackId", "lineIndex");

-- AddForeignKey
ALTER TABLE "TrackLineNote" ADD CONSTRAINT "TrackLineNote_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
