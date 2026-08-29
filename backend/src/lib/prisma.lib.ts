
import { PrismaClient } from '@prisma/client'
import { config } from '../config/env.config.js'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient({
  log: config.app.environment === 'development' ? ['query', 'error', 'warn'] : ['error'],
})

if (config.app.environment !== 'production') {
  globalForPrisma.prisma = prisma
}
