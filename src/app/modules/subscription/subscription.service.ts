import { prisma } from "../../lib/prisma";
import config from "../../config";
import AppError from "../../error/AppError";
import httpStatus from "http-status";
import { subscriptionConfirmationTemplate } from "../../utils/emailTemplates/subscriptionConfirmation";
import { subscribedWelcomeTemplate } from "../../utils/emailTemplates/subscribedWelcome";
import { subscriptionDetailsTemplate } from "../../utils/emailTemplates/subscriptionDetails";
import { subscriptionCanceledTemplate } from "../../utils/emailTemplates/subscriptionCanceled";
import { subscriptionEndedTemplate } from "../../utils/emailTemplates/subscriptionEnded";
import { billingIssueTemplate } from "../../utils/emailTemplates/billingIssue";

// Map Product ID to plan name, cost, and frequency
const PRODUCT_PLAN_MAP: Record<string, { name: string; type: "monthly" | "annual"; amount: number }> = {
  monthly_divine: {
    name: "Monthly — Divine",
    type: "monthly",
    amount: 5.0,
  },
  annual_becoming: {
    name: "Annual — Becoming",
    type: "annual",
    amount: 45.0,
  },
};

// Formatting utilities for Billing History to match the Figma UI perfectly
const formatTime = (date: Date): string => {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const minutesStr = minutes < 10 ? "0" + minutes : minutes;
  return `${hours}:${minutesStr}${ampm}`;
};

const padZero = (num: number): string => {
  return num < 10 ? "0" + num : String(num);
};

const formatDate = (date: Date): string => {
  // Return format DD.MM.YY (e.g. 12.11.23)
  const day = padZero(date.getDate());
  const month = padZero(date.getMonth() + 1);
  const year = String(date.getFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
};

const getPlanMeta = (productId: string | null) => {
  if (!productId) return null;
  if (PRODUCT_PLAN_MAP[productId]) {
    return PRODUCT_PLAN_MAP[productId];
  }
  const lower = productId.toLowerCase();
  for (const [key, value] of Object.entries(PRODUCT_PLAN_MAP)) {
    if (lower.includes(key.toLowerCase())) {
      return value;
    }
  }
  const isAnnual = lower.includes("annual") || lower.includes("year") || lower.includes("becoming");
  return {
    name: isAnnual ? "Annual — Becoming" : "Monthly — Divine",
    type: isAnnual ? ("annual" as const) : ("monthly" as const),
    amount: isAnnual ? 45.0 : 5.0,
  };
};

const toDateFromMs = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  const ms =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isValidObjectId = (val?: string | null): boolean =>
  Boolean(val && /^[0-9a-fA-F]{24}$/.test(val.trim()));

const normalizePaymentMethod = (storeStr?: string | null): string => {
  if (!storeStr) return "App Store";
  const s = String(storeStr).toLowerCase();
  if (s.includes("play") || s.includes("google") || s.includes("android")) return "Google Play";
  if (s.includes("app_store") || s.includes("apple") || s.includes("ios")) return "App Store";
  return storeStr;
};

const findUserByIdentifier = async (identifier?: string | null) => {
  if (!identifier) return null;
  const trimmed = identifier.trim();

  // 1. If valid 24-hex string, try finding by MongoDB ObjectId
  if (isValidObjectId(trimmed)) {
    try {
      const byId = await prisma.user.findUnique({ where: { id: trimmed } });
      if (byId) return byId;
    } catch {
      // ignore and continue to other fields
    }
  }

  // 2. Try finding by permanentId, email, or linked revenueCatUserId
  return await prisma.user.findFirst({
    where: {
      OR: [
        { permanentId: trimmed },
        { email: { equals: trimmed, mode: "insensitive" } },
        { subscription: { revenueCatUserId: trimmed } },
      ],
    },
  });
};

export const SubscriptionService = {
  /**
   * Fetch subscription info for a user. Mapped to Figma design specifications.
   */
  async getSubscriptionDetails(userId: string, skipRemoteSync = false) {
    if (!skipRemoteSync && config.revenueCat.apiKey) {
      try {
        await this.syncRevenueCatSubscription(userId, undefined, true);
      } catch (err) {
        console.warn(`[Subscription Details] Background RevenueCat sync skipped for user ${userId}:`, err);
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) {
      throw new AppError(httpStatus.NOT_FOUND, "User not found");
    }

    let sub = user.subscription;
    const now = new Date();

    // Check if subscription has expired based on expiry date
    let status: "active" | "trial" | "expired" = "expired";
    let hasActivePremium = false;

    if (sub && sub.status !== "expired" && sub.expiresDate) {
      if (sub.expiresDate > now) {
        status = sub.status as "active" | "trial";
        hasActivePremium = true;
      } else {
        // Subscription just expired locally — update DB and send Subscription Ended email if not sent yet
        const planMetaForExpired = getPlanMeta(sub.productId);
        const shouldSendExpiredEmail = !sub.expiredEmailSentAt;

        sub = await prisma.subscription.update({
          where: { userId },
          data: {
            status: "expired",
            autoRenewStatus: false,
            ...(shouldSendExpiredEmail ? { expiredEmailSentAt: now } : {}),
          },
        });

        if (shouldSendExpiredEmail) {
          try {
            await subscriptionEndedTemplate({
              userName: user.name,
              email: user.email,
              planName: planMetaForExpired?.name || "Monthly — Divine",
              price: `$${planMetaForExpired?.amount || 5.0}`,
              endedAt: (sub.expiresDate || now).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              }),
              joinedAt: user.createdAt
                ? user.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
                : now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
            });
          } catch (err) {
            console.error("[Subscription Details] Failed to send subscription ended email:", err);
          }
        }
      }
    }

    const planMeta = sub ? getPlanMeta(sub.productId) : null;
    const isCanceled = Boolean(sub?.unsubscribeDetectedAt) || sub?.autoRenewStatus === false;

    // Build Figma UI mapping response
    return {
      status,
      autoRenewStatus: hasActivePremium ? !isCanceled : false,
      isCanceled: hasActivePremium ? isCanceled : false,
      currentPlan: {
        name: hasActivePremium && planMeta ? planMeta.name : "Free Tier",
        type: hasActivePremium && planMeta ? planMeta.type : "free",
        productId: hasActivePremium ? sub?.productId || null : null,
        expiresAt: sub?.expiresDate || null,
      },
      billingDetails: {
        nextBillingAmount: hasActivePremium && !isCanceled && planMeta ? planMeta.amount : null,
        nextBillingDate: hasActivePremium && !isCanceled ? sub?.expiresDate || null : null,
        paymentMethod: sub?.paymentMethod || "App Store",
      },
      hasActivePremium,
    };
  },

  /**
   * Get billing history for the Figma "Billing history" screen.
   */
  async getBillingHistory(userId: string) {
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return transactions.map((tx) => {
      const isRefund = tx.type === "refund";
      const sign = isRefund ? "+" : "-";
      return {
        id: tx.id,
        name: tx.name || "User",
        phone: tx.phone || "N/A",
        transactionId: tx.transactionId,
        amount: tx.amount,
        formattedAmount: `${sign}$${Math.abs(tx.amount).toFixed(2)}`,
        time: formatTime(tx.createdAt),
        date: formatDate(tx.createdAt),
        createdAt: tx.createdAt,
      };
    });
  },

  /**
   * Sync a subscriber's state manually using RevenueCat REST API
   */
  async syncRevenueCatSubscription(
    userId: string,
    incomingAppUserId?: string,
    skipDetailsReturn = false
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) {
      throw new AppError(httpStatus.NOT_FOUND, "User not found");
    }

    const apiKey = config.revenueCat.apiKey;
    if (!apiKey) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "RevenueCat API key is not configured in backend env variables"
      );
    }

    // Try candidates: incomingAppUserId from client, existing revenueCatUserId, user.id (MongoDB id), permanentId, and email
    const candidateIds = [
      incomingAppUserId,
      user.subscription?.revenueCatUserId,
      user.id,
      user.permanentId,
      user.email,
    ].filter(Boolean) as string[];

    const uniqueCandidates = [...new Set(candidateIds)];
    let subscriber: any = null;
    let matchedRevenueCatId: string | null = null;

    for (const candidate of uniqueCandidates) {
      try {
        const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(candidate)}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (response.ok) {
          const data = (await response.json()) as any;
          if (data?.subscriber) {
            const hasEntitlements = Object.keys(data.subscriber.entitlements || {}).length > 0;
            const hasSubs = Object.keys(data.subscriber.subscriptions || {}).length > 0;
            if (!subscriber || hasEntitlements || hasSubs) {
              subscriber = data.subscriber;
              matchedRevenueCatId = candidate;
            }
            if (hasEntitlements || hasSubs) {
              break; // Found active/relevant subscriber record
            }
          }
        }
      } catch (err) {
        console.error(`[RevenueCat Sync] Error querying candidate ${candidate}:`, err);
      }
    }

    if (!subscriber) {
      console.warn(`[RevenueCat Sync] No subscriber record found in RevenueCat for user ${userId} across candidates:`, uniqueCandidates);
      return skipDetailsReturn ? null : this.getSubscriptionDetails(userId, true);
    }

    const now = new Date();
    const entitlements = subscriber.entitlements || {};
    const subscriptions = subscriber.subscriptions || {};

    // 1. Check for active entitlement
    let activeEntitlementKey: string | null = null;
    let activeEntitlement: any = null;

    for (const key of Object.keys(entitlements)) {
      const entitlement = entitlements[key];
      const expiresDateStr = entitlement.expires_date;
      if (expiresDateStr) {
        const expDate = new Date(expiresDateStr);
        if (expDate > now) {
          activeEntitlementKey = key;
          activeEntitlement = entitlement;
          break; // Found an active entitlement
        }
      } else {
        // Lifetime or no expiry
        activeEntitlementKey = key;
        activeEntitlement = entitlement;
        break;
      }
    }

    let hasActiveSubscription = false;
    let productId: string | null = null;
    let expiresDate: Date | null = null;
    let purchaseDate: Date | null = null;
    let originalPurchaseDate: Date | null = null;
    let isTrial = false;
    let paymentStore = "App Store";
    let storeTxId: string | null = null;
    let unsubscribeDetectedAt: Date | null = null;
    let billingIssueDetectedAt: Date | null = null;

    if (activeEntitlementKey && activeEntitlement) {
      hasActiveSubscription = true;
      productId = activeEntitlement.product_identifier;
      expiresDate = activeEntitlement.expires_date ? new Date(activeEntitlement.expires_date) : null;
      purchaseDate = activeEntitlement.purchase_date ? new Date(activeEntitlement.purchase_date) : null;
      originalPurchaseDate = activeEntitlement.original_purchase_date
        ? new Date(activeEntitlement.original_purchase_date)
        : null;
      isTrial = String(activeEntitlement.period_type || "").toLowerCase() === "trial";
      const subObj = productId ? subscriptions[productId] : null;
      paymentStore = subObj?.store || activeEntitlement.store || "App Store";
      storeTxId = subObj?.store_transaction_id || null;

      const unsubStr = activeEntitlement.unsubscribe_detected_at || subObj?.unsubscribe_detected_at;
      if (unsubStr) {
        const parsed = new Date(unsubStr);
        if (!Number.isNaN(parsed.getTime())) unsubscribeDetectedAt = parsed;
      }

      const billingIssueStr = activeEntitlement.billing_issues_detected_at || subObj?.billing_issues_detected_at;
      if (billingIssueStr) {
        const parsed = new Date(billingIssueStr);
        if (!Number.isNaN(parsed.getTime())) billingIssueDetectedAt = parsed;
      }
    } else {
      // Fallback: Check subscriber.subscriptions directly (in case RevenueCat Entitlement was not linked in dashboard)
      for (const [subProdId, subObj] of Object.entries<any>(subscriptions)) {
        if (!subObj) continue;
        const subExpiresStr = subObj.expires_date;
        const subRefundedStr = subObj.refunded_at;
        if (!subRefundedStr && (!subExpiresStr || new Date(subExpiresStr) > now)) {
          hasActiveSubscription = true;
          productId = subProdId;
          expiresDate = subExpiresStr ? new Date(subExpiresStr) : null;
          purchaseDate = subObj.purchase_date ? new Date(subObj.purchase_date) : null;
          originalPurchaseDate = subObj.original_purchase_date ? new Date(subObj.original_purchase_date) : null;
          isTrial = String(subObj.period_type || "").toLowerCase() === "trial";
          paymentStore = subObj.store || "App Store";
          storeTxId = subObj.store_transaction_id || null;

          if (subObj.unsubscribe_detected_at) {
            const parsed = new Date(subObj.unsubscribe_detected_at);
            if (!Number.isNaN(parsed.getTime())) unsubscribeDetectedAt = parsed;
          }
          if (subObj.billing_issues_detected_at) {
            const parsed = new Date(subObj.billing_issues_detected_at);
            if (!Number.isNaN(parsed.getTime())) billingIssueDetectedAt = parsed;
          }
          break;
        }
      }
    }

    const existingSub = user.subscription;
    const wasAlreadyActive = Boolean(
      existingSub && (existingSub.status === "active" || existingSub.status === "trial")
    );
    const formattedJoinedAt = user.createdAt
      ? user.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    if (hasActiveSubscription && productId) {
      const planMeta = getPlanMeta(productId);
      const status = isTrial ? "trial" : "active";
      const planType = planMeta ? planMeta.type : "free";
      const formattedExpiresAt = expiresDate
        ? expiresDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : "N/A";

      // Detect if a renewal occurred (same subscription was already active, but purchaseDate advanced to a new billing cycle)
      const isRenewal = Boolean(
        wasAlreadyActive &&
          purchaseDate &&
          existingSub?.purchaseDate &&
          purchaseDate.getTime() > existingSub.purchaseDate.getTime() + 60 * 1000
      );

      // Determine whether cancellation email or billing issue email needs to be sent
      let cancelEmailSentAt = isRenewal ? null : existingSub?.cancelEmailSentAt || null;
      let billingIssueEmailSentAt = isRenewal ? null : existingSub?.billingIssueEmailSentAt || null;

      if (!unsubscribeDetectedAt) {
        cancelEmailSentAt = null;
      }
      if (!billingIssueDetectedAt) {
        billingIssueEmailSentAt = null;
      }

      const shouldSendCancelEmail = Boolean(
        unsubscribeDetectedAt &&
          (!cancelEmailSentAt || (purchaseDate && cancelEmailSentAt < purchaseDate))
      );

      const shouldSendBillingIssueEmail = Boolean(
        billingIssueDetectedAt &&
          (!billingIssueEmailSentAt || (purchaseDate && billingIssueEmailSentAt < purchaseDate))
      );

      if (shouldSendCancelEmail) {
        cancelEmailSentAt = now;
      }
      if (shouldSendBillingIssueEmail) {
        billingIssueEmailSentAt = now;
      }

      const subscriptionData = {
        status: status as any,
        planType: planType as any,
        productId,
        expiresDate,
        purchaseDate,
        originalPurchaseDate,
        paymentMethod: normalizePaymentMethod(paymentStore),
        revenueCatUserId: matchedRevenueCatId || userId,
        autoRenewStatus: !unsubscribeDetectedAt,
        unsubscribeDetectedAt,
        billingIssueDetectedAt,
        cancelEmailSentAt,
        expiredEmailSentAt: null,
        billingIssueEmailSentAt,
      };

      // Upsert Subscription
      await prisma.subscription.upsert({
        where: { userId },
        update: subscriptionData,
        create: {
          userId,
          ...subscriptionData,
        },
      });

      // Synchronize Transactions if store_transaction_id is available
      if (storeTxId) {
        const txAmount = planMeta ? planMeta.amount : 0.0;
        await prisma.transaction.upsert({
          where: { transactionId: storeTxId },
          update: {
            status: "success",
            amount: txAmount,
          },
          create: {
            userId,
            transactionId: storeTxId,
            amount: txAmount,
            status: "success",
            name: user.name,
            phone: user.phone || null,
            type: "charge",
          },
        });
      }

      // 1) Newly active subscription -> Send Confirmation, Welcome, and Details emails
      if (!wasAlreadyActive && (status === "active" || status === "trial")) {
        console.log(`[RevenueCat Sync] Triggering Brevo subscription emails for newly active user ${user.email}`);
        try {
          await subscriptionConfirmationTemplate({
            userName: user.name,
            email: user.email,
            planName: planMeta?.name || "Monthly — Divine",
            price: `$${planMeta?.amount || 5.0}`,
            renewsAt: formattedExpiresAt,
            joinedAt: formattedJoinedAt,
          });
        } catch (err) {
          console.error("[RevenueCat Sync] Failed to send subscription confirmation email:", err);
        }

        try {
          await subscribedWelcomeTemplate({
            userName: user.name,
            email: user.email,
          });
        } catch (err) {
          console.error("[RevenueCat Sync] Failed to send subscribed welcome email:", err);
        }

        try {
          await subscriptionDetailsTemplate({
            userName: user.name,
            email: user.email,
            planName: planMeta?.name || "Monthly — Divine",
            price: `$${planMeta?.amount || 5.0}`,
            renewsAt: formattedExpiresAt,
            joinedAt: formattedJoinedAt,
          });
        } catch (err) {
          console.error("[RevenueCat Sync] Failed to send subscription details email:", err);
        }
      } else if (isRenewal) {
        // 2) Renewed subscription -> Send Subscription Renewed (Template #11)
        console.log(`[RevenueCat Sync] Triggering Brevo renewal email for user ${user.email}`);
        try {
          await subscriptionDetailsTemplate({
            userName: user.name,
            email: user.email,
            planName: planMeta?.name || "Monthly — Divine",
            price: `$${planMeta?.amount || 5.0}`,
            renewsAt: formattedExpiresAt,
            joinedAt: formattedJoinedAt,
          });
        } catch (err) {
          console.error("[RevenueCat Sync] Failed to send subscription renewal email:", err);
        }
      }

      // 3) Cancellation detected (unsubscribe_detected_at is set) -> Send Subscription Canceled (Template #9)
      if (shouldSendCancelEmail && unsubscribeDetectedAt) {
        console.log(`[RevenueCat Sync] Triggering Brevo subscription canceled email for user ${user.email}`);
        try {
          await subscriptionCanceledTemplate({
            userName: user.name,
            email: user.email,
            planName: planMeta?.name || "Monthly — Divine",
            price: `$${planMeta?.amount || 5.0}`,
            expiresAt: expiresDate ? formattedExpiresAt : "End of billing period",
            canceledAt: unsubscribeDetectedAt.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
            joinedAt: formattedJoinedAt,
          });
        } catch (err) {
          console.error("[RevenueCat Sync] Failed to send subscription canceled email:", err);
        }
      }

      // 4) Billing issue detected -> Send Billing Issue (Template #8)
      if (shouldSendBillingIssueEmail) {
        console.log(`[RevenueCat Sync] Triggering Brevo billing issue email for user ${user.email}`);
        try {
          await billingIssueTemplate({
            userName: user.name,
            email: user.email,
            planName: planMeta?.name || "Monthly — Divine",
            price: `$${planMeta?.amount || 5.0}`,
            renewsAt: formattedExpiresAt,
            joinedAt: formattedJoinedAt,
          });
        } catch (err) {
          console.error("[RevenueCat Sync] Failed to send billing issue email:", err);
        }
      }
    } else {
      // Exited or has no active subscriptions in RevenueCat -> inspect latest subscription record if any
      let latestSubProdId: string | null = existingSub?.productId || null;
      let latestSubObj: any = null;
      let latestExpMs = 0;

      for (const [subProdId, subObj] of Object.entries<any>(subscriptions)) {
        if (!subObj) continue;
        const expMs = subObj.expires_date ? new Date(subObj.expires_date).getTime() : 0;
        if (!latestSubObj || expMs >= latestExpMs) {
          latestSubObj = subObj;
          latestSubProdId = subProdId;
          latestExpMs = expMs;
        }
      }

      const planMeta = getPlanMeta(latestSubProdId);
      const unsubStr = latestSubObj?.unsubscribe_detected_at || latestSubObj?.refunded_at;
      const parsedUnsub = unsubStr ? new Date(unsubStr) : existingSub?.unsubscribeDetectedAt || null;
      const latestExpiresDate = latestSubObj?.expires_date
        ? new Date(latestSubObj.expires_date)
        : existingSub?.expiresDate || null;

      const hadSubscriptionHistory = Boolean(
        wasAlreadyActive || latestSubObj || existingSub?.productId
      );

      const shouldSendCancelEmail = Boolean(
        parsedUnsub &&
          !Number.isNaN(parsedUnsub.getTime()) &&
          !existingSub?.cancelEmailSentAt
      );

      const shouldSendExpiredEmail = Boolean(
        hadSubscriptionHistory &&
          wasAlreadyActive &&
          !existingSub?.expiredEmailSentAt
      );

      const expiredData = {
        status: "expired" as const,
        planType: "free" as const,
        productId: latestSubProdId,
        expiresDate: latestExpiresDate,
        purchaseDate: latestSubObj?.purchase_date
          ? new Date(latestSubObj.purchase_date)
          : existingSub?.purchaseDate || null,
        nextBillingAmount: null,
        nextBillingDate: null,
        autoRenewStatus: false,
        revenueCatUserId: matchedRevenueCatId || existingSub?.revenueCatUserId || userId,
        unsubscribeDetectedAt: parsedUnsub && !Number.isNaN(parsedUnsub.getTime()) ? parsedUnsub : null,
        cancelEmailSentAt: shouldSendCancelEmail ? now : existingSub?.cancelEmailSentAt || null,
        expiredEmailSentAt: shouldSendExpiredEmail ? now : existingSub?.expiredEmailSentAt || null,
      };

      await prisma.subscription.upsert({
        where: { userId },
        update: expiredData,
        create: {
          userId,
          ...expiredData,
        },
      });

      if (shouldSendCancelEmail && parsedUnsub) {
        console.log(`[RevenueCat Sync] Triggering Brevo subscription canceled email for expired/refunded user ${user.email}`);
        try {
          await subscriptionCanceledTemplate({
            userName: user.name,
            email: user.email,
            planName: planMeta?.name || "Monthly — Divine",
            price: `$${planMeta?.amount || 5.0}`,
            expiresAt: latestExpiresDate
              ? latestExpiresDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
              : "End of billing period",
            canceledAt: parsedUnsub.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
            joinedAt: formattedJoinedAt,
          });
        } catch (err) {
          console.error("[RevenueCat Sync] Failed to send subscription canceled email:", err);
        }
      }

      if (shouldSendExpiredEmail) {
        console.log(`[RevenueCat Sync] Triggering Brevo subscription ended email for user ${user.email}`);
        try {
          await subscriptionEndedTemplate({
            userName: user.name,
            email: user.email,
            planName: planMeta?.name || "Monthly — Divine",
            price: `$${planMeta?.amount || 5.0}`,
            endedAt: (latestExpiresDate || now).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
            joinedAt: formattedJoinedAt,
          });
        } catch (err) {
          console.error("[RevenueCat Sync] Failed to send subscription ended email:", err);
        }
      }
    }

    return skipDetailsReturn ? null : this.getSubscriptionDetails(userId, true);
  },

  /**
   * Explicitly mark a user's subscription as canceled and send the Brevo cancellation email
   */
  async cancelSubscription(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) {
      throw new AppError(httpStatus.NOT_FOUND, "User not found");
    }

    const sub = user.subscription;
    const now = new Date();
    const planMeta = getPlanMeta(sub?.productId || null);
    const expiresDate = sub?.expiresDate || null;
    const formattedExpiresAt = expiresDate
      ? expiresDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : "End of billing period";
    const formattedJoinedAt = user.createdAt
      ? user.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    await prisma.subscription.upsert({
      where: { userId },
      update: {
        autoRenewStatus: false,
        unsubscribeDetectedAt: sub?.unsubscribeDetectedAt || now,
        cancelEmailSentAt: now,
      },
      create: {
        userId,
        status: "expired",
        planType: "free",
        autoRenewStatus: false,
        unsubscribeDetectedAt: now,
        cancelEmailSentAt: now,
      },
    });

    try {
      await subscriptionCanceledTemplate({
        userName: user.name,
        email: user.email,
        planName: planMeta?.name || "Monthly — Divine",
        price: `$${planMeta?.amount || 5.0}`,
        expiresAt: formattedExpiresAt,
        canceledAt: now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        joinedAt: formattedJoinedAt,
      });
    } catch (err) {
      console.error("[Subscription Cancel] Failed to send subscription canceled email:", err);
    }

    return this.getSubscriptionDetails(userId, true);
  },

  /**
   * Background cron helper: Sync all active/trial subscriptions with RevenueCat to detect cancellations, renewals, billing issues, or expirations
   */
  async syncActiveSubscriptionsCron() {
    if (!config.revenueCat.apiKey) return;

    const activeSubs = await prisma.subscription.findMany({
      where: {
        status: { in: ["active", "trial"] },
      },
      select: {
        userId: true,
        revenueCatUserId: true,
      },
    });

    for (const sub of activeSubs) {
      try {
        await this.syncRevenueCatSubscription(
          sub.userId,
          sub.revenueCatUserId || undefined,
          true
        );
      } catch (err) {
        console.error(`[Subscription Cron] Failed syncing user ${sub.userId}:`, err);
      }
    }
  },

  /**
   * Process an incoming webhook from RevenueCat
   */
  async handleRevenueCatWebhook(payload: any) {
    const event = payload.event;
    if (!event) {
      throw new AppError(httpStatus.BAD_REQUEST, "Invalid webhook structure: Missing 'event' object.");
    }

    const eventType = event.type;
    const rawUserId = event.app_user_id;

    if (!rawUserId) {
      console.warn("[RevenueCat Webhook] Warning: Missing app_user_id in event.");
      return { success: true, message: "Missing app_user_id, skipped." };
    }

    const attrEmail =
      event.subscriber_attributes?.$email?.value ||
      event.subscriber_attributes?.email?.value ||
      null;

    // Safely look up user across ObjectId, permanentId, email, aliases, or subscriber_attributes email
    const candidateIds = [
      rawUserId,
      event.original_app_user_id,
      ...(Array.isArray(event.aliases) ? event.aliases : []),
      attrEmail,
    ].filter(Boolean) as string[];

    let user = null;
    for (const candidate of candidateIds) {
      user = await findUserByIdentifier(candidate);
      if (user) break;
    }

    // Fallback 1: Look up user via Transaction ID if webhook carries a known store transaction
    if (!user) {
      const txCandidates = [event.transaction_id, event.original_transaction_id].filter(Boolean) as string[];
      for (const txId of txCandidates) {
        const matchedTx = await prisma.transaction.findUnique({
          where: { transactionId: String(txId) },
          include: { user: true },
        });
        if (matchedTx?.user) {
          user = matchedTx.user;
          break;
        }
      }
    }

    // Fallback 2: Match by productId + originalPurchaseDate / purchaseDate on Subscription
    if (!user && event.product_id) {
      const origPurchaseDate = toDateFromMs(event.original_purchased_at_ms);
      const currPurchaseDate = toDateFromMs(event.purchased_at_ms);
      const dateFilters = [
        origPurchaseDate ? { originalPurchaseDate: origPurchaseDate } : null,
        currPurchaseDate ? { purchaseDate: currPurchaseDate } : null,
      ].filter(Boolean) as any[];

      if (dateFilters.length > 0) {
        const matchedSub = await prisma.subscription.findFirst({
          where: {
            productId: event.product_id,
            OR: dateFilters,
          },
          include: { user: true },
        });
        if (matchedSub?.user) {
          user = matchedSub.user;
        }
      }
    }

    if (!user) {
      console.warn(`[RevenueCat Webhook] Warning: User matching '${rawUserId}' not found in database. Candidate IDs checked:`, candidateIds);
      return { success: true, message: `User matching '${rawUserId}' not found in database, skipped.` };
    }

    const existingSub = await prisma.subscription.findUnique({
      where: { userId: user.id },
    });

    const now = new Date();
    const productId = event.product_id || existingSub?.productId || null;
    const planMeta = getPlanMeta(productId);
    const expiresDate = toDateFromMs(event.expiration_at_ms) || existingSub?.expiresDate || null;
    const purchaseDate = toDateFromMs(event.purchased_at_ms) || existingSub?.purchaseDate || null;
    const originalPurchaseDate =
      toDateFromMs(event.original_purchased_at_ms) || existingSub?.originalPurchaseDate || null;
    const store = event.store || existingSub?.paymentMethod || "App Store";

    let status: "active" | "trial" | "expired" = "expired";
    let planType: "free" | "monthly" | "annual" = "free";
    let autoRenewStatus = existingSub?.autoRenewStatus ?? true;
    let unsubscribeDetectedAt = existingSub?.unsubscribeDetectedAt || null;
    let billingIssueDetectedAt = existingSub?.billingIssueDetectedAt || null;
    let cancelEmailSentAt = existingSub?.cancelEmailSentAt || null;
    let expiredEmailSentAt = existingSub?.expiredEmailSentAt || null;
    let billingIssueEmailSentAt = existingSub?.billingIssueEmailSentAt || null;

    // Standardize event types
    switch (eventType) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "PRODUCT_CHANGE":
      case "UNCANCELLATION": {
        const isTrial = String(event.period_type || "").toUpperCase() === "TRIAL";
        status = isTrial ? "trial" : "active";
        planType = planMeta ? planMeta.type : "free";
        autoRenewStatus = true;
        unsubscribeDetectedAt = null;
        billingIssueDetectedAt = null;
        cancelEmailSentAt = null;
        expiredEmailSentAt = null;
        billingIssueEmailSentAt = null;
        break;
      }

      case "NON_RENEWING_PURCHASE":
        // Non-renewing purchases can still have an expiration; treat as active while not expired.
        if (expiresDate && expiresDate > now) {
          status = "active";
          planType = planMeta ? planMeta.type : "free";
        } else {
          status = "expired";
          planType = "free";
        }
        break;

      case "EXPIRATION":
        status = "expired";
        planType = "free";
        autoRenewStatus = false;
        break;

      case "CANCELLATION":
        // Auto-renew was turned off, but standard practice is to keep access until the expiration date.
        autoRenewStatus = false;
        unsubscribeDetectedAt = toDateFromMs(event.event_timestamp_ms) || now;
        if (expiresDate && expiresDate > now && event.cancel_reason !== "CUSTOMER_SUPPORT") {
          const isTrialCancel = String(event.period_type || "").toUpperCase() === "TRIAL";
          status = isTrialCancel ? "trial" : "active";
          planType = planMeta ? planMeta.type : "free";
        } else {
          status = "expired";
          planType = "free";
        }
        break;

      case "BILLING_ISSUE":
        status = expiresDate && expiresDate > now ? (existingSub?.status || "active") : "expired";
        planType = status === "expired" ? "free" : (planMeta ? planMeta.type : "free");
        billingIssueDetectedAt = toDateFromMs(event.event_timestamp_ms) || now;
        break;

      default:
        // For other events (e.g. SUBSCRIBER_ALIAS, TRANSFER), let's keep current state or skip
        return { success: true, message: `Skipping unmapped event type: ${eventType}` };
    }

    const formattedExpiresAt = expiresDate
      ? expiresDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : "End of billing period";
    const formattedJoinedAt = user.createdAt
      ? user.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const formattedPrice =
      event.price !== undefined ? `$${event.price}` : `$${planMeta?.amount || 5.0}`;

    if (eventType === "CANCELLATION") {
      cancelEmailSentAt = now;
    } else if (eventType === "EXPIRATION") {
      expiredEmailSentAt = now;
    } else if (eventType === "BILLING_ISSUE") {
      billingIssueEmailSentAt = now;
    }

    const subscriptionData = {
      status,
      planType,
      productId,
      expiresDate,
      purchaseDate,
      originalPurchaseDate,
      paymentMethod: normalizePaymentMethod(store),
      revenueCatUserId: rawUserId,
      autoRenewStatus,
      unsubscribeDetectedAt,
      billingIssueDetectedAt,
      cancelEmailSentAt,
      expiredEmailSentAt,
      billingIssueEmailSentAt,
    };

    // Upsert the subscription using the resolved user's database ID
    await prisma.subscription.upsert({
      where: { userId: user.id },
      update: subscriptionData,
      create: {
        userId: user.id,
        ...subscriptionData,
      },
    });

    if (eventType === "INITIAL_PURCHASE") {
      try {
        await subscriptionConfirmationTemplate({
          userName: user.name,
          email: user.email,
          planName: planMeta?.name || "Monthly — Divine",
          price: formattedPrice,
          renewsAt: expiresDate ? formattedExpiresAt : "N/A",
          joinedAt: formattedJoinedAt,
        });
      } catch (err) {
        console.error("[RevenueCat Webhook] Failed to send subscription confirmation email:", err);
      }

      try {
        await subscribedWelcomeTemplate({
          userName: user.name,
          email: user.email,
        });
      } catch (err) {
        console.error("[RevenueCat Webhook] Failed to send subscribed welcome email:", err);
      }

      try {
        await subscriptionDetailsTemplate({
          userName: user.name,
          email: user.email,
          planName: planMeta?.name || "Monthly — Divine",
          price: formattedPrice,
          renewsAt: expiresDate ? formattedExpiresAt : "N/A",
          joinedAt: formattedJoinedAt,
        });
      } catch (err) {
        console.error("[RevenueCat Webhook] Failed to send subscription details email:", err);
      }
    } else if (eventType === "RENEWAL") {
      try {
        await subscriptionDetailsTemplate({
          userName: user.name,
          email: user.email,
          planName: planMeta?.name || "Monthly — Divine",
          price: formattedPrice,
          renewsAt: expiresDate ? formattedExpiresAt : "N/A",
          joinedAt: formattedJoinedAt,
        });
      } catch (err) {
        console.error("[RevenueCat Webhook] Failed to send subscription renewal email:", err);
      }
    } else if (eventType === "CANCELLATION") {
      if (!existingSub?.cancelEmailSentAt) {
        try {
          await subscriptionCanceledTemplate({
            userName: user.name,
            email: user.email,
            planName: planMeta?.name || "Monthly — Divine",
            price: formattedPrice,
            expiresAt: formattedExpiresAt,
            canceledAt: (unsubscribeDetectedAt || now).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
            joinedAt: formattedJoinedAt,
          });
        } catch (err) {
          console.error("[RevenueCat Webhook] Failed to send subscription canceled email:", err);
        }
      }
    } else if (eventType === "EXPIRATION") {
      if (!existingSub?.expiredEmailSentAt) {
        try {
          await subscriptionEndedTemplate({
            userName: user.name,
            email: user.email,
            planName: planMeta?.name || "Monthly — Divine",
            price: formattedPrice,
            endedAt: (expiresDate || now).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
            joinedAt: formattedJoinedAt,
          });
        } catch (err) {
          console.error("[RevenueCat Webhook] Failed to send subscription ended email:", err);
        }
      }
    } else if (eventType === "BILLING_ISSUE") {
      if (!existingSub?.billingIssueEmailSentAt) {
        try {
          await billingIssueTemplate({
            userName: user.name,
            email: user.email,
            planName: planMeta?.name || "Monthly — Divine",
            price: formattedPrice,
            renewsAt: expiresDate ? formattedExpiresAt : "N/A",
            joinedAt: formattedJoinedAt,
          });
        } catch (err) {
          console.error("[RevenueCat Webhook] Failed to send billing issue email:", err);
        }
      }
    }

    // Create a transaction record for charges or refunds
    const txId = event.transaction_id || event.original_transaction_id || event.id;
    const priceAmount =
      typeof event.price === "number"
        ? event.price
        : typeof event.price_in_purchased_currency === "number"
          ? event.price_in_purchased_currency
          : (planMeta?.amount ?? 0);

    if (txId && (status === "active" || status === "trial" || eventType === "CANCELLATION")) {
      const type =
        eventType === "CANCELLATION" && event.cancel_reason !== "UNSUBSCRIBE"
          ? "refund"
          : "charge";

      await prisma.transaction.upsert({
        where: { transactionId: String(txId) },
        update: {
          status: "success",
          amount: priceAmount,
        },
        create: {
          userId: user.id,
          transactionId: String(txId),
          amount: priceAmount,
          status: "success",
          name: user.name,
          phone: user.phone || null,
          type,
        },
      });
    }

    return { success: true, message: `Successfully handled event: ${eventType}` };
  },
};
