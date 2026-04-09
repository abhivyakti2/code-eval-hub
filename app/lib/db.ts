//change this later
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
//is this to prevent multiple instances of PrismaClient in development? 
// yes, in development the code is hot reloaded, so if we create 
// a new instance of PrismaClient every time, it will cause issues 
// with too many connections to the database. By storing the instance 
// in a global variable, we can reuse the same instance across 
// hot reloads, and only create a new instance if it doesn't already exist.

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['error'],
  });
  //log is predefined option in PrismaClient that allows us to log 
  // different levels of information like queries, warnings, and errors. 
  // In development, we log all three levels to help with debugging, 
  // but in production, we only log errors to avoid cluttering the logs with too much information.

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;