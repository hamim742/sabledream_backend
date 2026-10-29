import sendEmail from "../sendEmail";
import { sendBrevoEmail } from "../sendBrevoEmail";

interface SubscriptionCanceledData {
  userName: string;
  email: string;
  planName?: string;
  price?: string;
  expiresAt?: string;
  canceledAt?: string;
  joinedAt?: string;
}

export const subscriptionCanceledTemplate = async (
  data: SubscriptionCanceledData,
) => {
  const { userName, email, planName, price, expiresAt, canceledAt, joinedAt } = data;
  const resolvedPlanName = planName || "Monthly — Divine";
  const resolvedPrice = price || "$5.00";
  const resolvedExpiresAt = expiresAt || "End of billing period";
  const resolvedCanceledAt =
    canceledAt ||
    new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  const resolvedJoinedAt =
    joinedAt ||
    new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  if (process.env.BREVO_API_KEY || process.env.SMTP_PASS) {
    try {
      await sendBrevoEmail({
        toEmail: email,
        toName: userName,
        templateId: 9, // Brevo Template #9: Subscription canceled
        params: {
          FNAME: userName,
          NAME: userName,
          userName,
          name: userName,
          PLAN_NAME: resolvedPlanName,
          planName: resolvedPlanName,
          SUBSCRIPTION_PRICE: resolvedPrice,
          price: resolvedPrice,
          EXPIRES_AT: resolvedExpiresAt,
          EXPIRATION_DATE: resolvedExpiresAt,
          END_DATE: resolvedExpiresAt,
          ACCESS_UNTIL: resolvedExpiresAt,
          RENEWAL_DATE: resolvedExpiresAt,
          expiresAt: resolvedExpiresAt,
          renewsAt: resolvedExpiresAt,
          CANCELED_AT: resolvedCanceledAt,
          CANCELLATION_DATE: resolvedCanceledAt,
          canceledAt: resolvedCanceledAt,
          USER_EMAIL: email,
          email,
          ACCOUNT_DATE: resolvedJoinedAt,
          joinedAt: resolvedJoinedAt,
        },
      });
      return;
    } catch (brevoErr) {
      console.warn(
        "[Email] Brevo API failed for subscriptionCanceled, falling back to SMTP:",
        brevoErr,
      );
    }
  }

  const subject = "💔 Your Sable Dreams Subscription Has Been Canceled";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Subscription Canceled</title>
</head>
<body style="font-family: Georgia, serif; padding: 20px; color: #333;">
  <h2>Hello, ${userName || "Sable Dreamer"}</h2>
  <p>Your subscription (${planName || "Sable Dreams"}) has been canceled.</p>
  <p>You will continue to have access until <strong>${expiresAt || "the end of your billing cycle"}</strong>.</p>
  <p>Thank you for being part of Sable Dreams 💕</p>
</body>
</html>
  `;

  await sendEmail(email, subject, html);
};
