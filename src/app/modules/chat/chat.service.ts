import httpStatus from "http-status";
import AppError from "../../error/AppError";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { SableDreamChatMessageResponse } from "./chat.types";
import { sendPushNotification } from "../../utils/sendNotification";
import { ensurePermanentUserId } from "../../utils/generatePermanentUserId";

export const notifyCapacityIncreased = async (userId: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });

    const title = "Your Sable capacity has been increased.";
    const body = "You can continue your reflection. ✨";

    if (user?.fcmToken) {
      await sendPushNotification(user.fcmToken, title, body, { screen: "chat" }, userId);
    } else {
      await prisma.notification.create({
        data: {
          userId,
          title,
          body,
          data: { screen: "chat" },
        },
      });
    }
  } catch (err) {
    console.error(`[CHAT] Failed to send capacity increased notification to user ${userId}:`, err);
  }
};

const withTrailingSlash = (value: string) => (value.endsWith("/") ? value : `${value}/`);

const buildUrl = (path: string) => {
  const baseUrl = config.sableDreamChat?.baseUrl;
  if (!baseUrl) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Sable Dream chat base URL is not configured (SABLE_DREAM_CHAT_BASE_URL)"
    );
  }
  return new URL(path.replace(/^\//, ""), withTrailingSlash(baseUrl)).toString();
};

const parseErrorBody = async (response: Response) => {
  const contentType = response.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      return await response.json();
    }
    return await response.text();
  } catch {
    return null;
  }
};

const requestSableDreamChat = async <T>(path: string, init: RequestInit, timeoutMs?: number): Promise<T> => {
  const url = buildUrl(path);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? config.sableDreamChat.timeoutMs);

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };

    const apiKey = config.sableDreamChat.apiKey;
    if (apiKey) {
      headers.Authorization = apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await parseErrorBody(response);
      const details =
        errorBody && typeof errorBody === "object"
          ? JSON.stringify(errorBody)
          : typeof errorBody === "string"
            ? errorBody
            : "";

      throw new AppError(
        httpStatus.BAD_GATEWAY,
        `Sable Dream chat service error (${response.status})${details ? `: ${details}` : ""}`
      );
    }

    return (await response.json()) as T;
  } catch (err: any) {
    if (err instanceof AppError) {
      throw err;
    }
    if (err?.name === "AbortError") {
      throw new AppError(httpStatus.GATEWAY_TIMEOUT, "Sable Dream chat service request timed out");
    }
    throw new AppError(httpStatus.BAD_GATEWAY, "Failed to reach Sable Dream chat service");
  } finally {
    clearTimeout(timeout);
  }
};

export const ChatService = {
  async sendMessage(userId: string, message: string) {
    const currentMonth = new Date().toISOString().slice(0, 7);

    // 1. Check global monthly token cap
    const globalCapConfig = await prisma.appConfig.findUnique({
      where: { key: "global_monthly_token_cap" },
    });
    if (globalCapConfig) {
      const globalCap = Number(globalCapConfig.value);
      if (globalCap > 0) {
        const monthlyUsages = await prisma.userMonthlyUsage.aggregate({
          where: { monthYear: currentMonth },
          _sum: { tokensUsed: true },
        });
        const totalUsed = monthlyUsages._sum.tokensUsed ?? 0;
        if (totalUsed >= globalCap) {
          throw new AppError(
            httpStatus.FORBIDDEN,
            "The app-wide monthly token limit has been reached. Please contact administration."
          );
        }
      }
    }

    // 2. Check individual user limit
    const userLimitConfig = await prisma.user.findUnique({
      where: { id: userId },
      select: { monthlyTokenLimit: true },
    });
    const individualLimit = userLimitConfig?.monthlyTokenLimit ?? 50000;

    const userMonthlyUsage = await prisma.userMonthlyUsage.findUnique({
      where: {
        userId_monthYear: {
          userId,
          monthYear: currentMonth,
        },
      },
      select: { tokensUsed: true },
    });
    const userUsed = userMonthlyUsage?.tokensUsed ?? 0;

    if (userUsed >= individualLimit) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You’ve reached your monthly Sable capacity. Your commitment to becoming is beautiful. New messages will open at the start of your next month."
      );
    }

    const result = await requestSableDreamChat<SableDreamChatMessageResponse>(
      "/api/v1/chat/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, message }),
      },
      config.sableDreamChat.timeoutMs
    );

    // Increment message count for this month
    await prisma.userMonthlyUsage.upsert({
      where: {
        userId_monthYear: {
          userId,
          monthYear: currentMonth,
        },
      },
      update: {
        messageCount: { increment: 1 },
      },
      create: {
        userId,
        monthYear: currentMonth,
        messageCount: 1,
      },
    });

    // Asynchronously update and check user token limits/warnings
    this.getUsage(userId)
      .then(async (usageInfo) => {
        await this.checkUsageThresholds(userId, usageInfo.total_tokens, usageInfo.monthlyTokenLimit);
      })
      .catch((err) => {
        console.error(`[CHAT] Failed to verify token usage warning thresholds for user ${userId}:`, err);
      });

    return result;
  },

  async getHistory(userId: string) {
    return requestSableDreamChat<any>(`/api/v1/chat/history/${encodeURIComponent(userId)}`, { method: "GET" });
  },

  async deleteHistory(userId: string) {
    return requestSableDreamChat<any>(`/api/v1/chat/history/${encodeURIComponent(userId)}`, { method: "DELETE" });
  },

  async getMemory(userId: string) {
    return requestSableDreamChat<any>(`/api/v1/chat/memory/${encodeURIComponent(userId)}`, { method: "GET" });
  },

  async getUsage(userId: string, monthYear?: string) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const targetMonth = monthYear || currentMonth;

    // Sync usage data with live proxy first if it is the current month
    if (targetMonth === currentMonth) {
      try {
        const rawUsage = await requestSableDreamChat<any>(`/api/v1/chat/usage/${encodeURIComponent(userId)}`, { method: "GET" });
        if (rawUsage) {
          await this.syncUserUsage(userId, rawUsage);
        }
      } catch (err) {
        console.error(`[CHAT] Failed to sync live usage for user ${userId}:`, err);
      }
    }

    // Retrieve database record for monthly usage
    const monthlyUsage = await prisma.userMonthlyUsage.findUnique({
      where: {
        userId_monthYear: {
          userId,
          monthYear: targetMonth,
        },
      },
    });

    // Retrieve user's configured monthly limit
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { monthlyTokenLimit: true },
    });

    const limit = user?.monthlyTokenLimit ?? 50000;
    const totalTokens = monthlyUsage?.tokensUsed ?? 0;
    const promptTokens = monthlyUsage?.promptTokens ?? 0;
    const completionTokens = monthlyUsage?.completionTokens ?? 0;
    const messageCount = monthlyUsage?.messageCount ?? 0;
    const createdAt = monthlyUsage?.createdAt ?? new Date();
    const updatedAt = monthlyUsage?.updatedAt ?? new Date();

    const usagePercentage = limit > 0 ? parseFloat(((totalTokens / limit) * 100).toFixed(2)) : 0;

    let flag = "NORMAL";
    if (usagePercentage >= 100) {
      flag = "100%";
    } else if (usagePercentage >= 90) {
      flag = "90%";
    }

    // Dynamic cost forecasting based on a rate of $0.002 per 1000 tokens
    const costRate = 0.002 / 1000;
    const costSoFar = totalTokens * costRate;

    const now = new Date();
    const currentDay = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    let projectedTokens = totalTokens;
    if (targetMonth === currentMonth && currentDay > 0) {
      projectedTokens = Math.round((totalTokens / currentDay) * daysInMonth);
    }
    const projectedCost = projectedTokens * costRate;

    return {
      user_id: userId,
      total_tokens: totalTokens,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      message_count: messageCount,
      monthlyTokenLimit: limit,
      usagePercentage,
      flag,
      costSoFar: parseFloat(costSoFar.toFixed(4)),
      projectedTokens,
      projectedCost: parseFloat(projectedCost.toFixed(4)),
      monthYear: targetMonth,
      createdAt,
      updatedAt,
    };
  },

  async syncUserUsage(userId: string, proxyUsage: any) {
    const currentMonth = new Date().toISOString().slice(0, 7);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        lastProxyTokens: true,
        lastProxyPromptTokens: true,
        lastProxyCompletionTokens: true,
      },
    });

    if (!user) return;

    const lastT = user.lastProxyTokens ?? 0;
    const lastP = user.lastProxyPromptTokens ?? 0;
    const lastC = user.lastProxyCompletionTokens ?? 0;

    const currentT = proxyUsage?.total_tokens ?? 0;
    const currentP = proxyUsage?.prompt_tokens ?? 0;
    const currentC = proxyUsage?.completion_tokens ?? 0;

    // If user's lastProxyTokens was never initialized (lastT === 0 && lastP === 0 && lastC === 0)
    // and proxy already has usage (currentT > 0):
    // Check if there is existing usage for the current month.
    // If not, this is historical proxy usage accumulated from previous months.
    // Set the baseline on the user record without attributing it to currentMonth.
    if (lastT === 0 && lastP === 0 && lastC === 0 && currentT > 0) {
      const existingUsage = await prisma.userMonthlyUsage.findUnique({
        where: {
          userId_monthYear: {
            userId,
            monthYear: currentMonth,
          },
        },
      });

      if (!existingUsage || (existingUsage.tokensUsed === 0 && existingUsage.messageCount === 0)) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            lastProxyTokens: currentT,
            lastProxyPromptTokens: currentP,
            lastProxyCompletionTokens: currentC,
          },
        });
        return;
      }
    }

    let deltaT = currentT - lastT;
    let deltaP = currentP - lastP;
    let deltaC = currentC - lastC;

    // If delta is negative, the proxy was reset
    if (deltaT < 0) {
      deltaT = currentT;
      deltaP = currentP;
      deltaC = currentC;
    }

    if (deltaT > 0 || deltaP > 0 || deltaC > 0) {
      await prisma.userMonthlyUsage.upsert({
        where: {
          userId_monthYear: {
            userId,
            monthYear: currentMonth,
          },
        },
        update: {
          tokensUsed: { increment: deltaT },
          promptTokens: { increment: deltaP },
          completionTokens: { increment: deltaC },
        },
        create: {
          userId,
          monthYear: currentMonth,
          tokensUsed: deltaT,
          promptTokens: deltaP,
          completionTokens: deltaC,
        },
      });

      await prisma.user.update({
        where: { id: userId },
        data: {
          lastProxyTokens: currentT,
          lastProxyPromptTokens: currentP,
          lastProxyCompletionTokens: currentC,
        },
      });
    }
  },

  async checkUsageThresholds(userId: string, totalTokens: number, limit: number) {
    const usagePercentage = limit > 0 ? (totalTokens / limit) * 100 : 0;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        fcmToken: true,
        hasSent90Warning: true,
        hasSent100Warning: true,
      },
    });

    if (!user) return;

    let updateData: any = {};
    let shouldUpdate = false;

    // Reset warnings if usage drops back below 90%
    if (usagePercentage < 90) {
      if (user.hasSent90Warning || user.hasSent100Warning) {
        updateData.hasSent90Warning = false;
        updateData.hasSent100Warning = false;
        shouldUpdate = true;
      }
    }

    // Trigger 90% warning push notification
    if (usagePercentage >= 90 && usagePercentage < 100 && !user.hasSent90Warning) {
      updateData.hasSent90Warning = true;
      shouldUpdate = true;

      const title = "AI Chat Warning";
      const body = "You have reached 90% of your access to Sable this month 💕";
      const payload = { screen: "chat", type: "usage_warning_90" };

      if (user.fcmToken) {
        await sendPushNotification(user.fcmToken, title, body, payload, userId);
      } else {
        await prisma.notification.create({
          data: {
            userId,
            title,
            body,
            data: payload,
          },
        });
      }
    }

    // Trigger 100% warning push notification
    if (usagePercentage >= 100 && !user.hasSent100Warning) {
      updateData.hasSent100Warning = true;
      shouldUpdate = true;

      const title = "Sable Capacity Reached";
      const body = "You’ve reached your monthly Sable capacity. Your commitment to becoming is beautiful. New messages will open at the start of your next month.";
      const payload = { screen: "chat", type: "usage_warning_100" };

      if (user.fcmToken) {
        await sendPushNotification(user.fcmToken, title, body, payload, userId);
      } else {
        await prisma.notification.create({
          data: {
            userId,
            title,
            body,
            data: payload,
          },
        });
      }
    }

    if (shouldUpdate) {
      await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });
    }
  },

  async updateUserTokenLimit(
    adminId: string,
    adminEmail: string,
    targetUserId: string,
    type: "increase" | "decrease",
    amount: number
  ) {
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { email: true, monthlyTokenLimit: true },
    });

    if (!user) {
      throw new AppError(httpStatus.NOT_FOUND, "User not found");
    }

    const oldLimit = user.monthlyTokenLimit;
    const updatedLimit = type === "increase" ? oldLimit + amount : oldLimit - amount;

    if (updatedLimit < 0) {
      throw new AppError(httpStatus.BAD_REQUEST, "Resulting monthly token limit cannot be negative");
    }

    // Update user limit and reset warning flags if increasing tokens
    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        monthlyTokenLimit: updatedLimit,
        ...(type === "increase"
          ? {
              hasSent90Warning: false,
              hasSent100Warning: false,
            }
          : {}),
      },
    });

    if (type === "increase") {
      await notifyCapacityIncreased(targetUserId);
    }

    // Write audit log
    await prisma.auditLog.create({
      data: {
        action: "UPDATE_USER_LIMIT",
        adminId,
        adminEmail,
        targetId: targetUserId,
        targetEmail: user.email,
        oldValue: String(oldLimit),
        newValue: String(updatedLimit),
      },
    });

    return updatedUser;
  },

  async getGlobalTokenCap() {
    const configRecord = await prisma.appConfig.findUnique({
      where: { key: "global_monthly_token_cap" },
    });

    return {
      globalTokenCap: configRecord ? Number(configRecord.value) : 10000000, // Default to 10M if not set
    };
  },

  async updateGlobalTokenCap(adminId: string, adminEmail: string, newCap: number) {
    const oldConfig = await prisma.appConfig.findUnique({
      where: { key: "global_monthly_token_cap" },
    });

    const oldValue = oldConfig ? oldConfig.value : "10000000";

    const configRecord = await prisma.appConfig.upsert({
      where: { key: "global_monthly_token_cap" },
      update: { value: String(newCap) },
      create: { key: "global_monthly_token_cap", value: String(newCap) },
    });

    // Write audit log
    await prisma.auditLog.create({
      data: {
        action: "UPDATE_GLOBAL_CAP",
        adminId,
        adminEmail,
        oldValue,
        newValue: String(newCap),
      },
    });

    return {
      globalTokenCap: Number(configRecord.value),
    };
  },

  async getDefaultTokenLimit() {
    const configRecord = await prisma.appConfig.findUnique({
      where: { key: "default_monthly_token_limit" },
    });

    return {
      defaultTokenLimit: configRecord ? Number(configRecord.value) : 50000,
    };
  },

  async updateDefaultTokenLimit(adminId: string, adminEmail: string, newLimit: number) {
    const oldConfig = await prisma.appConfig.findUnique({
      where: { key: "default_monthly_token_limit" },
    });

    const oldValue = oldConfig ? oldConfig.value : "50000";

    const configRecord = await prisma.appConfig.upsert({
      where: { key: "default_monthly_token_limit" },
      update: { value: String(newLimit) },
      create: { key: "default_monthly_token_limit", value: String(newLimit) },
    });

    // Write audit log
    await prisma.auditLog.create({
      data: {
        action: "UPDATE_DEFAULT_LIMIT",
        adminId,
        adminEmail,
        oldValue,
        newValue: String(newLimit),
      },
    });

    return {
      defaultTokenLimit: Number(configRecord.value),
    };
  },

  async updateAllUsersTokenLimit(
    adminId: string,
    adminEmail: string,
    type: "increase" | "decrease",
    amount: number
  ) {
    if (type === "increase") {
      await prisma.user.updateMany({
        data: {
          monthlyTokenLimit: { increment: amount },
          hasSent90Warning: false,
          hasSent100Warning: false,
        },
      });

      // Notify all users in background
      prisma.user
        .findMany({
          where: { role: "user" },
          select: { id: true },
        })
        .then(async (users) => {
          for (const u of users) {
            await notifyCapacityIncreased(u.id);
          }
        })
        .catch((err) => {
          console.error("[CHAT] Failed to notify users on bulk token increase:", err);
        });
    } else if (type === "decrease") {
      await prisma.user.updateMany({
        data: {
          monthlyTokenLimit: { decrement: amount },
        },
      });

      // Ensure no negative monthlyTokenLimit
      await prisma.user.updateMany({
        where: {
          monthlyTokenLimit: { lt: 0 },
        },
        data: {
          monthlyTokenLimit: 0,
        },
      });
    }

    // Write audit log
    await prisma.auditLog.create({
      data: {
        action: "UPDATE_ALL_USERS_LIMIT",
        adminId,
        adminEmail,
        targetEmail: "ALL_USERS",
        oldValue: type,
        newValue: String(amount),
      },
    });

    return {
      success: true,
      message: `Successfully updated all users' token limits (${type} by ${amount})`,
    };
  },

  async getAuditLogs() {
    return prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
    });
  },

  async getUserUsageHistory(userId: string) {
    return prisma.userMonthlyUsage.findMany({
      where: { userId },
      orderBy: { monthYear: "desc" },
    });
  },

  async exportUsageToCsv(monthYear?: string) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const targetMonth = monthYear || currentMonth;

    const users = await prisma.user.findMany({
      where: { role: "user" },
      select: { id: true, name: true, email: true, monthlyTokenLimit: true },
    });

    const rows = [
      ["User ID", "Name", "Email", "Month", "Limit", "Tokens Used", "Prompt Tokens", "Completion Tokens", "Messages Count", "Usage Percentage", "Warning Status Flag", "Cost So Far ($)", "Projected Monthly Tokens", "Projected Monthly Cost ($)"]
    ];

    for (const u of users) {
      const usage = await this.getUsage(u.id, targetMonth);
      rows.push([
        u.id,
        u.name,
        u.email,
        targetMonth,
        String(usage.monthlyTokenLimit),
        String(usage.total_tokens),
        String(usage.prompt_tokens),
        String(usage.completion_tokens),
        String(usage.message_count),
        `${usage.usagePercentage}%`,
        usage.flag,
        String(usage.costSoFar),
        String(usage.projectedTokens),
        String(usage.projectedCost)
      ]);
    }

    const csvContent = rows
      .map((row) =>
        row
          .map((field) => {
            const cleanField = String(field).replace(/"/g, '""');
            return `"${cleanField}"`;
          })
          .join(",")
      )
      .join("\r\n");

    return csvContent;
  },

  async getAllUsersUsage(query: { page?: string; limit?: string; sortBy?: string; sortOrder?: "asc" | "desc"; month?: string }) {
    const page = Math.max(Number(query.page || 1), 1);
    const limit = Math.min(Math.max(Number(query.limit || 10), 1), 100);
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy || "name";
    const sortOrder = query.sortOrder || "asc";
    const currentMonth = new Date().toISOString().slice(0, 7);
    const targetMonth = query.month || currentMonth;

    // Count total users
    const total = await prisma.user.count({
      where: { role: "user" },
    });

    let data: any[] = [];

    // If sorting by name or email, we can sort directly in Prisma query
    const dbSortFields = ["name", "email"];
    if (dbSortFields.includes(sortBy)) {
      const users = await prisma.user.findMany({
        where: { role: "user" },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          monthlyTokenLimit: true,
          permanentId: true,
        },
        orderBy: {
          [sortBy]: sortOrder,
        },
        skip,
        take: limit,
      });

      const usagePromises = users.map(async (user) => {
        const permanentId = await ensurePermanentUserId(user.id, user.permanentId);
        const userWithPermanentId = { ...user, permanentId };
        try {
          const usage = await this.getUsage(user.id, targetMonth);
          return { user: userWithPermanentId, usage };
        } catch (err) {
          return {
            user: userWithPermanentId,
            usage: {
              user_id: user.id,
              total_tokens: 0,
              prompt_tokens: 0,
              completion_tokens: 0,
              message_count: 0,
              monthlyTokenLimit: user.monthlyTokenLimit,
              usagePercentage: 0,
              flag: "NORMAL",
              costSoFar: 0,
              projectedTokens: 0,
              projectedCost: 0,
              monthYear: targetMonth,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          };
        }
      });
      data = await Promise.all(usagePromises);
    } else {
      // For sorting by token usage or percentage, retrieve all matching users,
      // compute their monthly usage, sort in memory, and slice for pagination.
      const users = await prisma.user.findMany({
        where: { role: "user" },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          monthlyTokenLimit: true,
          permanentId: true,
        },
      });

      const usagePromises = users.map(async (user) => {
        const permanentId = await ensurePermanentUserId(user.id, user.permanentId);
        const userWithPermanentId = { ...user, permanentId };
        try {
          const usage = await this.getUsage(user.id, targetMonth);
          return { user: userWithPermanentId, usage };
        } catch (err) {
          return {
            user: userWithPermanentId,
            usage: {
              user_id: user.id,
              total_tokens: 0,
              prompt_tokens: 0,
              completion_tokens: 0,
              message_count: 0,
              monthlyTokenLimit: user.monthlyTokenLimit,
              usagePercentage: 0,
              flag: "NORMAL",
              costSoFar: 0,
              projectedTokens: 0,
              projectedCost: 0,
              monthYear: targetMonth,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          };
        }
      });

      const allRecords = await Promise.all(usagePromises);

      allRecords.sort((a, b) => {
        let valA = 0;
        let valB = 0;
        if (sortBy === "tokensUsed") {
          valA = a.usage.total_tokens;
          valB = b.usage.total_tokens;
        } else if (sortBy === "usagePercentage") {
          valA = a.usage.usagePercentage;
          valB = b.usage.usagePercentage;
        }

        return sortOrder === "asc" ? valA - valB : valB - valA;
      });

      data = allRecords.slice(skip, skip + limit);
    }

    const totalPage = Math.ceil(total / limit);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPage,
      },
    };
  },

  async resetUserUsage(adminId: string, adminEmail: string, targetUserId: string, monthYear?: string) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const targetMonth = monthYear || currentMonth;

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { email: true },
    });

    if (!user) {
      throw new AppError(httpStatus.NOT_FOUND, "User not found");
    }

    // 1. Fetch live proxy tokens to sync baseline so future deltas start from 0
    let currentT = 0;
    let currentP = 0;
    let currentC = 0;
    try {
      const rawUsage = await requestSableDreamChat<any>(`/api/v1/chat/usage/${encodeURIComponent(targetUserId)}`, { method: "GET" });
      if (rawUsage) {
        currentT = rawUsage.total_tokens ?? 0;
        currentP = rawUsage.prompt_tokens ?? 0;
        currentC = rawUsage.completion_tokens ?? 0;
      }
    } catch (err) {
      console.warn(`[CHAT] Could not fetch live proxy usage during reset for user ${targetUserId}:`, err);
    }

    // 2. Reset or set UserMonthlyUsage to 0 for targetMonth
    await prisma.userMonthlyUsage.upsert({
      where: {
        userId_monthYear: {
          userId: targetUserId,
          monthYear: targetMonth,
        },
      },
      update: {
        tokensUsed: 0,
        promptTokens: 0,
        completionTokens: 0,
        messageCount: 0,
      },
      create: {
        userId: targetUserId,
        monthYear: targetMonth,
        tokensUsed: 0,
        promptTokens: 0,
        completionTokens: 0,
        messageCount: 0,
      },
    });

    // 3. Update user's lastProxyTokens to match current proxy usage and clear warning flags
    await prisma.user.update({
      where: { id: targetUserId },
      data: {
        lastProxyTokens: currentT,
        lastProxyPromptTokens: currentP,
        lastProxyCompletionTokens: currentC,
        hasSent90Warning: false,
        hasSent100Warning: false,
      },
    });

    await notifyCapacityIncreased(targetUserId);

    // 4. Create Audit Log
    if (/^[0-9a-fA-F]{24}$/.test(adminId)) {
      await prisma.auditLog.create({
        data: {
          action: "RESET_USER_USAGE",
          adminId,
          adminEmail,
          targetId: targetUserId,
          targetEmail: user.email,
          oldValue: "N/A",
          newValue: `Reset usage to 0 for month ${targetMonth}`,
        },
      });
    }

    return {
      success: true,
      message: `Token usage for user ${user.email} successfully reset to 0 for ${targetMonth}`,
    };
  },

  async resetAllUsersUsage(adminId: string, adminEmail: string, monthYear?: string) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const targetMonth = monthYear || currentMonth;

    // 1. Reset all UserMonthlyUsage records for targetMonth
    await prisma.userMonthlyUsage.updateMany({
      where: { monthYear: targetMonth },
      data: {
        tokensUsed: 0,
        promptTokens: 0,
        completionTokens: 0,
        messageCount: 0,
      },
    });

    // 2. Fetch all users and sync their lastProxyTokens to current live proxy values
    const users = await prisma.user.findMany({
      where: { role: "user" },
      select: { id: true },
    });

    await Promise.allSettled(
      users.map(async (u) => {
        try {
          const rawUsage = await requestSableDreamChat<any>(`/api/v1/chat/usage/${encodeURIComponent(u.id)}`, { method: "GET" });
          const currentT = rawUsage?.total_tokens ?? 0;
          const currentP = rawUsage?.prompt_tokens ?? 0;
          const currentC = rawUsage?.completion_tokens ?? 0;

          await prisma.user.update({
            where: { id: u.id },
            data: {
              lastProxyTokens: currentT,
              lastProxyPromptTokens: currentP,
              lastProxyCompletionTokens: currentC,
              hasSent90Warning: false,
              hasSent100Warning: false,
            },
          });
        } catch {
          await prisma.user.update({
            where: { id: u.id },
            data: {
              hasSent90Warning: false,
              hasSent100Warning: false,
            },
          });
        }
      })
    );

    // 3. Create Audit Log
    if (/^[0-9a-fA-F]{24}$/.test(adminId)) {
      await prisma.auditLog.create({
        data: {
          action: "RESET_ALL_USERS_USAGE",
          adminId,
          adminEmail,
          targetEmail: "ALL_USERS",
          oldValue: "N/A",
          newValue: `Reset all users' usage to 0 for month ${targetMonth}`,
        },
      });
    }

    return {
      success: true,
      message: `All users' token usage successfully reset to 0 for ${targetMonth}`,
    };
  },

  async performMonthlyReset() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const configRecord = await prisma.appConfig.findUnique({
      where: { key: "default_monthly_token_limit" },
    });
    const defaultLimit = configRecord ? Number(configRecord.value) : 50000;

    // 1. Reset limits and warning flags for all users
    await prisma.user.updateMany({
      data: {
        monthlyTokenLimit: defaultLimit,
        hasSent90Warning: false,
        hasSent100Warning: false,
      },
    });

    // 2. Snapshot current proxy tokens as baseline for all users
    const users = await prisma.user.findMany({
      where: { role: "user" },
      select: { id: true },
    });

    for (const u of users) {
      try {
        const rawUsage = await requestSableDreamChat<any>(`/api/v1/chat/usage/${encodeURIComponent(u.id)}`, { method: "GET" });
        if (rawUsage) {
          await prisma.user.update({
            where: { id: u.id },
            data: {
              lastProxyTokens: rawUsage.total_tokens ?? 0,
              lastProxyPromptTokens: rawUsage.prompt_tokens ?? 0,
              lastProxyCompletionTokens: rawUsage.completion_tokens ?? 0,
            },
          });
        }
      } catch (err) {
        console.error(`[CHAT] Could not snapshot proxy tokens for user ${u.id}:`, err);
      }
      await notifyCapacityIncreased(u.id);
    }

    console.log(`[CHAT] Monthly token limit and usage baseline reset completed for ${currentMonth}`);
  },
};
