import sendEmail from "../sendEmail";
import { sendBrevoEmail } from "../sendBrevoEmail";

interface SubscribedWelcomeData {
  userName: string;
  email: string;
}

export const subscribedWelcomeTemplate = async (
  data: SubscribedWelcomeData,
) => {
  const { userName, email } = data;

  if (process.env.BREVO_API_KEY || process.env.SMTP_PASS) {
    try {
      await sendBrevoEmail({
        toEmail: email,
        toName: userName,
        templateId: 4, // Brevo Template #4: Subscribed Welcome Email
        params: {
          FNAME: userName,
          NAME: userName,
          userName,
          name: userName,
          USER_EMAIL: email,
          email,
        },
      });
      return;
    } catch (brevoErr) {
      console.warn("[Email] Brevo API failed for subscribedWelcome, falling back to SMTP:", brevoErr);
    }
  }

  const subject = "✨ Welcome to Sable Dreams Membership — Dream Boldly, Live Softly";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Subscribed Welcome</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background-color: #fdf0f4; font-family: Georgia, 'Times New Roman', serif; -webkit-font-smoothing: antialiased; }
  .email-outer { background-color: #fdf0f4; padding: 32px 16px 48px; }
  .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 4px 32px rgba(186,113,152,0.13); }
  .hero { background: linear-gradient(160deg, #f2c4d8 0%, #e8a0c0 40%, #d4749e 100%); padding: 48px 32px; text-align: center; }
  .hero-title { font-family: Georgia, serif; font-style: italic; font-size: 32px; color: #6b1a3a; margin-bottom: 10px; }
  .hero-subtitle { font-family: Georgia, serif; font-style: italic; font-size: 15px; color: #8a2f54; }
  .body-section { padding: 40px; background: #ffffff; }
  .greeting { font-family: Georgia, serif; font-size: 20px; font-weight: 700; color: #1a1018; margin-bottom: 20px; }
  .body-text { font-family: Georgia, serif; font-size: 15px; line-height: 1.8; color: #3d2030; margin-bottom: 16px; }
  .footer { background: #fef0f6; border-top: 1px solid #f0d0e4; padding: 24px; text-align: center; font-size: 12px; color: #9a6070; }
</style>
</head>
<body>
<div class="email-outer">
  <div class="email-container">
    <div class="hero">
      <div class="hero-title">Welcome to Sable Dreams</div>
      <div class="hero-subtitle">Where your inner world finds its rhythm. ✨</div>
    </div>
    <div class="body-section">
      <div class="greeting">Hello, ${userName || "Sable Dreamer"}! 💕</div>
      <p class="body-text">Thank you for subscribing to Sable Dreams. We're honored to accompany you on your journey of becoming.</p>
      <p class="body-text">Explore unlimited reflections, deep journal prompts, affirmations, and the gentle space created just for you.</p>
      <p class="body-text" style="font-weight: bold; color: #6b1a3a; margin-top: 24px;">Dream boldly. Live softly. 🌸</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Sable Dreams. Made with 💖 for you.</p>
    </div>
  </div>
</div>
</body>
</html>
  `;

  await sendEmail(email, subject, html);
};
