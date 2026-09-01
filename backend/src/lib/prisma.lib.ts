
import { PrismaClient } from '@prisma/client'
import { config } from '../config/env.config.js'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient()

if (config.app.environment !== 'production') {
  globalForPrisma.prisma = prisma
}
