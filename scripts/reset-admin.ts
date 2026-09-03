import { runAdminCommand } from "./admin-cli";
import { resetAdmin } from "../src/lib/auth/admin";

void runAdminCommand(async (prisma) => {
  await resetAdmin(prisma, process.env);
  console.log(
    "Admin password reset. Account activated, existing sessions revoked, and login lockout cleared.",
  );
});
