-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "ExamSession" (
    "id" TEXT NOT NULL,
    "examBody" TEXT NOT NULL DEFAULT 'ÖSD',
    "level" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "venueName" TEXT NOT NULL,
    "venueAddress" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "registrationDeadline" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "feeWholeExam" INTEGER NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamModulePrice" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "ExamModulePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamBooking" (
    "id" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Nigeria',
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "placeOfBirth" TEXT NOT NULL,
    "modules" TEXT[],
    "feeTotal" INTEGER NOT NULL,
    "paymentMethod" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "transferProofUrl" TEXT,
    "transferReference" TEXT,
    "transferRejectedReason" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "passportPhotoUrl" TEXT,
    "passportDataPageUrl" TEXT,
    "documentStatus" TEXT NOT NULL DEFAULT 'pending',
    "documentRejectedReason" TEXT,
    "seatNumber" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "nurtureDay2Sent" BOOLEAN NOT NULL DEFAULT false,
    "nurtureWeekSent" BOOLEAN NOT NULL DEFAULT false,
    "nurture3DaySent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExamSession_published_startDate_idx" ON "ExamSession"("published", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExamModulePrice_sessionId_module_key" ON "ExamModulePrice"("sessionId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "ExamBooking_referenceCode_key" ON "ExamBooking"("referenceCode");

-- CreateIndex
CREATE INDEX "ExamBooking_sessionId_idx" ON "ExamBooking"("sessionId");

-- CreateIndex
CREATE INDEX "ExamBooking_email_idx" ON "ExamBooking"("email");

-- CreateIndex
CREATE INDEX "ExamBooking_paymentStatus_idx" ON "ExamBooking"("paymentStatus");

-- CreateIndex
CREATE INDEX "SupportMessage_status_createdAt_idx" ON "SupportMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_bookingId_idx" ON "SupportMessage"("bookingId");

-- AddForeignKey
ALTER TABLE "ExamModulePrice" ADD CONSTRAINT "ExamModulePrice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamBooking" ADD CONSTRAINT "ExamBooking_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExamSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ExamBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

