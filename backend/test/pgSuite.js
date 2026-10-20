// test/pgSuite.js — Migration Phase 2: runs functional test suites against the
// local embedded-PostgreSQL harness.
//
// Usage:
//   node test/pgSuite.js                 # runs test/catalog.test.js
//   node test/pgSuite.js path/to.t.js    # runs the given suite file(s)
// or via npm:
//   npm run test:pg:catalog
//
// What it does:
//   1. Starts an embedded PostgreSQL server (devDependency) with its data
//      directory in the OS temp dir — OUTSIDE the repository and OneDrive.
//   2. Points the shared test harness (test/helpers.js) at it via
//      DB_DIALECT=postgres + PG_* env vars, then runs the requested suite(s)
//      in a child `node --test` process (children inherit the env).
//   3. Stops the server, removes the data dir, and exits with the suite's
//      exit code.
//
// BOUNDARIES:
//   - Loopback only; never connects to Supabase or any remote host.
//   - DATABASE_URL only fills PG_* gaps on the postgres path (absent here).
//   - The child suite recreates the buyoDB_ph2_test scratch database via the
//     same guarded harness path the MySQL suites use.
//   - If embedded PostgreSQL fails to initialise/start, this fails loudly
//     (no silent fallback to another harness).

const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(os.tmpdir(), "buyo", "pg-suite", "pgdata");
const PG_PORT = Number(process.env.PG_SUITE_PORT || 5434);
const PG_USER = "postgres";
const PG_PASSWORD = "pg-suite-local";

// Suites to run (default: catalog).
const suites = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [path.join(__dirname, "catalog.test.js")];

// Safety: the PG data directory must never live inside the repo/OneDrive tree.
function assertDataDirOutsideRepo() {
  const rel = path.relative(REPO_ROOT, DATA_DIR);
  if (!(rel === "" || rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new Error(`PG data dir must be outside the repo, got: ${DATA_DIR}`);
  }
  if (DATA_DIR.toLowerCase().includes("onedrive") &&
      DATA_DIR.toLowerCase().includes("buyo--frontend")) {
    throw new Error("PG data dir must not be inside the OneDrive project folder");
  }
}

async function main() {
  assertDataDirOutsideRepo();

  // Wipe any leftover data dir from a previous run.
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const EmbeddedPostgres = require("embedded-postgres").default;
  const embedded = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: false
  });

  let exitCode = 1;
  try {
    await embedded.initialise();
    console.log(`[pgSuite] embedded PostgreSQL initialised on port ${PG_PORT}`);
    await embedded.start();
    console.log("[pgSuite] embedded PostgreSQL started");

    const env = {
      ...process.env,
      DB_DIALECT: "postgres",
      PG_HOST: "127.0.0.1",
      PG_PORT: String(PG_PORT),
      PG_USER,
      PG_PASS: PG_PASSWORD
      // PG_DB is forced to buyoDB_ph2_test by test/helpers.js itself.
    };

    exitCode = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        ["--test", "--test-concurrency=1", ...suites],
        { stdio: "inherit", env, cwd: path.join(REPO_ROOT, "backend") }
      );
      child.on("error", (err) => {
        console.error("[pgSuite] failed to start test process:", err);
        resolve(1);
      });
      child.on("close", (code) => resolve(code === null ? 1 : code));
    });
  } finally {
    try {
      await embedded.stop();
      console.log("[pgSuite] embedded PostgreSQL stopped");
    } catch (err) {
      console.error("[pgSuite] failed to stop embedded PostgreSQL:", err.message);
    }
    // persistent:false already removes the data dir; remove the wrapper dir too.
    fs.rmSync(path.dirname(DATA_DIR), { recursive: true, force: true });
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[pgSuite] FAILED:", err);
  process.exit(1);
});
