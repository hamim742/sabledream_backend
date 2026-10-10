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
  async getSubscriptionDetails(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) {
      throw new AppError(httpStatus.NOT_FOUND, "User not found");
    }

    const sub = user.subscription;

    // Check if subscription has expired based on expiry date
    let status: "active" | "trial" | "expired" = "expired";
    let hasActivePremium = false;

    if (sub && sub.status !== "expired" && sub.expiresDate) {
      const now = new Date();
      if (sub.expiresDate > now) {
        status = sub.status as "active" | "trial";
        hasActivePremium = true;
      }
    }

    const planMeta = sub ? getPlanMeta(sub.productId) : null;

    // Build Figma UI mapping response
    return {
      status,
      currentPlan: {
        name: planMeta ? planMeta.name : "Free Tier",
        type: planMeta ? planMeta.type : "free",
        productId: sub?.productId || null,
        expiresAt: sub?.expiresDate || null,
      },
      billingDetails: {
        nextBillingAmount: hasActivePremium && planMeta ? planMeta.amount : null,
        nextBillingDate: hasActivePremium ? sub?.expiresDate || null : null,
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
  async syncRevenueCatSubscription(userId: string, incomingAppUserId?: string) {
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

    // Try candidates: incomingAppUserId from client, user.id (MongoDB id), permanentId, email, and existing revenueCatUserId
    const candidateIds = [
      incomingAppUserId,
      user.id,
      user.permanentId,
      user.email,
      user.subscription?.revenueCatUserId,
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
            subscriber = data.subscriber;
            matchedRevenueCatId = candidate;
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
      return this.getSubscriptionDetails(userId);
    }

    // 1. Check for active entitlement
    const entitlements = subscriber.entitlements || {};
    let activeEntitlementKey: string | null = null;
    let activeEntitlement: any = null;

    for (const key of Object.keys(entitlements)) {
      const entitlement = entitlements[key];
      const expiresDateStr = entitlement.expires_date;
      if (expiresDateStr) {
        const expiresDate = new Date(expiresDateStr);
        if (expiresDate > new Date()) {
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

    if (activeEntitlementKey && activeEntitlement) {
      hasActiveSubscription = true;
      productId = activeEntitlement.product_identifier;
      expiresDate = activeEntitlement.expires_date ? new Date(activeEntitlement.expires_date) : null;
      purchaseDate = activeEntitlement.purchase_date ? new Date(activeEntitlement.purchase_date) : null;
      originalPurchaseDate = activeEntitlement.original_purchase_date
        ? new Date(activeEntitlement.original_purchase_date)
        : null;
      isTrial = activeEntitlement.period_type === "trial";
      const subObj = productId ? subscriber.subscriptions?.[productId] : null;
      paymentStore = subObj?.store || "App Store";
      storeTxId = subObj?.store_transaction_id || null;
    } else {
      // Fallback: Check subscriber.subscriptions directly (in case RevenueCat Entitlement was not linked in dashboard)
      const subscriptions = subscriber.subscriptions || {};
      const now = new Date();
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
          isTrial = subObj.period_type === "trial";
          paymentStore = subObj.store || "App Store";
          storeTxId = subObj.store_transaction_id || null;
          break;
        }
      }
    }

    if (hasActiveSubscription && productId) {
      const planMeta = getPlanMeta(productId);
      const status = isTrial ? "trial" : "active";
      const planType = planMeta ? planMeta.type : "free";

      const subscriptionData = {
        status: status as any,
        planType: planType as any,
        productId,
        expiresDate,
        purchaseDate,
        originalPurchaseDate,
        paymentMethod: normalizePaymentMethod(paymentStore),
        revenueCatUserId: matchedRevenueCatId || userId,
      };

      const wasAlreadyActive = user.subscription && (user.subscription.status === "active" || user.subscription.status === "trial");

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

      // If user transitioned to active/trial, trigger Brevo subscription confirmation emails
      if (!wasAlreadyActive && (status === "active" || status === "trial")) {
        console.log(`[RevenueCat Sync] Triggering Brevo subscription emails for newly active user ${user.email}`);
        try {
          await subscriptionConfirmationTemplate({
            userName: user.name,
            email: user.email,
            planName: planMeta?.name || "Monthly — Divine",
            price: `$${planMeta?.amount || 5.0}`,
            renewsAt: expiresDate
              ? expiresDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
              : "N/A",
            joinedAt: user.createdAt
              ? user.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
              : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
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
            planName: planMeta?.name || "Premium Plan",
            price: `$${planMeta?.amount || 5.0}`,
            renewsAt: expiresDate
              ? expiresDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
              : "N/A",
            joinedAt: user.createdAt
              ? user.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
              : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
          });
        } catch (err) {
          console.error("[RevenueCat Sync] Failed to send subscription details email:", err);
        }
      }
    } else {
      // Exited or has no active subscriptions, mark as expired
      const expiredData = {
        status: "expired" as const,
        planType: "free" as const,
        productId: null,
        expiresDate: null,
        purchaseDate: null,
        nextBillingAmount: null,
        nextBillingDate: null,
      };

      await prisma.subscription.upsert({
        where: { userId },
        update: expiredData,
        create: {
          userId,
          ...expiredData,
        },
      });
    }

    return this.getSubscriptionDetails(userId);
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

    // Safely look up user across ObjectId, permanentId, email, or aliases
    const candidateIds = [
      rawUserId,
      event.original_app_user_id,
      ...(Array.isArray(event.aliases) ? event.aliases : []),
    ].filter(Boolean) as string[];

    let user = null;
    for (const candidate of candidateIds) {
      user = await findUserByIdentifier(candidate);
      if (user) break;
    }

    if (!user) {
      console.warn(`[RevenueCat Webhook] Warning: User matching '${rawUserId}' not found in database. Candidate IDs checked:`, candidateIds);
      return { success: true, message: `User matching '${rawUserId}' not found in database, skipped.` };
    }

    const productId = event.product_id;
    const planMeta = getPlanMeta(productId);
    const expiresDate = toDateFromMs(event.expiration_at_ms);
    const purchaseDate = toDateFromMs(event.purchased_at_ms);
    const originalPurchaseDate = toDateFromMs(event.original_purchased_at_ms);
    const store = event.store || "App Store";

    let status: "active" | "trial" | "expired" = "expired";
    let planType: "free" | "monthly" | "annual" = "free";

    // Standardize event types
    switch (eventType) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "PRODUCT_CHANGE":
      case "UNCANCELLATION":
        const isTrial = event.period_type === "TRIAL";
        status = isTrial ? "trial" : "active";
        planType = planMeta ? planMeta.type : "free";
        break;

      case "NON_RENEWING_PURCHASE":
        // Non-renewing purchases can still have an expiration; treat as active while not expired.
        if (expiresDate && expiresDate > new Date()) {
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
        break;

      case "CANCELLATION":
        // Auto-renew was turned off, but standard practice is to keep access until the expiration date.
        // Let's verify if the expiresDate is in the future.
        if (expiresDate && expiresDate > new Date()) {
          const isTrialCancel = event.period_type === "TRIAL";
          status = isTrialCancel ? "trial" : "active";
          planType = planMeta ? planMeta.type : "free";
        } else {
          status = "expired";
          planType = "free";
        }
        break;

      case "BILLING_ISSUE":
        // Subscriptions that fail renewal will transition to expired (or grace period, which we simplify to expired for now)
        status = "expired";
        planType = "free";
        break;

      default:
        // For other events (e.g. SUBSCRIBER_ALIAS, TRANSFER), let's keep current state or skip
        return { success: true, message: `Skipping unmapped event type: ${eventType}` };
    }

    const subscriptionData = {
      status,
      planType,
      productId: status === "expired" ? null : productId,
      expiresDate,
      purchaseDate,
      originalPurchaseDate,
      paymentMethod: normalizePaymentMethod(store),
      revenueCatUserId: rawUserId,
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
          price: event.price !== undefined ? `$${event.price}` : `$${planMeta?.amount || 5.0}`,
          renewsAt: expiresDate ? expiresDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "N/A",
          joinedAt: user.createdAt ? user.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
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
          planName: planMeta?.name || "Premium Plan",
          price: event.price !== undefined ? `$${event.price}` : `$${planMeta?.amount || 5.0}`,
          renewsAt: expiresDate ? expiresDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "N/A",
          joinedAt: user.createdAt ? user.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        });
      } catch (err) {
        console.error("[RevenueCat Webhook] Failed to send subscription details email:", err);
      }
    } else if (eventType === "RENEWAL") {
      try {
        await subscriptionDetailsTemplate({
          userName: user.name,
          email: user.email,
          planName: planMeta?.name || "Premium Plan",
          price: event.price !== undefined ? `$${event.price}` : `$${planMeta?.amount || 5.0}`,
          renewsAt: expiresDate ? expiresDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "N/A",
          joinedAt: user.createdAt ? user.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        });
      } catch (err) {
        console.error("[RevenueCat Webhook] Failed to send subscription renewal email:", err);
      }
    } else if (eventType === "CANCELLATION") {
      try {
        await subscriptionCanceledTemplate({
          userName: user.name,
          email: user.email,
          planName: planMeta?.name || "Premium Plan",
          expiresAt: expiresDate ? expiresDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "End of billing period",
        });
      } catch (err) {
        console.error("[RevenueCat Webhook] Failed to send subscription canceled email:", err);
      }
    } else if (eventType === "EXPIRATION") {
      try {
        await subscriptionEndedTemplate({
          userName: user.name,
          email: user.email,
          planName: planMeta?.name || "Premium Plan",
        });
      } catch (err) {
        console.error("[RevenueCat Webhook] Failed to send subscription ended email:", err);
      }
    } else if (eventType === "BILLING_ISSUE") {
      try {
        await billingIssueTemplate({
          userName: user.name,
          email: user.email,
          planName: planMeta?.name || "Premium Plan",
        });
      } catch (err) {
        console.error("[RevenueCat Webhook] Failed to send billing issue email:", err);
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
