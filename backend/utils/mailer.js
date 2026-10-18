// utils/mailer.js
// Mail sending abstraction.
// - Normal mode: Gmail SMTP (same behaviour as the original inline transporter,
//   but created lazily on first send instead of at module load).
// - Capture mode (NODE_ENV=test or MAIL_TRANSPORT=json): messages are collected
//   in an in-memory outbox so tests never send real email.
// - Failure mode (MAIL_TRANSPORT=fail, test-only): every send throws, so the
//   signup/mail-failure rollback path is exercisable without touching SMTP.

const nodemailer = require("nodemailer");

const outbox = [];
let transporter = null;

function isCaptureMode() {
  return process.env.NODE_ENV === "test" || process.env.MAIL_TRANSPORT === "json";
}

function isFailureMode() {
  return process.env.NODE_ENV === "test" && process.env.MAIL_TRANSPORT === "fail";
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
  if (isFailureMode()) {
    // Test-only forced failure (MAIL_TRANSPORT=fail) — never active in
    // production; used to exercise mail-failure handling (signup rollback).
    throw new Error("Forced mail transport failure (MAIL_TRANSPORT=fail)");
  }
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
