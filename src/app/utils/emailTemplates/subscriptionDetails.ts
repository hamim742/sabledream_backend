import sendEmail from "../sendEmail";
import { sendBrevoEmail } from "../sendBrevoEmail";

interface SubscriptionDetailsData {
  userName: string;
  email: string;
  planName: string;
  price: string;
  renewsAt: string;
  joinedAt: string;
}

export const subscriptionDetailsTemplate = async (
  data: SubscriptionDetailsData,
) => {
  const { userName, email, planName, price, renewsAt, joinedAt } = data;

  if (process.env.BREVO_API_KEY || process.env.SMTP_PASS) {
    try {
      await sendBrevoEmail({
        toEmail: email,
        toName: userName,
        templateId: 11, // Brevo Template #11: Subscription renewed
        params: {
          FNAME: userName,
          NAME: userName,
          userName,
          name: userName,
          PLAN_NAME: planName,
          planName,
          SUBSCRIPTION_PRICE: price,
          price,
          RENEWAL_DATE: renewsAt,
          renewsAt,
          USER_EMAIL: email,
          email,
          ACCOUNT_DATE: joinedAt,
          joinedAt,
        },
      });
      return;
    } catch (brevoErr) {
      console.warn("[Email] Brevo API failed for subscriptionDetails, falling back to SMTP:", brevoErr);
    }
  }

  const subject = "💕 Your Sable Dreams Subscription Is Confirmed";

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
    font-size: 34px;
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
    margin-bottom: 20px;
  }

  .body-text {
    font-family: Georgia, serif;
    font-size: 15px;
    line-height: 1.8;
    color: #3d2030;
    margin-bottom: 16px;
  }

  .body-text strong { color: #c05880; font-weight: 700; }

  /* Divider */
  .divider {
    height: 1px;
    background: linear-gradient(to right, transparent, #e8c0d4, transparent);
    margin: 28px 0;
  }

  /* ── DETAILS CARD ── */
  .details-card {
    background: #fef8fb;
    border: 1.5px solid #f0d0e4;
    border-radius: 14px;
    padding: 24px;
    margin: 24px 0;
  }
  .details-card-title {
    font-family: Arial, sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: #c05880;
    text-align: center;
    margin-bottom: 18px;
  }
  .details-card-title::before { content: '✦  '; }
  .details-card-title::after  { content: '  ✦'; }

  .details-table {
    width: 100%;
    border-collapse: collapse;
  }
  .details-table tr {
    border-bottom: 1px solid #f0d0e4;
  }
  .details-table tr:last-child { border-bottom: none; }
  .details-table td {
    padding: 11px 12px;
    font-size: 13.5px;
    vertical-align: middle;
  }
  .details-table td:first-child {
    font-family: Arial, sans-serif;
    color: #9a6070;
    font-size: 12px;
    width: 38%;
  }
  .details-table td:last-child {
    font-family: Georgia, serif;
    color: #1a1018;
    font-weight: 400;
    text-align: right;
  }
  .status-active {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: Arial, sans-serif;
    font-size: 12px;
    font-weight: 700;
    color: #2a7a4a;
  }

  .disclaimer-text {
    font-family: Georgia, serif;
    font-size: 12px;
    line-height: 1.6;
    color: #8c707d;
    text-align: center;
    margin-top: 14px;
  }

  /* ── CTA SECTION ── */
  .cta-section {
    background: linear-gradient(135deg, #fde8f2, #f8d0e8);
    border: 1.5px solid #f0c0d8;
    border-radius: 16px;
    padding: 32px 28px;
    text-align: center;
    margin: 0 0 24px;
  }
  .cta-title {
    font-family: Georgia, serif;
    font-style: italic;
    font-size: 22px;
    color: #6b1a3a;
    margin-bottom: 10px;
  }
  .cta-sub {
    font-family: Georgia, serif;
    font-size: 14px;
    color: #8a4060;
    line-height: 1.6;
    margin-bottom: 22px;
  }
  .cta-button {
    display: inline-block;
    background: linear-gradient(135deg, #c05880, #e8a0c0);
    color: #ffffff;
    font-family: Georgia, serif;
    font-style: italic;
    font-size: 16px;
    padding: 14px 40px;
    border-radius: 100px;
    text-decoration: none;
    letter-spacing: 0.3px;
  }

  /* ── SUPPORT SECTION ── */
  .support-section {
    background: #fff;
    border: 1.5px solid #f0d0e4;
    border-left: 4px solid #c05880;
    border-radius: 0 12px 12px 0;
    padding: 20px 22px;
    margin: 0 0 32px;
  }
  .support-title {
    font-family: Arial, sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #c05880;
    margin-bottom: 10px;
  }
  .support-title::before { content: '💗  '; }
  .support-text {
    font-family: Georgia, serif;
    font-size: 14px;
    line-height: 1.7;
    color: #3d2030;
  }
  .support-text a { color: #c05880; font-weight: 700; text-decoration: none; }

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
    color: #b090a0;
    line-height: 1.8;
    margin-bottom: 12px;
  }
  .footer-body a { color: #c05880; text-decoration: none; }

  .footer-links {
    font-family: Arial, sans-serif;
    font-size: 11px;
    color: #c08090;
    margin-bottom: 14px;
  }
  .footer-links a {
    color: #c05880;
    text-decoration: none;
    margin: 0 6px;
  }

  .footer-copy {
    font-family: Arial, sans-serif;
    font-size: 10px;
    color: #c0a0b0;
  }

  /* ── PADDING SECTION WRAPPER ── */
  .padded { padding: 0 40px; }

</style>
</head>
<body>
<div class="email-outer">
<div class="email-container">

  <!-- ════════════════════════════════════════ -->
  <!-- HERO HEADER                              -->
  <!-- ════════════════════════════════════════ -->
  <div class="hero">

    <!-- Watermark rows -->
    <div class="hero-watermark" aria-hidden="true">
      <span>sable dreams &nbsp;✦&nbsp; dream boldly &nbsp;✦&nbsp; live softly &nbsp;✦&nbsp; dream &nbsp;✦&nbsp; believe &nbsp;✦&nbsp; become &nbsp;✦&nbsp; sable dreams &nbsp;✦&nbsp; dream boldly &nbsp;✦&nbsp; live softly &nbsp;✦&nbsp; dream &nbsp;✦&nbsp; believe &nbsp;✦&nbsp; become &nbsp;✦&nbsp;</span>
      <span>sable dreams &nbsp;✦&nbsp; dream boldly &nbsp;✦&nbsp; live softly &nbsp;✦&nbsp; dream &nbsp;✦&nbsp; believe &nbsp;✦&nbsp; become &nbsp;✦&nbsp; sable dreams &nbsp;✦&nbsp; dream boldly &nbsp;✦&nbsp; live softly &nbsp;✦&nbsp; dream &nbsp;✦&nbsp; believe &nbsp;✦&nbsp; become &nbsp;✦&nbsp;</span>
    </div>

    <div class="hero-content">

      <!-- Wax Seal Stamp -->
      <div class="wax-seal">
        <img src="https://imglink.cc/cdn/K5i74ZtPzJ.png" alt="Sable Dreams Logo" width="72" height="72" style="display: block; margin: 0 auto; border: none; outline: none; text-decoration: none;" />
      </div>

      <!-- Title -->
      <div class="hero-title">Your Sable Dreams Subscription Is Confirmed</div>
      <div class="hero-subtitle">Everything is ready for you. 🌷</div>
      <div class="hero-tagline">SUBSCRIPTION CONFIRMED ✦</div>
    </div>

    <!-- Banner strip -->
    <div class="hero-banner">
      <p>✨ &nbsp; YOU’RE ALL SET</p>
    </div>
  </div>

  <!-- ════════════════════════════════════════ -->
  <!-- BODY                                     -->
  <!-- ════════════════════════════════════════ -->
  <div class="body-section">

    <div class="body-content">

      <!-- Greeting -->
      <div class="greeting">Hello, ${userName || 'Sable Dreamer'}! 💕</div>

      <p class="body-text">
        Your Sable Dreams subscription is active and your account is ready.
      </p>
      <p class="body-text">
        Everything is set for you to begin exploring Sable Dreams — your space for reflection, affirmation, dreaming, and becoming.
      </p>
      <p class="body-text">
        Below are the details of your subscription for your records.
      </p>

      <div class="divider"></div>

      <!-- Subscription Card -->
      <div class="details-card">
        <div class="details-card-title">YOUR SUBSCRIPTION</div>
        <table class="details-table">
          <tr>
            <td>Subscription Status</td>
            <td><span class="status-active">✅ Active</span></td>
          </tr>
          <tr>
            <td>Plan</td>
            <td><strong>${planName}</strong></td>
          </tr>
          <tr>
            <td>Price</td>
            <td><strong>${price}</strong></td>
          </tr>
          <tr>
            <td>Renews</td>
            <td><strong>${renewsAt}</strong></td>
          </tr>
          <tr>
            <td>Account Email</td>
            <td><a href="mailto:${email}" style="color:#c05880;text-decoration:none;">${email}</a></td>
          </tr>
        </table>
        <p class="disclaimer-text">
          Your subscription will automatically renew unless canceled through your Apple App Store or Google Play subscription settings.
        </p>
      </div>

      <div class="divider"></div>

      <!-- Account Card -->
      <div class="details-card">
        <div class="details-card-title">YOUR ACCOUNT</div>
        <table class="details-table">
          <tr>
            <td>Account Status</td>
            <td><span class="status-active">✅ Active</span></td>
          </tr>
          <tr>
            <td>Member Since</td>
            <td><strong>${joinedAt}</strong></td>
          </tr>
        </table>
      </div>

      <div class="divider"></div>

      <!-- Stay Connected -->
      <div class="details-card" style="margin-bottom: 28px; background: #ffffff;">
        <div class="details-card-title" style="letter-spacing: 2px;">STAY CONNECTED 💕</div>
        <p class="body-text" style="font-size: 14px; line-height: 1.65; margin-bottom: 20px;">
          Follow <strong>@thesabledreamer</strong> for reflections, inspiration, Sable Dreams updates, and a little softness for your day.
        </p>
        
        <!-- Social Links Table -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 12px; margin-bottom: 8px;">
          <tr>
            <td align="center" style="padding: 8px; width: 33.3%;">
              <a href="https://www.tiktok.com/@thesabledreamer" target="_blank" style="display: inline-block; text-decoration: none; color: #c05880; font-family: Arial, sans-serif; font-size: 12px; font-weight: bold; background: #fff5f8; padding: 10px 14px; border-radius: 30px; border: 1px solid #f9dbe7; min-width: 110px; text-align: center;">
                <!-- TikTok Icon -->
                <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="vertical-align: middle; margin-right: 4px; display: inline-block;">
                  <path d="M9 0h1.98c.144.32.34.61.58.85.24.24.53.436.85.58a3.5 3.5 0 0 0 2.22 0V3.58a5.5 5.5 0 0 1-2.25-.87V11a5 5 0 1 1-6-4.91V8.12A3 3 0 1 0 8 11V0H9z"/>
                </svg>
                <span style="vertical-align: middle;">TikTok</span>
              </a>
            </td>
            <td align="center" style="padding: 8px; width: 33.3%;">
              <a href="https://www.instagram.com/thesabledreamer" target="_blank" style="display: inline-block; text-decoration: none; color: #c05880; font-family: Arial, sans-serif; font-size: 12px; font-weight: bold; background: #fff5f8; padding: 10px 14px; border-radius: 30px; border: 1px solid #f9dbe7; min-width: 110px; text-align: center;">
                <!-- Instagram Icon -->
                <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="vertical-align: middle; margin-right: 4px; display: inline-block;">
                  <path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.9 3.9 0 0 0-1.417.923A3.9 3.9 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.9 3.9 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.444-.048-3.298c-.04-.851-.175-1.433-.372-1.941a3.9 3.9 0 0 0-.923-1.417A3.9 3.9 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 7.998 0zm-.717 1.442h.718c2.136 0 2.389.007 3.232.046.78.035 1.204.166 1.486.275.373.145.64.319.92.599s.453.546.598.92c.11.281.24.705.275 1.485.039.843.047 1.096.047 3.231s-.008 2.389-.047 3.232c-.035.78-.166 1.203-.275 1.485a2.5 2.5 0 0 1-.599.919c-.28.28-.546.453-.92.598-.28.11-.704.24-1.485.276-.843.038-1.096.047-3.232.047s-2.39-.009-3.233-.047c-.78-.036-1.203-.166-1.485-.276a2.5 2.5 0 0 1-.92-.598 2.5 2.5 0 0 1-.6-.92c-.109-.281-.24-.705-.275-1.485-.038-.843-.046-1.096-.046-3.233s.008-2.388.046-3.231c.036-.78.166-1.204.276-1.486.145-.373.319-.64.599-.92.28-.28.546-.453.92-.598.282-.11.705-.24 1.485-.276.738-.034 1.024-.044 2.515-.045zm4.988 1.328a.96.96 0 1 0 0 1.92.96.96 0 0 0 0-1.92m-4.27 1.122a4.109 4.109 0 1 0 0 8.217 4.109 4.109 0 0 0 0-8.217m0 1.441a2.667 2.667 0 1 1 0 5.334 2.667 2.667 0 0 1 0-5.334"/>
                </svg>
                <span style="vertical-align: middle;">Instagram</span>
              </a>
            </td>
            <td align="center" style="padding: 8px; width: 33.3%;">
              <a href="https://www.pinterest.com/thesabledreamer" target="_blank" style="display: inline-block; text-decoration: none; color: #c05880; font-family: Arial, sans-serif; font-size: 12px; font-weight: bold; background: #fff5f8; padding: 10px 14px; border-radius: 30px; border: 1px solid #f9dbe7; min-width: 110px; text-align: center;">
                <!-- Pinterest Icon -->
                <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="vertical-align: middle; margin-right: 4px; display: inline-block;">
                  <path d="M8 0a8 8 0 0 0-2.915 15.452c-.07-.633-.134-1.606.027-2.297.146-.625.938-3.977.938-3.977s-.239-.479-.239-1.187c0-1.113.645-1.943 1.448-1.943.682 0 1.012.512 1.012 1.127 0 .686-.437 1.712-.663 2.663-.188.796.4 1.446 1.185 1.446 1.422 0 2.515-1.5 2.515-3.664 0-1.915-1.377-3.254-3.342-3.254-2.276 0-3.612 1.707-3.612 3.471 0 .688.265 1.425.595 1.826a.24.24 0 0 1 .056.23c-.061.252-.196.796-.222.907-.035.146-.116.177-.268.107-1-.465-1.624-1.926-1.624-3.1 0-2.523 1.834-4.84 5.286-4.84 2.775 0 4.932 1.977 4.932 4.62 0 2.757-1.739 4.976-4.151 4.976-.811 0-1.573-.421-1.834-.919l-.498 1.902c-.181.695-.669 1.566-.995 2.097A8 8 0 1 0 8 0"/>
                </svg>
                <span style="vertical-align: middle;">Pinterest</span>
              </a>
            </td>
          </tr>
        </table>
      </div>

    </div>
  </div>

  <!-- ════════════════════════════════════════ -->
  <!-- CTA SECTION                              -->
  <!-- ════════════════════════════════════════ -->
  <div class="padded" style="padding-top:0; padding-bottom:0; background:#fff; position:relative; z-index:1;">
    <div class="cta-section">
      <div class="cta-title">EVERYTHING IS READY 💕</div>
      <div class="cta-sub">Open Sable Dreams whenever you’re ready.</div>
      <a href="${process.env.APP_DEEP_LINK || 'sabledream://'}" class="cta-button">OPEN SABLE DREAMS ✨</a>
    </div>
  </div>

  <!-- ════════════════════════════════════════ -->
  <!-- SUPPORT SECTION                          -->
  <!-- ════════════════════════════════════════ -->
  <div class="padded" style="background:#fff; padding-top:0; padding-bottom:32px; position:relative; z-index:1;">
    <div class="support-section">
      <div class="support-title">NEED A LITTLE HELP?</div>
      <p class="support-text">
        If you have questions about your Sable Dreams account or subscription, we’re here to help.<br>
        Email: <a href="mailto:sdsupport@sabledreams.com">sdsupport@sabledreams.com</a>
      </p>
    </div>
  </div>

  <!-- ════════════════════════════════════════ -->
  <!-- FOOTER                                   -->
  <!-- ════════════════════════════════════════ -->
  <div class="footer">

    <div class="footer-hearts">♡ &nbsp; ♡ &nbsp; ♡</div>

    <!-- Footer wax seal (smaller) -->
    <div class="footer-seal" style="margin-bottom: 14px;">
      <img src="https://imglink.cc/cdn/K5i74ZtPzJ.png" alt="Sable Dreams Logo" width="52" height="52" style="display: block; margin: 0 auto; border: none; outline: none; text-decoration: none;" />
    </div>

    <div class="footer-brand">Sable Dreams</div>
    <div class="footer-tagline">Dream. Believe. Become.</div>

    <p class="footer-body">
      You’re receiving this email because you subscribed to Sable Dreams.
    </p>

    <div class="footer-links">
      <a href="#">Privacy Policy</a> &nbsp;·&nbsp;
      <a href="#">Terms of Service</a>
    </div>

    <div class="footer-copy">© 2026 Sable Dreams. Made with 🌸 for you.</div>
  </div>

</div>
</div>
</body>
</html>
  `;

  await sendEmail(email, subject, html);
};
