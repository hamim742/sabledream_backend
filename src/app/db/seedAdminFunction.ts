import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";

type TSeedAdminResult =
  | { status: "skipped"; reason: string }
  | { status: "exists"; adminId: string; email: string }
  | { status: "created"; adminId: string; email: string };

export const seedAdminFunction = async (): Promise<TSeedAdminResult> => {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  const name = (process.env.ADMIN_SEED_NAME || "Admin").trim() || "Admin";
  if (!email || !password) {
    return {
      status: "skipped",
      reason: "Missing ADMIN_SEED_EMAIL or ADMIN_SEED_PASSWORD",
    };
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true },
  });

  if (existing) {
    if (existing.role !== "admin") {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: "admin", status: "active", isVerified: true },
      });
      console.log(`[SeedAdmin] User ${email} promoted to admin.`);
      return { status: "created", adminId: existing.id, email: existing.email };
    }

    return { status: "exists", adminId: existing.id, email: existing.email };
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const created = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      provider: "EMAIL",
      role: "admin",
      status: "active",
      isVerified: true,
    },
    select: { id: true, email: true },
  });

  return { status: "created", adminId: created.id, email: created.email };
};
