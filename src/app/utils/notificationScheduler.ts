import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { sendPushNotification } from "./sendNotification";
import { ChatService } from "../modules/chat/chat.service";
import { SubscriptionService } from "../modules/subscription/subscription.service";

const defaultTimeZone = "America/New_York";

type ReminderLocalParts = {
  time: string;
  dayOfMonth: number;
  dayOfWeek: string;
  isLastDayOfMonth: boolean;
};

const getReminderLocalParts = (date: Date, timeZone: string): ReminderLocalParts | null => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      day: "numeric",
      month: "numeric",
      year: "numeric",
      weekday: "short",
    });

    const parts = formatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

    const year = Number(parts.year);
    const month = Number(parts.month);
    const dayOfMonth = Number(parts.day);
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    return {
      time: `${parts.hour}:${parts.minute}`,
      dayOfMonth,
      dayOfWeek: parts.weekday.toUpperCase(),
      isLastDayOfMonth: dayOfMonth === lastDayOfMonth,
    };
  } catch (error) {
    console.error(`[SCHEDULER] Invalid reminder timezone "${timeZone}":`, error);
    return null;
  }
};

// Helper to fetch a dynamic affirmation from the database
const getRandomAffirmation = async (goal?: string) => {
  try {
    const whereClause: any = {};
    if (goal) {
      whereClause.goal = goal;
    }
    const count = await prisma.affirmation.count({ where: whereClause });
    if (count === 0) return null;

    const skip = Math.floor(Math.random() * count);
    const affirmations = await prisma.affirmation.findMany({
      where: whereClause,
      skip,
      take: 1,
    });
    return affirmations[0];
  } catch (error) {
    console.error("[SCHEDULER] Failed to fetch dynamic affirmation:", error);
    return null;
  }
};

export const startNotificationScheduler = () => {
  // Run every minute to check and trigger scheduled notifications.
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();



      // Reminder time is compared in each user's timezone, not the server timezone.
      const reminders = await prisma.reminder.findMany({
        where: {
          enabled: true,
        },
      });

      for (const reminder of reminders) {
        const localParts = getReminderLocalParts(now, reminder.timeZone || defaultTimeZone);
        if (!localParts || localParts.time !== reminder.time) continue;

        const user = await prisma.user.findUnique({
          where: { id: reminder.userId },
        });

        if (!user) {
          // Auto cleanup of orphaned reminders
          await prisma.reminder.delete({ where: { id: reminder.id } }).catch(() => {});
          continue;
        }

        if (!user.fcmToken) continue;
        const fcmToken = user.fcmToken;

        const monthlyDue =
          reminder.daysOfMonth.includes(localParts.dayOfMonth) ||
          (reminder.monthlyLastDayEnabled && localParts.isLastDayOfMonth);

        // Disabled per client instruction: "❌NO JOURNAL NOTIFICATION"
        if (reminder.type === "journal") {
          // Journal notifications disabled
        } else if (reminder.type === "mood") {
          // Disabled per client instruction: "❌NO MOOD NOTIFICATION"
          /*
          if (reminder.dailyEnabled) {
            await sendPushNotification(
              fcmToken,
              "Mood Reminder",
              "How is your energy? Select your mood for today 💖",
              {
                screen: "mood",
                frequency: "daily",
              }
            );
          }
          if (reminder.weeklyEnabled && reminder.daysOfWeek.includes(localParts.dayOfWeek)) {
            await sendPushNotification(
              fcmToken,
              "Mood Reminder",
              "Your mood this week - A weekly overview of your emotional patterns. The woman who feels deeply, heals deeply - see your journey unfold.",
              {
                screen: "mood",
                frequency: "weekly",
              }
            );
          }
          if (reminder.monthlyEnabled && monthlyDue) {
            await sendPushNotification(
              fcmToken,
              "Mood Reminder",
              "Moments of becoming - Every emotion you named this month was a step into your becoming. A monthly look at the emotional growth you have made.",
              {
                screen: "mood",
                frequency: "monthly",
              }
            );
          }
          */
        } else if (reminder.type === "affirmation") {
          // Disabled per client instruction: "❌NO REFLECTION NOTIFICATIONS"
        }
      }
    } catch (error) {
      console.error("[SCHEDULER] Error running reminder notification scheduler:", error);
    }
  });


  // Daily reading recommendation push disabled per client instruction: "❌NO READING NOTIFICATION"
  // cron.schedule("0 4 * * *", async () => { ... }, { timezone: "America/New_York" });


  // Monthly cron job at 12:00 AM on the 1st day of every month to reset all users' monthlyTokenLimit to default and reset proxy token baselines.
  cron.schedule(
    "0 0 1 * *",
    async () => {
      try {
        await ChatService.performMonthlyReset();
      } catch (error) {
        console.error("[SCHEDULER] Error running monthly token limit reset:", error);
      }
    },
    {
      timezone: "America/New_York",
    }
  );

  // Sync active/trial RevenueCat subscriptions every 5 minutes to catch cancellations, renewals, billing issues, and expirations
  cron.schedule("*/5 * * * *", async () => {
    try {
      await SubscriptionService.syncActiveSubscriptionsCron();
    } catch (error) {
      console.error("[SCHEDULER] Error running RevenueCat subscription sync cron:", error);
    }
  });

  // Also run an initial sync check 10 seconds after server start
  setTimeout(() => {
    SubscriptionService.syncActiveSubscriptionsCron().catch((error) => {
      console.error("[SCHEDULER] Error running initial RevenueCat subscription sync:", error);
    });
  }, 10000);
};
