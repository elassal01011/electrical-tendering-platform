import { runAdminCommand } from "./admin-cli";
import { checkAdmin } from "../src/lib/auth/admin";

void runAdminCommand(async (prisma) => {
  const status = await checkAdmin(prisma, process.env);
  console.log(`Admin user exists: ${status.exists ? "yes" : "no"}`);
  console.log(`Active: ${status.active ? "yes" : "no"}`);
  console.log(`Role: ${status.superAdmin ? "SUPER_ADMIN" : "not SUPER_ADMIN"}`);
  console.log(`Currently locked out: ${status.locked ? "yes" : "no"}`);
});
