import { PrismaClient } from '@prisma/client';
//this is the prisma client we created using .schema file with help of JS library, and it allows us to interact with our database using JavaScript/TypeScript instead of raw SQL queries.


const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
//is this to prevent multiple instances of PrismaClient in development? Like singleton pattern? Yes, exactly. In development, Next.js hot reloads the code whenever you make changes, which can lead to multiple instances of PrismaClient being created if we instantiate it directly in the module scope. This can cause issues with too many connections to the database. By using a global variable to store the PrismaClient instance, we ensure that we reuse the same instance across hot reloads, and only create a new instance if it doesn't already exist.
// yes, in development the code is hot reloaded, so if we create 
// a new instance of PrismaClient every time, it will cause issues 
// with too many connections to the database. By storing the instance 
// in a global variable, we can reuse the same instance across 
// hot reloads, and only create a new instance if it doesn't already exist.
// In production, this is not an issue because the code is not hot reloaded, so we can safely create a new instance of PrismaClient without worrying about multiple instances.
//as unknown is used to tell TypeScript to treat globalThis as an object that can have any properties, and then we specify that it has a prisma property of type PrismaClient. This allows us to store the PrismaClient instance in globalThis without TypeScript throwing an error about unknown properties. later we can add more properties to globalForPrisma if needed, and TypeScript will still allow it because of the use of unknown.


//creating an instance of PrismaClient and exporting it for use in other parts of the application. This instance will be used to interact with the database throughout the app.
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

// when prisma is exported, whole file is executed? Yes, when we import prisma from this file, the entire file is executed, which means that the code to create the PrismaClient instance and assign it to globalForPrisma.prisma will run. This ensures that we have a single instance of PrismaClient that is reused across the application, especially in development where hot reloading can cause multiple instances to be created.