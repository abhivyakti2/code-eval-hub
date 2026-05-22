-- DropIndex
DROP INDEX "Chat_repositoryId_idx";

-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "contribIngested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "repoIngested" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Chat_userId_idx" ON "Chat"("userId");
