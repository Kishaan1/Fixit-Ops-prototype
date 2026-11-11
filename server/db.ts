import type { PrismaClient } from '@prisma/client'
import { createSheetsClient } from './sheets/engine'

// The Google Sheets client is Prisma-compatible. Route code keeps the familiar
// Prisma model API and its TypeScript types, while every read and write is
// served by the Apps Script gateway and the existing spreadsheet.
export const prisma = createSheetsClient() as unknown as PrismaClient
