import { prisma } from "./prisma.js";

export async function createLog(
  userId: string | null,
  action: string,
  details: string | null,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    await prisma.systemLog.create({
      data: {
        userId,
        action,
        details,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });
  } catch (e) {
    console.error("Failed to create log:", e);
  }
}
