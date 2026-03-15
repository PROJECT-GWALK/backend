import { prisma } from "./prisma.js";

function cleanIp(ip: string): string {
  // Handle multiple IPs (x-forwarded-for can be comma separated)
  let clean = ip.split(',')[0].trim();
  
  // Handle IPv6 localhost
  if (clean === '::1') return '127.0.0.1';
  
  // Handle IPv4-mapped IPv6
  if (clean.startsWith('::ffff:')) return clean.substring(7);
  
  return clean;
}

export async function createLog(
  userId: string | null,
  action: string,
  details: string | null,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    const finalIp = ipAddress ? cleanIp(ipAddress) : null;
    await prisma.systemLog.create({
      data: {
        userId,
        action,
        details,
        ipAddress: finalIp,
        userAgent: userAgent || null,
      },
    });
  } catch (e) {
    console.error("Failed to create log:", e);
  }
}
