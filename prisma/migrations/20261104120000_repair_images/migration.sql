-- CreateTable
CREATE TABLE "RepairImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repairId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "caption" TEXT,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepairImage_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "Repair" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RepairImage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RepairImage_repairId_kind_createdAt_idx" ON "RepairImage"("repairId", "kind", "createdAt");
