// scripts/lib/pgClientOptions.js — Phase 10: single source of truth that
// turns resolved PG settings (config/dbConnectionOptions.resolvePostgresSettings)
// into `pg` Client options for the CLI tools.
//
// TLS follows the Phase 9 decision: `settings.ssl` is true for non-loopback
// hosts unless explicitly disabled (PG_SSL=false). When TLS is on, certificate
// VERIFICATION is always enabled (rejectUnauthorized:true) — there is
// deliberately no bypass anywhere. Supabase hosts additionally trust the
// official Supabase Root 2021 CA (config/supabaseRootCa.js, public certificate
// data) as an EXTRA trust anchor, exactly like the app path in
// config/dbConnectionOptions.js — without it a bare verify fails with
// SELF_SIGNED_CERT_IN_CHAIN before authentication, because the private root is
// not in Node's default store. Every other host keeps the default public trust
// store untouched. Loopback targets stay byte-identical to the pre-Phase-10
// behavior (no `ssl` key at all), so the embedded-PostgreSQL test clusters and
// every existing local flow are unaffected.
const SUPABASE_ROOT_CA = require("../../config/supabaseRootCa");
const { isSupabaseHost } = require("../../config/dbConnectionOptions");

function pgClientOptions(settings, database) {
  const options = {
    host: settings.host,
    port: settings.port,
    user: settings.username,
    password: settings.password,
    database: database || settings.database
  };
  if (settings.ssl) {
    // Verification and hostname checks stay hardcoded ON — no knob, no bypass.
    options.ssl = { rejectUnauthorized: true };
    // For genuine *.supabase.co / *.supabase.com hosts ONLY (suffix-anchored
    // match), add the pinned Supabase root as an additional anchor.
    if (isSupabaseHost(settings.host)) {
      options.ssl.ca = [SUPABASE_ROOT_CA];
    }
  }
  return options;
}

module.exports = { pgClientOptions };
