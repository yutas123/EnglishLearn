-- CreateTable
CREATE TABLE "CoreImageNote" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "selectedText" TEXT NOT NULL,
    "coreImage" TEXT NOT NULL,
    "roleInLine" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoreImageNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoreImageNote_trackId_lineIndex_selectedText_key" ON "CoreImageNote"("trackId", "lineIndex", "selectedText");

-- AddForeignKey
ALTER TABLE "CoreImageNote" ADD CONSTRAINT "CoreImageNote_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
