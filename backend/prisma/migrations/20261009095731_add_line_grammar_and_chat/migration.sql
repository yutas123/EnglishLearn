-- CreateTable
CREATE TABLE "LineGrammar" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "original" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineGrammar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineChatMessage" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LineGrammar_trackId_lineIndex_key" ON "LineGrammar"("trackId", "lineIndex");

-- CreateIndex
CREATE INDEX "LineChatMessage_trackId_lineIndex_createdAt_idx" ON "LineChatMessage"("trackId", "lineIndex", "createdAt");

-- AddForeignKey
ALTER TABLE "LineGrammar" ADD CONSTRAINT "LineGrammar_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineChatMessage" ADD CONSTRAINT "LineChatMessage_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
