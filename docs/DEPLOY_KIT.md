# Disrupting Labs deploy kit: setup guide

How to bring Groundwork's deploy upgrades into another project (optimum-credit, the-mortgage-professionals, real-state, …).

What you get:

- **Git safety:** deploys only ship what is on `origin/main`. Uncommitted or unpushed work gets a question (commit + push with a suggested or custom message, "I'll handle it", or abort) instead of an error.
- **Version question:** suggested patch / minor, custom, type it yourself, or abort.
- **Telegram:** every question also arrives on your phone with tap buttons (first answer wins, terminal or Telegram), plus messages when checks start, when the release is live, and **why** it was aborted.
- **Test dashboard:** Disrupting Labs logo plus a live panel with an overall bar, files and tests, speed, an ETA learned from past runs, every file running now, the slowest tests and the last failure.
- **Test data safety:** once tests start, any abort (failure, Ctrl+C, error) purges test fixtures, and a failed purge stops the deploy.

Reference implementation: `groundwork/scripts/deploy-prod.ts`, `scripts/deployAsk.ts`, `scripts/vitestProgressReporter.ts`.

---

## 1. Copy two files (unchanged)

From `groundwork/scripts/` into the other project's `scripts/`:

| File | What it does | Changes needed |
|---|---|---|
| `deployAsk.ts` | `ask()` (terminal + Telegram race), `notify()`, `telegramReady()`, `projectName`, the IPv4 network fix | None |
| `vitestProgressReporter.ts` | The test dashboard (vitest 4 reporter) | None. It imports `projectName` from `./deployAsk` |

```bash
cp ~/Code/groundwork/scripts/deployAsk.ts ~/Code/<project>/scripts/
cp ~/Code/groundwork/scripts/vitestProgressReporter.ts ~/Code/<project>/scripts/
```

Requirements: Node 18+ (built-in `fetch`) and vitest 4. On vitest 1-3 the reporter hooks differ; keep the default reporter there.

---

## 2. Telegram bot (one per project)

Use **one bot per project**: a single bot can't serve two deploys running at the same time (one gets a "conflict" error or loses button taps). Bots are free, up to 20 per Telegram account.

1. Open BotFather: https://web.telegram.org/k/#@BotFather (or https://t.me/BotFather in the Telegram app).
2. Send `/newbot`. Name: `Accio Deploy · <Project>`. Username: e.g. `accio_<project>_deploy_bot` (must end in `bot`).
3. Lock it down: `/setjoingroups` → Disable, `/setprivacy` → Enable.
4. Add to the project's `.env` (never to Vercel: only your Mac runs the deploy):

   ```
   TELEGRAM_BOT_TOKEN=<token from BotFather>
   TELEGRAM_CHAT_ID=
   # Optional: name on messages and the dashboard (default: package.json "name", tidied up)
   DEPLOY_NAME=
   ```

5. Open the new bot and send **hi**. The first deploy fills in `TELEGRAM_CHAT_ID` by itself (only that chat can answer). You can also copy the same `TELEGRAM_CHAT_ID` from Groundwork's `.env`: it's your chat, the same for every bot.
6. Add the same three keys, empty, to `.env.example`.

If a token leaks: `/revoke` in BotFather, then update `.env`.

---

## 3. Wire it into the project's `scripts/deploy-prod.ts`

Most Gomez projects share the same deploy skeleton (`requireEnv`, `withDb`, `runCommand`, `captureCommand`, `readAppVersion`, `writeAppVersion`, `promptForVersion`, `main`). Copy these blocks from Groundwork's `scripts/deploy-prod.ts`, as they are unless noted.

### 3.1 Imports

```ts
import fs from "fs";
import path from "path";
import { ask, notify, projectName } from "./deployAsk";
```

### 3.2 Abort state, cleanup and the Telegram abort message

Copy: `testsRunning`, `interrupted`, `purged`, `testsStarted`, `purgeTestData()`, `stage`, `failedTestsSummary()`, `tgSafe`, `notifyAbort()` and the new `installInterruptCleanup()`.

- **Project with fixture cleanup** (`npm run test:cleanup-fixtures`): keep as is.
- **Project without it:** make `purgeTestData()` set `purged = true` and return, or point it at that project's cleanup script.

### 3.3 Git helpers

Copy: `SECRET_FILE`, `git`, `statusFiles`, `assertGitReady()`, `suggestCommitMessage()`, `resolveGit()`, `waitForCleanMain()`, `tagRelease()`.

- `suggestCommitMessage()` guesses areas from `client/pages|components`, `api/index.ts`, `database/`, `scripts/`. Adjust the `area()` rules if the project's folders differ (e.g. `src/`, `app/`).
- If the main branch isn't `main`, change the branch name in `assertGitReady`, `resolveGit` and `waitForCleanMain`.

### 3.4 Version helpers

Copy: `bump()` and `chooseVersion()`. Keep the project's own `promptForVersion()`: it's the "I'll type it in the terminal" choice.

### 3.5 Tests with the dashboard

Inside the project's pre-deploy checks, replace `runCommand("npm", ["test"])` with:

```ts
stage = "tests";
testsRunning = true;
testsStarted = true;
purged = false;
try {
  // On a terminal: the Disrupting Labs dashboard; elsewhere the default reporter.
  const progress = process.stdout.isTTY ? ["--reporter=./scripts/vitestProgressReporter.ts"] : [];
  await runCommand("npx", ["vitest", "--run", ...progress]).catch((e) => {
    throw interrupted ? e : new Error(`Tests failed.${failedTestsSummary() ? "" : ` (${e instanceof Error ? e.message : e})`}`);
  });
  console.log("\n✅ Tests passed. Continuing to deploy...\n");
} finally {
  testsRunning = false;
  if (!interrupted) purgeTestData("Tests finished");
}
if (!purged) throw new Error("Test data cleanup failed, so staff could see test rows. Run the cleanup, then deploy again.");
```

Also set `stage = "typecheck"` before the typecheck and `stage = "production env check"` before any env check, so abort messages say where it stopped.

### 3.6 `main()` order

```ts
installInterruptCleanup();
// …parse args as before, plus:
const allowDirty = cliArgs.includes("--allow-dirty");
// and filter "--allow-dirty" out of the args passed to vercel

stage = "git check";
await resolveGit(allowDirty);
await notify(`🧪 <b>${projectName} deploy</b>: checks started on <code>${await git(["rev-parse", "--short", "HEAD"])}</code>.`);

if (!skipChecks) await runPreDeployChecks();

stage = "git re-check after the tests";
await assertGitReady(allowDirty); // nothing committed, pulled or edited during the tests

const currentVersion = await readAppVersion();
const deployVersion = explicitVersion
  ? normalizeVersion(explicitVersion)
  : await (async () => {
      stage = "version question";
      return chooseVersion(currentVersion);
    })();

stage = "Vercel upload";
await runCommand("npx", ["vercel", "--prod", ...vercelArgs]);
stage = "after going live";

// …stamp app_version with retries as before (call tagRelease() in the "stamp failed" branch too)…

await tagRelease(deployVersion);
await notify(`🎉 <b>${projectName} ${deployVersion} is live.</b>`);
```

### 3.7 Error handler at the bottom

```ts
main().catch(async (error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ Deploy aborted: ${msg}`);
  // Ctrl+C: the signal handler is still waiting for vitest to stop and owns the cleanup, message and exit.
  if (interrupted) return;
  if (testsStarted && !purged) purgeTestData("Deploy aborted");
  await notifyAbort(msg);
  process.exit(1);
});
```

### 3.8 Vitest config (optional, removes a warning)

In `vitest.config.ts`, use `import.meta.dirname` instead of `__dirname` (Vite's native config loader warns about `__dirname`).

---

## 4. Check it (5 minutes)

```bash
npx tsc --noEmit -p .
```

1. **Abort path:** with an uncommitted change, run `npm run deploy:prod`, pick **Abort the deploy**. Expect the question on Telegram (marked "answered in the terminal") and a "❌ … deploy aborted (during git check)" message.
2. **Telegram answer:** run again and tap **Abort** on Telegram. The terminal should say "📱 Answered on Telegram".
3. **Dashboard:** on the first real deploy, check that the logo, panel and "RUNNING NOW" show. The ETA says "learning…" on the very first run, then uses past times.
4. **Ctrl+C during tests:** expect "🧹 Aborted: purging test data…", then the Telegram abort message with "Test data cleaned up".

---

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Telegram unavailable (network: ETIMEDOUT)` | Network without IPv6 to Telegram. `deployAsk.ts` already forces IPv4 and disables Node's 250ms address racing; make sure the copy is current. |
| "send any message to your deploy bot once" | No chat linked yet: send the bot "hi", then deploy again. |
| Buttons do nothing / "conflict" | Two deploys share one bot. Give each project its own bot. |
| Dashboard lines jumping or wrapping | Terminal narrower than ~50 columns; widen it. |
| Plain output, no dashboard | Not a terminal (CI or piped output): expected, the default reporter is used. |
| Abort message shows no failed tests | The reporter writes `node_modules/.cache/dl-test-failures.json`; make sure the run used `vitestProgressReporter.ts`. |

Local cache files (kept on your Mac only, never in git or on Vercel): `node_modules/.cache/dl-test-times.json` (ETA) and `dl-test-failures.json` (last failures).

---

## 6. Later: one shared package

The two copied files are identical everywhere, so they belong in `gomez-framework/packages/` (e.g. `@tonatiuh19/gomez-deploy-kit`) once they've settled, so a fix lands in every project with a version bump instead of a copy.
