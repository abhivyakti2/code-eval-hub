/*
  Warnings:

  - You are about to drop the column `feature` on the `Message` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Message" DROP COLUMN "feature",
ADD COLUMN     "features" "MessageFeature"[] DEFAULT ARRAY[]::"MessageFeature"[];
