-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'text',
ADD COLUMN     "gameMatchId" TEXT;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_gameMatchId_fkey" FOREIGN KEY ("gameMatchId") REFERENCES "GameMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
