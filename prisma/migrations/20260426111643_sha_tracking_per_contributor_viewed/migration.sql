/*
  Warnings:

  - The values [repo_summary,contributors_summary] on the enum `MessageFeature` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `commitSha` on the `Chat` table. All the data in the column will be lost.
  - You are about to drop the column `faissUri` on the `Contributor` table. All the data in the column will be lost.
  - You are about to drop the column `repoFaissUri` on the `Repository` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "MessageFeature_new" AS ENUM ('generate_questions', 'repo_chat');
ALTER TABLE "public"."Message" ALTER COLUMN "features" DROP DEFAULT;
ALTER TABLE "Message" ALTER COLUMN "features" TYPE "MessageFeature_new"[] USING ("features"::text::"MessageFeature_new"[]);
ALTER TYPE "MessageFeature" RENAME TO "MessageFeature_old";
ALTER TYPE "MessageFeature_new" RENAME TO "MessageFeature";
DROP TYPE "public"."MessageFeature_old";
ALTER TABLE "Message" ALTER COLUMN "features" SET DEFAULT ARRAY[]::"MessageFeature"[];
COMMIT;

-- AlterTable
ALTER TABLE "Chat" DROP COLUMN "commitSha",
ADD COLUMN     "lastChatSha" TEXT,
ADD COLUMN     "lastViewedSummarySha" TEXT;

-- AlterTable
ALTER TABLE "Contributor" DROP COLUMN "faissUri",
ADD COLUMN     "lastSummarySha" TEXT;

-- AlterTable
ALTER TABLE "Repository" DROP COLUMN "repoFaissUri",
ADD COLUMN     "lastSummarySha" TEXT,
ADD COLUMN     "repoSummary" TEXT;

-- CreateTable
CREATE TABLE "ChatContribViewedSha" (
    "chatId" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "viewedSha" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatContribViewedSha_pkey" PRIMARY KEY ("chatId","contributorId")
);

-- CreateIndex
CREATE INDEX "ChatContribViewedSha_chatId_idx" ON "ChatContribViewedSha"("chatId");

-- AddForeignKey
ALTER TABLE "ChatContribViewedSha" ADD CONSTRAINT "ChatContribViewedSha_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatContribViewedSha" ADD CONSTRAINT "ChatContribViewedSha_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "Contributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
