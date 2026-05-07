import * as nodemailer from "nodemailer";

export interface SendEmailParams {
  to: string;
  customerName: string;
  surveyLink: string;
  expiryDate: Date;
  smtpPassword: string;
}

export interface SendCredentialsEmailParams {
  to: string;
  customerName: string;
  username: string;
  password: string;
  loginUrl: string;
  smtpPassword: string;
}

/**
 * Send the online survey invitation email (token-link flow).
 * @param {SendEmailParams} params - Email params.
 */
export async function sendOnlineSurveyEmail(
  params: SendEmailParams
): Promise<void> {
  const {to, customerName, surveyLink, expiryDate, smtpPassword} = params;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? "587"),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPassword,
    },
  });

  const formattedExpiry = expiryDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const supportEmail = process.env.SUPPORT_EMAIL ?? "support@delight.ae";
  const html = buildLinkHtml(
    customerName, surveyLink, formattedExpiry, supportEmail
  );
  const from = process.env.SMTP_FROM ??
    "Delight Survey <noreply@delight.ae>";

  await transporter.sendMail({
    from,
    to,
    subject: "You're Invited to Complete Your Moving Survey",
    html,
  });
}

/**
 * Send the online survey credentials email (username/password flow).
 * @param {SendCredentialsEmailParams} params - Email params.
 */
export async function sendOnlineSurveyCredentialsEmail(
  params: SendCredentialsEmailParams
): Promise<void> {
  const {to, customerName, username, password, loginUrl, smtpPassword} =
    params;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? "587"),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPassword,
    },
  });

  const supportEmail = process.env.SUPPORT_EMAIL ?? "support@delight.ae";
  const html = buildCredentialsHtml(
    customerName, username, password, loginUrl, supportEmail
  );
  const from = process.env.SMTP_FROM ??
    "Delight Survey <noreply@delight.ae>";

  await transporter.sendMail({
    from,
    to,
    subject: "Your Moving Survey Login Credentials",
    html,
  });
}

/**
 * Build the HTML body for the token-link invitation email.
 * @param {string} name - Customer display name.
 * @param {string} link - Survey URL.
 * @param {string} expiry - Formatted expiry date.
 * @param {string} support - Support email address.
 * @return {string} HTML string.
 */
function buildLinkHtml(
  name: string,
  link: string,
  expiry: string,
  support: string
): string {
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(link);
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;
  font-family:Arial,Helvetica,sans-serif;
  background:#f4f4f4;">
  <table width="100%" cellpadding="0"
    cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0"
        cellspacing="0" style="background:#fff;
        border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background:#1a73e8;
            padding:24px;text-align:center;">
            <h1 style="color:#fff;margin:0;
              font-size:22px;">
              Delight Survey
            </h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="font-size:16px;color:#333;">
              Dear ${safeName},
            </p>
            <p style="font-size:15px;color:#555;
              line-height:1.6;">
              You have been invited to complete an
              online moving survey. Please click the
              button below to get started.
            </p>
            <table cellpadding="0" cellspacing="0"
              style="margin:28px auto;">
              <tr><td align="center"
                style="background:#1a73e8;
                border-radius:6px;">
                <a href="${safeLink}"
                  style="display:inline-block;
                  padding:14px 32px;color:#fff;
                  text-decoration:none;
                  font-size:16px;
                  font-weight:bold;">
                  Start Survey
                </a>
              </td></tr>
            </table>
            <p style="font-size:13px;color:#888;
              line-height:1.5;">
              This link expires on
              <strong>${expiry}</strong>.<br/>
              If you did not expect this email,
              please ignore it.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#fafafa;
            padding:16px;text-align:center;
            font-size:12px;color:#999;">
            Need help? Contact
            <a href="mailto:${support}"
              style="color:#1a73e8;">
              ${support}
            </a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Build the HTML body for the credentials email.
 * @param {string} name - Customer display name.
 * @param {string} username - Generated login username/email.
 * @param {string} password - Generated password.
 * @param {string} loginUrl - URL to the login page.
 * @param {string} support - Support email address.
 * @return {string} HTML string.
 */
function buildCredentialsHtml(
  name: string,
  username: string,
  password: string,
  loginUrl: string,
  support: string
): string {
  const safeName = escapeHtml(name);
  const safeUsername = escapeHtml(username);
  const safePassword = escapeHtml(password);
  const safeLoginUrl = escapeHtml(loginUrl);
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;
  font-family:Arial,Helvetica,sans-serif;
  background:#f4f4f4;">
  <table width="100%" cellpadding="0"
    cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0"
        cellspacing="0" style="background:#fff;
        border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background:#1a73e8;
            padding:24px;text-align:center;">
            <h1 style="color:#fff;margin:0;
              font-size:22px;">
              Delight Survey
            </h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="font-size:16px;color:#333;">
              Dear ${safeName},
            </p>
            <p style="font-size:15px;color:#555;
              line-height:1.6;">
              You have been invited to complete an
              online moving survey. Please use the
              credentials below to log in.
            </p>
            <table cellpadding="0" cellspacing="0"
              style="margin:24px auto;
              background:#f8f9fa;border-radius:8px;
              border:1px solid #e0e0e0;
              padding:20px;width:100%;">
              <tr>
                <td style="padding:8px 16px;
                  font-size:14px;color:#666;">
                  <strong>Username:</strong>
                </td>
                <td style="padding:8px 16px;
                  font-size:16px;color:#333;
                  font-family:monospace;">
                  ${safeUsername}
                </td>
              </tr>
              <tr>
                <td style="padding:8px 16px;
                  font-size:14px;color:#666;">
                  <strong>Password:</strong>
                </td>
                <td style="padding:8px 16px;
                  font-size:16px;color:#333;
                  font-family:monospace;">
                  ${safePassword}
                </td>
              </tr>
            </table>
            <table cellpadding="0" cellspacing="0"
              style="margin:28px auto;">
              <tr><td align="center"
                style="background:#1a73e8;
                border-radius:6px;">
                <a href="${safeLoginUrl}"
                  style="display:inline-block;
                  padding:14px 32px;color:#fff;
                  text-decoration:none;
                  font-size:16px;
                  font-weight:bold;">
                  Log In to Survey
                </a>
              </td></tr>
            </table>
            <p style="font-size:13px;color:#888;
              line-height:1.5;">
              These credentials are for one-time use.
              Once the survey is completed, this
              account will be automatically
              deactivated.<br/>
              If you did not expect this email,
              please ignore it.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#fafafa;
            padding:16px;text-align:center;
            font-size:12px;color:#999;">
            Need help? Contact
            <a href="mailto:${support}"
              style="color:#1a73e8;">
              ${support}
            </a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Escape HTML special characters.
 * @param {string} str - Raw string.
 * @return {string} Escaped string.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
