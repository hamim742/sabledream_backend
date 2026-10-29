import sendEmail from "../sendEmail";
import { sendBrevoEmail } from "../sendBrevoEmail";

interface SubscriptionEndedData {
  userName: string;
  email: string;
  planName?: string;
  price?: string;
  endedAt?: string;
  joinedAt?: string;
}

export const subscriptionEndedTemplate = async (
  data: SubscriptionEndedData,
) => {
  const { userName, email, planName, price, endedAt, joinedAt } = data;
  const resolvedPlanName = planName || "Monthly — Divine";
  const resolvedPrice = price || "$5.00";
  const resolvedEndedAt =
    endedAt ||
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
        templateId: 10, // Brevo Template #10: Subscription ended
        params: {
          FNAME: userName,
          NAME: userName,
          userName,
          name: userName,
          PLAN_NAME: resolvedPlanName,
          planName: resolvedPlanName,
          SUBSCRIPTION_PRICE: resolvedPrice,
          price: resolvedPrice,
          ENDED_AT: resolvedEndedAt,
          EXPIRATION_DATE: resolvedEndedAt,
          END_DATE: resolvedEndedAt,
          EXPIRES_AT: resolvedEndedAt,
          endedAt: resolvedEndedAt,
          expiresAt: resolvedEndedAt,
          USER_EMAIL: email,
          email,
          ACCOUNT_DATE: resolvedJoinedAt,
          joinedAt: resolvedJoinedAt,
        },
      });
      return;
    } catch (brevoErr) {
      console.warn(
        "[Email] Brevo API failed for subscriptionEnded, falling back to SMTP:",
        brevoErr,
      );
    }
  }

  const subject = "🥀 Your Sable Dreams Subscription Has Ended";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Subscription Ended</title>
</head>
<body style="font-family: Georgia, serif; padding: 20px; color: #333;">
  <h2>Hello, ${userName || "Sable Dreamer"}</h2>
  <p>Your subscription (${planName || "Sable Dreams"}) has now ended.</p>
  <p>You can resubscribe anytime from the Sable Dreams app to restore full access. 💕</p>
</body>
</html>
  `;

  await sendEmail(email, subject, html);
};
