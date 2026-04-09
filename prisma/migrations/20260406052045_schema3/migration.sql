/*
  Warnings:

  - You are about to drop the column `title` on the `Chat` table. All the data in the column will be lost.
  - You are about to drop the column `faissUploadedAt` on the `Contributor` table. All the data in the column will be lost.
  - You are about to drop the column `questionType` on the `GeneratedQuestion` table. All the data in the column will be lost.
  - You are about to drop the column `forks` on the `Repository` table. All the data in the column will be lost.
  - You are about to drop the column `lastIngestedAt` on the `Repository` table. All the data in the column will be lost.
  - You are about to drop the column `repoFaissUploadedAt` on the `Repository` table. All the data in the column will be lost.
  - You are about to drop the column `stars` on the `Repository` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Repository` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[githubId]` on the table `Repository` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `chatId` to the `GeneratedQuestion` table without a default value. This is not possible if the table is not empty.
  - Added the required column `repositoryId` to the `GeneratedQuestion` table without a default value. This is not possible if the table is not empty.
  - Added the required column `scope` to the `GeneratedQuestion` table without a default value. This is not possible if the table is not empty.
  - Added the required column `feature` to the `Message` table without a default value. This is not possible if the table is not empty.
  - Added the required column `githubId` to the `Repository` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MessageFeature" AS ENUM ('repo_summary', 'contributors_summary', 'generate_questions', 'repo_chat');

-- CreateEnum
CREATE TYPE "QuestionScope" AS ENUM ('contributor', 'repository');

-- DropForeignKey
ALTER TABLE "Repository" DROP CONSTRAINT "Repository_userId_fkey";

-- DropIndex
DROP INDEX "Repository_githubUrl_key";

-- AlterTable
ALTER TABLE "Chat" DROP COLUMN "title",
ADD COLUMN     "commitSha" TEXT;

-- AlterTable
ALTER TABLE "Contributor" DROP COLUMN "faissUploadedAt";

-- AlterTable
ALTER TABLE "GeneratedQuestion" DROP COLUMN "questionType",
ADD COLUMN     "chatId" TEXT NOT NULL,
ADD COLUMN     "repositoryId" TEXT NOT NULL,
ADD COLUMN     "scope" "QuestionScope" NOT NULL,
ALTER COLUMN "contributorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "feature" "MessageFeature" NOT NULL;

-- AlterTable
ALTER TABLE "Repository" DROP COLUMN "forks",
DROP COLUMN "lastIngestedAt",
DROP COLUMN "repoFaissUploadedAt",
DROP COLUMN "stars",
DROP COLUMN "userId",
ADD COLUMN     "githubId" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "Chat_repositoryId_idx" ON "Chat"("repositoryId");

-- CreateIndex
CREATE INDEX "Contributor_repositoryId_idx" ON "Contributor"("repositoryId");

-- CreateIndex
CREATE INDEX "GeneratedQuestion_repositoryId_idx" ON "GeneratedQuestion"("repositoryId");

-- CreateIndex
CREATE INDEX "Message_chatId_idx" ON "Message"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubId_key" ON "Repository"("githubId");

-- AddForeignKey
ALTER TABLE "GeneratedQuestion" ADD CONSTRAINT "GeneratedQuestion_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedQuestion" ADD CONSTRAINT "GeneratedQuestion_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
