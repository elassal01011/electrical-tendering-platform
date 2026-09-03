import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { AdminCommandError } from "../src/lib/auth/admin";

export async function runAdminCommand(
  action: (prisma: PrismaClient) => Promise<void>,
) {
  config({ quiet: true }); // .env in the repository root; shell values take precedence.
  let prisma: PrismaClient | undefined;
  try {
    const directUrl = process.env.DIRECT_URL?.trim();
    if (!directUrl)
      throw new AdminCommandError(
        "Set DIRECT_URL before running this administrative command.",
      );
    prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });
    await action(prisma);
  } catch (error) {
    console.error(
      error instanceof AdminCommandError
        ? error.message
        : "Administrative command failed. Check database connectivity, migrations, and configuration. No connection details are logged.",
    );
    process.exitCode = 1;
  } finally {
    if (prisma) {
      try {
        await prisma.$disconnect();
      } catch {
        console.error("Database disconnect failed.");
        process.exitCode = 1;
      }
    }
  }
}
