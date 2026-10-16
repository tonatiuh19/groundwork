import "dotenv/config";

import { spawn } from "child_process";
import { createInterface } from "readline/promises";
import mysql from "mysql2/promise";
import { checkApiIndexInline } from "./check-api-inline";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeVersion(value: string): string {
  return value.trim();
}

function dbConfig() {
  return {
    host: requireEnv("DB_HOST"),
    port: Number(requireEnv("DB_PORT")),
    user: requireEnv("DB_USER"),
    password: requireEnv("DB_PASSWORD"),
    database: requireEnv("DB_NAME"),
    ssl:
      process.env.DB_SSL === "false" ? undefined : { minVersion: "TLSv1.2" as const },
    // TiDB Serverless drops idle sockets; never hold a conn across vercel --prod.
    enableKeepAlive: true,
    connectTimeout: 20_000,
  };
}

async function withDb<T>(fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await mysql.createConnection(dbConfig());
  try {
    return await fn(conn);
  } finally {
    await conn.end().catch(() => undefined);
  }
}

async function runCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

/**
 * Typecheck + Vercel inline monolith gate + vitest — must pass before prod.
 * Relative runtime imports from api/index.ts → ERR_MODULE_NOT_FOUND on Vercel.
 */
async function runPreDeployChecks() {
  console.log("\n🧪 Pre-deploy checks: api inline + typecheck + tests...\n");

  const inline = checkApiIndexInline();
  console.log(inline.report);
  if (!inline.ok) {
    throw new Error(
      "api/index.ts has relative runtime imports — inline the logic before deploying to Vercel.",
    );
  }

  await runCommand("npm", ["run", "typecheck"]);
  console.log("\n✅ Typecheck passed.\n");
  await runCommand("npm", ["test"]);
  console.log("\n✅ Tests passed. Continuing to deploy...\n");
  await checkProductionEnv();
}

/**
 * Production env vars that features need at runtime but that nothing else
 * catches before deploy (a missing one only shows up as a 503 in prod).
 */
const REQUIRED_PROD_ENV: Array<{ name: string; why: string; fix: string }> = [
  {
    name: "BLOB_PRIVATE_READ_WRITE_TOKEN",
    why: "affiliate agreement / W-9 PDFs and contractor prequal uploads (private Blob store)",
    fix: "Vercel → Storage → Create Blob store (Private access) → Connect to project with env prefix BLOB_PRIVATE → redeploy",
  },
  {
    name: "STRIPE_SECRET_KEY",
    why: "affiliate card on file + monthly platform plan (server side)",
    fix: "Payment dashboard → Developers → API keys → add the secret key to Vercel Production",
  },
  {
    name: "VITE_STRIPE_PUBLISHABLE_KEY",
    why: "the secure card form on the affiliate welcome / agreement pages (needed at build time)",
    fix: "Payment dashboard → Developers → API keys → add the publishable key to Vercel Production",
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    why: "verifying billing webhooks at /api/webhooks/billing (status, failed payments)",
    fix: "Payment dashboard → Webhooks → add endpoint https://www.groundworkcapitalgroup.com/api/webhooks/billing → copy its signing secret to Vercel Production",
  },
];

async function captureCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, env: process.env });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`)),
    );
  });
}

/** Lists Production env names on Vercel; asks before deploying if a required one is missing. */
async function checkProductionEnv() {
  console.log("\n🔐 Checking Vercel production env vars...\n");
  let listing: string;
  try {
    listing = await captureCommand("npx", ["vercel", "env", "ls", "production"]);
  } catch (err) {
    console.log(`⚠️  Could not list Vercel env vars (${(err as Error).message}). Skipping env check.`);
    return;
  }
  const names = new Set(listing.split("\n").map((line) => line.trim().split(/\s+/)[0]).filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n)));
  const missing = REQUIRED_PROD_ENV.filter((v) => !names.has(v.name));
  if (!missing.length) {
    console.log("✅ Required production env vars present.\n");
    return;
  }
  for (const v of missing) {
    console.log(`❌ Missing ${v.name} in Vercel Production — needed for ${v.why}.\n   Fix: ${v.fix}`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("\n❓ Deploy anyway? Those features will return 503 until the var is added. (y/N): ");
    if (answer.trim().toLowerCase() !== "y") throw new Error("Deploy cancelled: missing production env vars.");
  } finally {
    rl.close();
  }
}

async function promptForVersion(
  currentVersion: string | null,
): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const currentLabel = currentVersion?.trim() || "not set";
    console.log(`\n🏷️  Current production version: ${currentLabel}`);

    while (true) {
      const input = await rl.question("✏️  Enter deploy version: ");
      const version = normalizeVersion(input);
      if (!version) {
        console.log("❌ Version cannot be empty.");
        continue;
      }

      const confirm = await rl.question(
        `❓ Deploy version ${version} to production and update app_version after success? (y/N): `,
      );
      if (confirm.trim().toLowerCase() === "y") {
        console.log(`✅ Confirmed. Proceeding with version ${version}...`);
        return version;
      } else {
        console.log(
          "❌ Deploy cancelled. Please enter a new version or Ctrl+C to abort.",
        );
      }
    }
  } finally {
    rl.close();
  }
}

async function readAppVersion(): Promise<string | null> {
  return withDb(async (conn) => {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT setting_value
         FROM system_settings
        WHERE setting_key = 'app_version'
        LIMIT 1`,
    );
    return (rows as mysql.RowDataPacket[])[0]?.setting_value ?? null;
  });
}

async function writeAppVersion(deployVersion: string): Promise<void> {
  await withDb(async (conn) => {
    await conn.execute(
      `INSERT INTO system_settings (
         setting_key,
         setting_value,
         description,
         updated_at
       ) VALUES ('app_version', ?, 'Current deployed application version shown in the admin settings page.', NOW())
       ON DUPLICATE KEY UPDATE
         setting_value = VALUES(setting_value),
         description = VALUES(description),
         updated_at = NOW()`,
      [deployVersion],
    );
  });
}

async function main() {
  // Validate DB env early (before long typecheck/deploy).
  dbConfig();

  const cliArgs = process.argv.slice(2);
  const skipChecks =
    cliArgs.includes("--skip-checks") ||
    process.env.SKIP_DEPLOY_CHECKS === "1" ||
    process.env.SKIP_DEPLOY_CHECKS === "true";
  const filteredArgs = cliArgs.filter((arg) => arg !== "--skip-checks");
  const explicitVersion =
    filteredArgs.find((arg) => !arg.startsWith("-")) ?? "";
  const vercelArgs = explicitVersion
    ? filteredArgs.filter(
        (arg, index) => index !== filteredArgs.indexOf(explicitVersion),
      )
    : filteredArgs;

  if (!skipChecks) {
    await runPreDeployChecks();
  } else {
    console.log(
      "\n⚠️  Skipping pre-deploy checks (--skip-checks / SKIP_DEPLOY_CHECKS).\n",
    );
  }

  // Short-lived connection — do not hold open across vercel --prod
  // (TiDB Serverless closes idle sockets → "connection is in closed state").
  const currentVersion = await readAppVersion();
  const deployVersion = explicitVersion
    ? normalizeVersion(explicitVersion)
    : await promptForVersion(currentVersion);

  if (!deployVersion) {
    throw new Error("Deploy version cannot be empty.");
  }

  console.log(
    `\n🚀 Starting Vercel production deploy for version ${deployVersion}...\n`,
  );
  await runCommand("npx", ["vercel", "--prod", ...vercelArgs]);

  await writeAppVersion(deployVersion);

  console.log(
    `\n🎉 Production deploy succeeded! app_version updated to ${deployVersion}.`,
  );
}

main().catch((error) => {
  console.error(
    `\n❌ Deploy aborted: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
