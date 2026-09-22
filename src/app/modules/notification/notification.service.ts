import { prisma } from "../../lib/prisma";
import AppError from "../../error/AppError";
import httpStatus from "http-status";

const getUserNotifications = async (
  userId: string,
  query: { page?: string; limit?: string }
) => {
  const page = parseInt(query.page || "1", 10);
  const limit = parseInt(query.limit || "10", 10);
  const skip = (page - 1) * limit;

  // Client rule: In-app notifications are ONLY:
  // a) You have reached 90% capacity for sable chat
  // b) Sable chat capacity has been increased
  const whereClause = {
    userId,
    OR: [
      {
        title: {
          in: [
            "You have reached 90% capacity for sable chat",
            "AI Chat Warning",
            "Sable chat capacity has been increased",
            "Your Sable capacity has been increased.",
          ],
        },
      },
      {
        AND: [
          {
            OR: [
              { title: { contains: "capacity", mode: "insensitive" as const } },
              { body: { contains: "capacity", mode: "insensitive" as const } },
              { body: { contains: "90%", mode: "insensitive" as const } },
            ],
          },
          {
            NOT: {
              OR: [
                { title: { contains: "book", mode: "insensitive" as const } },
                { title: { contains: "reading", mode: "insensitive" as const } },
                { title: { contains: "journal", mode: "insensitive" as const } },
                { title: { contains: "mood", mode: "insensitive" as const } },
                { title: { contains: "affirmation", mode: "insensitive" as const } },
                { title: { contains: "manifestation", mode: "insensitive" as const } },
              ],
            },
          },
        ],
      },
    ],
  };

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.notification.count({
      where: whereClause,
    }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    meta: {
      page,
      limit,
      total,
      totalPages,
    },
    data: notifications,
  };
};

const markNotificationAsRead = async (userId: string, notificationId: string) => {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification) {
    throw new AppError(httpStatus.NOT_FOUND, "Notification not found");
  }

  if (notification.userId !== userId) {
    throw new AppError(httpStatus.FORBIDDEN, "Access forbidden");
  }

  const updatedNotification = await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });

  return updatedNotification;
};

const markAllNotificationsAsRead = async (userId: string) => {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });

  return {
    message: "All notifications marked as read successfully",
    modifiedCount: result.count,
  };
};

const deleteNotification = async (userId: string, notificationId: string) => {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification) {
    throw new AppError(httpStatus.NOT_FOUND, "Notification not found");
  }

  if (notification.userId !== userId) {
    throw new AppError(httpStatus.FORBIDDEN, "Access forbidden");
  }

  await prisma.notification.delete({
    where: { id: notificationId },
  });

  return { message: "Notification deleted successfully" };
};

export const NotificationService = {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
};
