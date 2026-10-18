// utils/mailer.js
// Mail sending abstraction.
// - Normal mode: Gmail SMTP (same behaviour as the original inline transporter,
//   but created lazily on first send instead of at module load).
// - Capture mode (NODE_ENV=test or MAIL_TRANSPORT=json): messages are collected
//   in an in-memory outbox so tests never send real email.

const nodemailer = require("nodemailer");

const outbox = [];
let transporter = null;

function isCaptureMode() {
  return process.env.NODE_ENV === "test" || process.env.MAIL_TRANSPORT === "json";
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }
  return transporter;
}

async function sendMail(message) {
  if (isCaptureMode()) {
    outbox.push({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html || null,
      text: message.text || null,
      sentAt: new Date().toISOString()
    });
    return { accepted: [message.to], messageId: "test-captured" };
  }
  return getTransporter().sendMail(message);
}

function getOutbox() {
  return outbox;
}

function clearOutbox() {
  outbox.length = 0;
}

module.exports = { sendMail, getOutbox, clearOutbox, isCaptureMode };
