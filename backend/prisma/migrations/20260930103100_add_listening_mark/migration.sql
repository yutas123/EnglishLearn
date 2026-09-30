-- CreateTable
CREATE TABLE "ListeningMark" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListeningMark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListeningMark_trackId_lineIndex_key" ON "ListeningMark"("trackId", "lineIndex");

-- AddForeignKey
ALTER TABLE "ListeningMark" ADD CONSTRAINT "ListeningMark_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
