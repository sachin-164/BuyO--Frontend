// scripts/lib/pgClientOptions.js — Phase 10: single source of truth that
// turns resolved PG settings (config/dbConnectionOptions.resolvePostgresSettings)
// into `pg` Client options for the CLI tools.
//
// TLS follows the Phase 9 decision: `settings.ssl` is true for non-loopback
// hosts unless explicitly disabled (PG_SSL=false). When TLS is on, certificate
// VERIFICATION is always enabled (rejectUnauthorized:true) — there is
// deliberately no bypass anywhere. Loopback targets stay byte-identical to the
// pre-Phase-10 behavior (no `ssl` key at all), so the embedded-PostgreSQL
// test clusters and every existing local flow are unaffected.
function pgClientOptions(settings, database) {
  const options = {
    host: settings.host,
    port: settings.port,
    user: settings.username,
    password: settings.password,
    database: database || settings.database
  };
  if (settings.ssl) options.ssl = { rejectUnauthorized: true };
  return options;
}

module.exports = { pgClientOptions };
