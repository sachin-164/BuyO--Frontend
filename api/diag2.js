// api/diag2.js — TEMPORARY deployment diagnostic (removed after diagnosis).
// Attempts to boot the REAL serverless entry in-process and returns the exact
// failure (stack included — paths only, never env values) so the live error is
// observable without dashboard/log access.
module.exports = (req, res) => {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  const out = { url: req.url, entry: "OK" };
  try {
    require("./[...path].js");
  } catch (e) {
    out.entry = "FAIL";
    out.err = String((e && e.stack) || e).slice(0, 1800);
  }
  res.end(JSON.stringify(out, null, 2));
};
