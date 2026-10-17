CREATE TABLE IF NOT EXISTS "StudyGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "focus" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "sessionSlot" TEXT NOT NULL,
  "batch" TEXT NOT NULL DEFAULT '',
  "band" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "tenantId" TEXT,
  CONSTRAINT "StudyGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudyGroup_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudyGroup_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudyGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "StudyGroupMember" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudyGroupMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudyGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudyGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "StudyGroup_tenantId_branchId_level_sessionSlot_batch_band_expiresAt_idx"
  ON "StudyGroup"("tenantId", "branchId", "level", "sessionSlot", "batch", "band", "expiresAt");
CREATE INDEX IF NOT EXISTS "StudyGroup_ownerUserId_expiresAt_idx"
  ON "StudyGroup"("ownerUserId", "expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "StudyGroupMember_groupId_userId_key"
  ON "StudyGroupMember"("groupId", "userId");
CREATE INDEX IF NOT EXISTS "StudyGroupMember_userId_joinedAt_idx"
  ON "StudyGroupMember"("userId", "joinedAt");
