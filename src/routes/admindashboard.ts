import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.js";
import { adminOnly } from "../middlewares/adminOnly.js";
import { prisma } from "../lib/prisma.js";

const adminDashboard = new Hono();

adminDashboard
  .use("*", authMiddleware, adminOnly)

  .get("/userdailyactive/:year?/:month?", async (c) => {
    const yearParam = c.req.param("year");
    const monthParam = c.req.param("month");

    let buddhistYear = yearParam ? parseInt(yearParam, 10) : null;
    if (!buddhistYear) {
      const now = new Date();
      buddhistYear = now.getFullYear() + 543;
    }
    const christianYear = buddhistYear - 543;

    let startDate: Date;
    let endDate: Date;
    if (monthParam) {
      const month = parseInt(monthParam, 10) - 1;
      startDate = new Date(christianYear, month, 1);
      endDate = new Date(christianYear, month + 1, 1);
    } else {
      startDate = new Date(christianYear, 0, 1);
      endDate = new Date(christianYear + 1, 0, 1);
    }

    const distinctYears = await prisma.userDailyActive.findMany({
      select: { date: true },
      distinct: ["date"],
      orderBy: { date: "asc" },
    });

    const availableYears = [
      ...new Set(
        distinctYears.map((u) => new Date(u.date).getFullYear() + 543)
      ),
    ].sort((a, b) => b - a);

    let chart: { label: string; count: number }[] = [];

    if (monthParam) {
      const daily = await prisma.userDailyActive.groupBy({
        by: ["date", "userId"],
        where: {
          date: {
            gte: startDate,
            lt: endDate,
          },
        },
      });

      const grouped: Record<string, Set<string>> = {};
      daily.forEach((u) => {
        const key = new Date(u.date).toLocaleDateString("en-US", {
          day: "numeric",
        });
        if (!grouped[key]) grouped[key] = new Set();
        grouped[key].add(u.userId);
      });

      chart = Object.entries(grouped).map(([label, users]) => ({
        label,
        count: users.size,
      }));
    } else {
      const monthly = await prisma.userDailyActive.groupBy({
        by: ["date", "userId"],
        where: {
          date: {
            gte: startDate,
            lt: endDate,
          },
        },
      });

      const grouped: Record<string, Set<string>> = {};
      monthly.forEach((u) => {
        const key = new Date(u.date).toLocaleDateString("en-US", {
          month: "long",
        });
        if (!grouped[key]) grouped[key] = new Set();
        grouped[key].add(u.userId);
      });

      chart = Object.entries(grouped).map(([label, users]) => ({
        label,
        count: users.size,
      }));
    }

    return c.json({
      message: "ok",
      data: {
        year: buddhistYear,
        month: monthParam ? parseInt(monthParam, 10) : null,
        availableYears,
        chart,
      },
    });
  })

  .get("/users", async (c) => {
    const count = await prisma.user.count();

    return c.json({ message: "ok", totalUsers: count });
  })

  .get("/events", async (c) => {
    const count = await prisma.event.count();

    return c.json({ message: "ok", totalEvents: count });
  });

export default adminDashboard;
