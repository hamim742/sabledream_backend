import { Router } from "express";
import checkAuth from "../../middleware/checkAuth";
import { SubscriptionController } from "./subscription.controller";

const router = Router();

// Retrieve user's current subscription details
router.get(
  ["/me", "/details"],
  checkAuth("user", "admin"),
  SubscriptionController.getSubscriptionDetails
);

// Retrieve user's transaction/billing history
router.get(
  "/billing-history",
  checkAuth("user", "admin"),
  SubscriptionController.getBillingHistory
);

// Manually trigger a synchronization check with RevenueCat
router.post(
  "/sync",
  checkAuth("user", "admin"),
  SubscriptionController.syncSubscription
);

// Cancel subscription and send cancellation email notification
router.post(
  "/cancel",
  checkAuth("user", "admin"),
  SubscriptionController.cancelSubscription
);

router.patch(
  "/cancel",
  checkAuth("user", "admin"),
  SubscriptionController.cancelSubscription
);

// Webhook listener for background events from RevenueCat
router.post(
  "/webhook",
  SubscriptionController.handleWebhook
);

export const SubscriptionRoutes = router;
