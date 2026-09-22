import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsyncFn from "../../utils/catchAsyncFn";
import sendResponse from "../../utils/sendResponse";
import AppError from "../../error/AppError";
import config from "../../config";
import { SubscriptionService } from "./subscription.service";

/**
 * Get active subscription details mapped for Figma UI views
 */
const getSubscriptionDetails = catchAsyncFn(async (req: Request, res: Response) => {
  const userId = req.user?.userId;

  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Unauthorized");
  }

  const result = await SubscriptionService.getSubscriptionDetails(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Subscription details retrieved successfully",
    data: result,
  });
});

/**
 * Get formatted invoice history for Billing History view
 */
const getBillingHistory = catchAsyncFn(async (req: Request, res: Response) => {
  const userId = req.user?.userId;

  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Unauthorized");
  }

  const result = await SubscriptionService.getBillingHistory(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Billing history retrieved successfully",
    data: result,
  });
});

/**
 * Manually synchronize database with RevenueCat API
 */
const syncSubscription = catchAsyncFn(async (req: Request, res: Response) => {
  const userId = req.user?.userId;

  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Unauthorized");
  }

  const incomingAppUserId =
    req.body?.appUserId ||
    req.body?.revenueCatUserId ||
    req.body?.originalAppUserId ||
    req.body?.rcUserId;

  const result = await SubscriptionService.syncRevenueCatSubscription(userId, incomingAppUserId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Subscription synced successfully with RevenueCat",
    data: result,
  });
});

/**
 * Webhook ingest for RevenueCat background sync events
 */
const handleWebhook = catchAsyncFn(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const webhookAuth = config.revenueCat.webhookAuth;
  // Verify authorization secret if it is configured in env variables
  if (webhookAuth) {
    const cleanAuthHeader = authHeader ? authHeader.replace(/^Bearer\s+/i, "").trim() : "";
    const cleanWebhookAuth = webhookAuth.replace(/^Bearer\s+/i, "").trim();
    if (!cleanAuthHeader || cleanAuthHeader !== cleanWebhookAuth) {
      console.warn(`[RevenueCat Webhook] Authorization header mismatch. Received: "${cleanAuthHeader.slice(0, 10)}...", Expected: "${cleanWebhookAuth.slice(0, 10)}..."`);
      throw new AppError(httpStatus.UNAUTHORIZED, "Unauthorized webhook source");
    }
  }

  const result = await SubscriptionService.handleRevenueCatWebhook(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result?.message || "Webhook processed",
    data: result,
  });
});

export const SubscriptionController = {
  getSubscriptionDetails,
  getBillingHistory,
  syncSubscription,
  handleWebhook,
};
