import sendEmail from "../sendEmail";
import { sendBrevoEmail } from "../sendBrevoEmail";

interface SubscriptionConfirmationData {
  userName: string;
  email: string;
  planName?: string;
  price?: string;
  renewsAt?: string;
  joinedAt?: string;
}

export const subscriptionConfirmationTemplate = async (
  data: SubscriptionConfirmationData,
) => {
  const { userName, email, planName, price, renewsAt, joinedAt } = data;

  if (process.env.BREVO_API_KEY || process.env.SMTP_PASS) {
    try {
      await sendBrevoEmail({
        toEmail: email,
        toName: userName,
        templateId: 5, // Brevo Template #5: Subscription Confirmation Email
        params: {
          FNAME: userName,
          NAME: userName,
          userName,
          name: userName,
          PLAN_NAME: planName || "Monthly — Divine",
          SUBSCRIPTION_PRICE: price || "$5.00",
          RENEWAL_DATE: renewsAt || "N/A",
          USER_EMAIL: email,
          ACCOUNT_DATE: joinedAt || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        },
      });
      return;
    } catch (brevoErr) {
      console.warn("[Email] Brevo API failed for subscriptionConfirmation, falling back to SMTP:", brevoErr);
    }
  }

  const subject = "💕 Welcome to Sable Dreams — Your Journey Begins Now";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Subscription Confirmed</title>
<style>
  /* Reset */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background-color: #f5e8ef; font-family: Georgia, 'Times New Roman', serif; -webkit-font-smoothing: antialiased; }

  /* Outer wrapper */
  .email-outer {
    background-color: #f5e8ef;
    padding: 32px 16px 48px;
  }

  /* Main container */
  .email-container {
    max-width: 600px;
    margin: 0 auto;
    background: #ffffff;
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 4px 32px rgba(186,113,152,0.13);
  }

  /* ── HERO HEADER ── */
  .hero {
    position: relative;
    background: linear-gradient(160deg, #f2c4d8 0%, #e8a0c0 40%, #d4749e 100%);
    padding: 48px 32px 0;
    text-align: center;
    overflow: hidden;
  }

  /* Watermark text behind hero content */
  .hero-watermark {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    padding-top: 8px;
    gap: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .hero-watermark span {
    font-family: Georgia, serif;
    font-style: italic;
    font-size: 13px;
    color: rgba(255,255,255,0.22);
    letter-spacing: 1px;
    line-height: 2;
    white-space: nowrap;
    display: block;
    transform: rotate(-8deg);
    transform-origin: center;
    width: 140%;
    margin-left: -20%;
  }

  .hero-content { position: relative; z-index: 2; }

  /* Wax seal SVG */
  .wax-seal {
    display: inline-block;
    margin-bottom: 18px;
  }

  /* Hero title — script style */
  .hero-title {
    font-family: Georgia, serif;
    font-style: italic;
    font-size: 36px;
    font-weight: 400;
    color: #6b1a3a;
    line-height: 1.15;
    margin-bottom: 10px;
    letter-spacing: -0.5px;
  }

  .hero-subtitle {
    font-family: Georgia, serif;
    font-style: italic;
    font-size: 15px;
    color: #8a2f54;
    margin-bottom: 14px;
    line-height: 1.5;
  }

  .hero-tagline {
    display: inline-block;
    font-family: Arial, sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #7a2748;
    margin-bottom: 24px;
  }

  /* Hero banner strip */
  .hero-banner {
    background: linear-gradient(90deg, #c05880, #d4749e);
    padding: 14px 24px;
    margin: 0 -32px;
    margin-top: 0;
  }
  .hero-banner p {
    font-family: Arial, sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: #ffffff;
    text-align: center;
  }

  /* ── BODY SECTION ── */
  .body-section {
    padding: 40px 40px 0;
    background: #ffffff;
    position: relative;
    overflow: hidden;
  }

  .body-content { position: relative; z-index: 1; }

  .greeting {
    font-family: Georgia, serif;
    font-size: 22px;
    font-weight: 700;
    color: #1a1018;
    margin-bottom: 24px;
  }

  .body-text {
    font-family: Georgia, serif;
    font-size: 15px;
    line-height: 1.8;
    color: #3d2030;
    margin-bottom: 18px;
  }

  .body-text strong { color: #c05880; font-weight: 700; }

  /* Bullet lists styles */
  .bullet-list {
    margin-left: 20px;
    margin-bottom: 20px;
  }
  .bullet-list li {
    font-family: Georgia, serif;
    font-size: 15px;
    line-height: 1.8;
    color: #3d2030;
    margin-bottom: 8px;
  }

  /* Divider */
  .divider {
    height: 1px;
    background: linear-gradient(to right, transparent, #e8c0d4, transparent);
    margin: 28px 0;
  }

  /* Signature Block */
  .signature-container {
    margin-top: 32px;
    margin-bottom: 40px;
  }
  
  .signature-name {
    font-family: 'Great Vibes', 'Playfair Display', Georgia, serif;
    font-style: italic;
    font-size: 32px;
    font-weight: bold;
    color: #6b1a3a;
    line-height: 1.2;
    margin-bottom: 6px;
  }

  .signature-title {
    font-family: Georgia, serif;
    font-size: 14px;
    color: #8a4060;
    line-height: 1.4;
  }

  .signature-tagline {
    font-family: Arial, sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #c05880;
    margin-top: 4px;
  }

  /* ── FOOTER ── */
  .footer {
    background: #fef0f6;
    border-top: 1px solid #f0d0e4;
    padding: 28px 40px 32px;
    text-align: center;
  }

  /* Three hearts */
  .footer-hearts {
    font-size: 16px;
    color: #e0b0c8;
    letter-spacing: 8px;
    margin-bottom: 18px;
  }

  /* Footer wax seal */
  .footer-seal { margin-bottom: 14px; }

  .footer-brand {
    font-family: Georgia, serif;
    font-style: italic;
    font-size: 22px;
    color: #c05880;
    margin-bottom: 4px;
  }

  .footer-tagline {
    font-family: Georgia, serif;
    font-style: italic;
    font-size: 12px;
    color: #b090a0;
    margin-bottom: 18px;
  }

  .footer-body {
    font-family: Arial, sans-serif;
    font-size: 11px;
    color: #9a6070;
    line-height: 1.6;
    margin-bottom: 16px;
  }
  .footer-body a { color: #c05880; text-decoration: none; }

  .footer-links {
    font-family: Arial, sans-serif;
    font-size: 11px;
    margin-bottom: 18px;
  }
  .footer-links a {
    color: #b090a0;
    text-decoration: none;
    margin: 0 4px;
  }
  .footer-links a:hover { text-decoration: underline; }

  .footer-copy {
    font-family: Arial, sans-serif;
    font-size: 10px;
    color: #c0a0b0;
  }
</style>
</head>
<body>
<div class="email-outer">
<div class="email-container">

  <!-- ════════════════════════════════════════ -->
  <!-- HERO HEADER                              -->
  <!-- ════════════════════════════════════════ -->
  <div class="hero">
    <!-- Rotating watermark strip -->
    <div class="hero-watermark" aria-hidden="true">
      <span>sable dreams &nbsp;✦&nbsp; dream boldly &nbsp;✦&nbsp; live softly &nbsp;✦&nbsp; dream &nbsp;✦&nbsp; believe &nbsp;✦&nbsp; become &nbsp;✦&nbsp; sable dreams &nbsp;✦&nbsp; dream boldly &nbsp;✦&nbsp; live softly &nbsp;✦&nbsp; dream &nbsp;✦&nbsp; believe &nbsp;✦&nbsp; become &nbsp;✦&nbsp;</span>
      <span>sable dreams &nbsp;✦&nbsp; dream boldly &nbsp;✦&nbsp; live softly &nbsp;✦&nbsp; dream &nbsp;✦&nbsp; believe &nbsp;✦&nbsp; become &nbsp;✦&nbsp; sable dreams &nbsp;✦&nbsp; dream boldly &nbsp;✦&nbsp; live softly &nbsp;✦&nbsp; dream &nbsp;✦&nbsp; believe &nbsp;✦&nbsp; become &nbsp;✦&nbsp;</span>
    </div>

    <div class="hero-content">
      <!-- Seal/Stamp -->
      <div class="wax-seal" style="margin-bottom: 18px;">
        <img src="https://imglink.cc/cdn/K5i74ZtPzJ.png" alt="Sable Dreams Logo" width="64" height="64" style="display: block; margin: 0 auto; border: none; outline: none; text-decoration: none;" />
      </div>

      <!-- Title -->
      <div class="hero-title">Welcome to Sable Dreams</div>
      <div class="hero-subtitle">Where your inner world finds its rhythm. 🌷</div>
      <div class="hero-tagline">Subscription Confirmed ✦</div>
    </div>

    <!-- Banner strip -->
    <div class="hero-banner">
      <p>✨ &nbsp; Your Journey Begins Now — You're Subscribed!</p>
    </div>
  </div>

  <!-- ════════════════════════════════════════ -->
  <!-- BODY                                     -->
  <!-- ════════════════════════════════════════ -->
  <div class="body-section">

    <div class="body-content">

      <!-- Greeting -->
      <div class="greeting">Hello, ${userName}! 💕</div>

      <p class="body-text">
        You’re here. And something beautiful is beginning.
      </p>

      <p class="body-text">
        Welcome to Sable Dreams.💕
      </p>

      <p class="body-text">
        You didn’t just subscribe to a journaling app. You made a decision to create space for yourself—for your thoughts, your dreams, your healing, your desires, and the woman you are becoming.
      </p>

      <p class="body-text">
        There is so much ahead of you:
      </p>

      <ul class="bullet-list">
        <li>New dreams you haven’t dreamed yet.✨</li>
        <li>New things you’ll learn about yourself.</li>
        <li>New ways you’ll choose yourself.</li>
        <li>New possibilities you’ll finally allow yourself to believe in.</li>
      </ul>

      <p class="body-text">
        Some days, becoming will look like dreaming bigger.
      </p>

      <p class="body-text">
        Other days, it will look like slowing down, taking a breath, and giving yourself permission to simply be.
      </p>

      <p class="body-text">
        There is room for all of it here.
      </p>

      <p class="body-text">
        Sable Dreams was created to be a beautiful place you can return to each day to reflect, write, imagine, believe, and become.
      </p>

      <p class="body-text" style="font-style: italic; color: #6b1a3a;">
        So take your time.
      </p>

      <p class="body-text">
        Pour the coffee. Light the candle. Get comfortable.
      </p>

      <p class="body-text">
        Your next chapter doesn’t have to happen all at once.
      </p>

      <p class="body-text">
        Can’t wait to meet you here, one day at a time.
      </p>

      <p class="body-text">
        Welcome to Sable Dreams. I’m so happy you’re here.🤎
      </p>

      <p class="body-text" style="font-weight: bold; font-style: italic; color: #6b1a3a;">
        Dream boldly. Live softly.
      </p>

      <div class="divider"></div>

      <!-- Signature -->
      <div class="signature-container">
        <div class="signature-name">Tameka</div>
        <div class="signature-title">Sable Dreams</div>
        <div class="signature-tagline">DREAM. BELIEVE. BECOME.</div>
      </div>

    </div>
  </div>

  <!-- ════════════════════════════════════════ -->
  <!-- FOOTER                                   -->
  <!-- ════════════════════════════════════════ -->
  <div class="footer">

    <div class="footer-hearts">♡ &nbsp; ♡ &nbsp; ♡</div>

    <!-- Footer wax seal -->
    <div class="footer-seal" style="margin-bottom: 14px;">
      <img src="https://imglink.cc/cdn/K5i74ZtPzJ.png" alt="Sable Dreams Logo" width="52" height="52" style="display: block; margin: 0 auto; border: none; outline: none; text-decoration: none;" />
    </div>

    <div class="footer-brand">Sable Dreams</div>
    <div class="footer-tagline">Dream. Believe. Become.</div>

    <p class="footer-body">
      You're receiving this because you subscribed to Sable Dreams.<br/>
      Questions? <a href="#">Contact our support team</a> — we're always here for you.
    </p>

    <div class="footer-links">
      <a href="#">Privacy Policy</a> &nbsp;·&nbsp;
      <a href="#">Terms of Service</a> &nbsp;·&nbsp;
      <a href="#">Unsubscribe</a>
    </div>

    <div class="footer-copy">© ${new Date().getFullYear()} Sable Dreams. Made with 🌸 for you.</div>
  </div>

</div>
</div>
</body>
</html>
  `;

  await sendEmail(email, subject, html);
};
