import sendEmail from "../sendEmail";
import { sendBrevoEmail } from "../sendBrevoEmail";

interface BillingIssueData {
  userName: string;
  email: string;
  planName?: string;
  price?: string;
  renewsAt?: string;
  joinedAt?: string;
}

export const billingIssueTemplate = async (data: BillingIssueData) => {
  const { userName, email, planName, price, renewsAt, joinedAt } = data;
  const resolvedPlanName = planName || "Monthly — Divine";
  const resolvedPrice = price || "$5.00";
  const resolvedRenewsAt = renewsAt || "N/A";
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
        templateId: 8, // Brevo Template #8: Billing Issue
        params: {
          FNAME: userName,
          NAME: userName,
          userName,
          name: userName,
          PLAN_NAME: resolvedPlanName,
          planName: resolvedPlanName,
          SUBSCRIPTION_PRICE: resolvedPrice,
          price: resolvedPrice,
          RENEWAL_DATE: resolvedRenewsAt,
          renewsAt: resolvedRenewsAt,
          USER_EMAIL: email,
          email,
          ACCOUNT_DATE: resolvedJoinedAt,
          joinedAt: resolvedJoinedAt,
        },
      });
      return;
    } catch (brevoErr) {
      console.warn(
        "[Email] Brevo API failed for billingIssue, falling back to SMTP:",
        brevoErr,
      );
    }
  }

  const subject = "⚠️ Payment Issue with Your Sable Dreams Subscription";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Billing Issue</title>
</head>
<body style="font-family: Georgia, serif; padding: 20px; color: #333;">
  <h2>Hello, ${userName || "Sable Dreamer"}</h2>
  <p>We encountered a billing issue while attempting to renew your <strong>${planName || "Sable Dreams"}</strong> subscription.</p>
  <p>Please update your payment details in your App Store or Google Play account to maintain uninterrupted access.</p>
  <p>Thank you 💕</p>
</body>
</html>
  `;

  await sendEmail(email, subject, html);
};
