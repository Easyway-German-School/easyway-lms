-- AlterTable
ALTER TABLE "ExamBooking" DROP COLUMN "nurture3DaySent",
ADD COLUMN     "countryOfBirth" TEXT NOT NULL,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "idExpiry" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "idNumber" TEXT NOT NULL,
ADD COLUMN     "idType" TEXT NOT NULL,
ADD COLUMN     "isRepeatAttempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nationality" TEXT NOT NULL,
ADD COLUMN     "nurtureDayBeforeSent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "specialNeeds" TEXT;

-- AlterTable
ALTER TABLE "ExamSession" ADD COLUMN     "examFormat" TEXT NOT NULL DEFAULT 'paper';
