// api/diag.js — TEMPORARY deployment diagnostic (removed after diagnosis).
// Boots with ZERO app dependencies so it isolates platform vs application:
// reports environment facts as booleans only — never secret values.
module.exports = (req, res) => {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      ok: true,
      node: process.version,
      vercelEnv: process.env.VERCEL_ENV || null,
      region: process.env.VERCEL_REGION || null,
      cwd: process.cwd(),
      url: req.url,
      hasJwt: Boolean(process.env.JWT_SECRET),
      hasDbUrl: Boolean(process.env.DATABASE_URL),
      hasMail: Boolean(process.env.SMTP_HOST || process.env.MAIL_HOST),
    })
  );
};
