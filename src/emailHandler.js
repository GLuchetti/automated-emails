// emailHandler.js — Sends emails via Outlook SMTP (smtp.office365.com)

import nodemailer from "nodemailer";

const SMTP_SERVER = "smtp.office365.com";
const SMTP_PORT = 587;

/**
 * Send an HTML email via Outlook SMTP.
 * @param {object} opts
 * @param {string} opts.smtpUser        Account used to authenticate
 * @param {string} opts.smtpPassword    App password for that account
 * @param {string} opts.fromAddress     Display "From" address
 * @param {string[]} opts.toAddresses   Primary recipients
 * @param {string[]} opts.ccAddresses   CC recipients
 * @param {string} opts.subject         Email subject line
 * @param {string} opts.bodyHtml        HTML body
 * @param {string} [opts.bodyText]      Plain-text fallback (auto-generated if omitted)
 */
export async function sendEmail({ smtpUser, smtpPassword, fromAddress, toAddresses, ccAddresses, subject, bodyHtml, bodyText }) {
  const to = (toAddresses || []).map(a => a?.trim()).filter(Boolean);
  const cc = (ccAddresses || []).map(a => a?.trim()).filter(a => a && !to.includes(a));

  if (!to.length) {
    console.warn("[Email] sendEmail called with no valid To addresses — skipping");
    return;
  }

  const text = bodyText || stripHtml(bodyHtml);

  const transporter = nodemailer.createTransport({
    host: SMTP_SERVER,
    port: SMTP_PORT,
    secure: false,
    auth: { user: smtpUser, pass: smtpPassword },
    tls: { ciphers: "SSLv3" },
  });

  await transporter.sendMail({
    from: fromAddress,
    to: to.join(", "),
    ...(cc.length ? { cc: cc.join(", ") } : {}),
    subject,
    text,
    html: bodyHtml,
  });

  console.info(`[Email] Sent | subject='${subject}' | to=${JSON.stringify(to)} | cc=${JSON.stringify(cc)}`);
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
