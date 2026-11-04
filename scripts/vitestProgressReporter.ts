/**
 * Deploy test progress: every test streams above a live bar pinned to the bottom
 * (spinner, % by tests done, passed / failed / skipped, elapsed, ETA, the file running now).
 * Failures print in red as they happen, with full errors at the end.
 * Used by `npm run deploy:prod` on a terminal; `npm test` keeps the default reporter.
 */
import type { Reporter, TestCase, TestModule, TestSpecification } from "vitest/node";
import path from "node:path";

const esc = (code: string) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
const c = {
  gold: esc("38;5;178"),
  amber: esc("38;5;214"),
  navy: esc("38;5;24"),
  green: esc("32"),
  red: esc("31"),
  yellow: esc("33"),
  dim: esc("2"),
  bold: esc("1"),
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const CHEERS = ["🏗️ laying the foundation", "🧱 stacking bricks", "🔨 framing the walls", "🪟 fitting the windows", "🎨 painting the trim", "🔑 handing over the keys"];

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default class ProgressReporter implements Reporter {
  private totalFiles = 0;
  private doneFiles = 0;
  private passed = 0;
  private failed = 0;
  private skipped = 0;
  private started = Date.now();
  private frame = 0;
  /** Tests per file once collected, and how many of them finished. */
  private planned = new Map<string, number>();
  private finished = new Map<string, number>();
  private running: string[] = [];
  private failures: TestCase[] = [];
  private timer: NodeJS.Timeout | null = null;
  private tty = Boolean(process.stdout.isTTY);

  onTestRunStart(specs: ReadonlyArray<TestSpecification>) {
    this.totalFiles = specs.length;
    this.started = Date.now();
    this.print(`\n${c.bold("🧪 Running tests")} ${c.dim(`(${specs.length} files)`)}\n`);
    if (this.tty) process.stdout.write("\x1b[?25l"); // hide the cursor while the bar animates
    this.timer = setInterval(() => {
      this.frame++;
      this.draw();
    }, 120);
  }

  onTestModuleCollected(m: TestModule) {
    this.planned.set(m.moduleId, [...m.children.allTests()].length);
  }

  onTestModuleStart(m: TestModule) {
    this.running.push(m.moduleId);
  }

  onTestCaseResult(t: TestCase) {
    const r = t.result();
    const id = t.module.moduleId;
    this.finished.set(id, (this.finished.get(id) || 0) + 1);
    const ms = t.diagnostic()?.duration ?? 0;
    const time = ms >= 1000 ? c.yellow(` ${(ms / 1000).toFixed(1)}s`) : c.dim(` ${Math.round(ms)}ms`);
    const where = c.dim(`${this.short(id)} ›`);
    if (r.state === "passed") {
      this.passed++;
      this.print(`  ${c.green("✓")} ${where} ${t.name}${time}`);
    } else if (r.state === "failed") {
      this.failed++;
      this.failures.push(t);
      this.print(`  ${c.red("✗")} ${where} ${c.red(t.name)}${time}`);
    } else {
      this.skipped++;
    }
  }

  onTestModuleEnd(m: TestModule) {
    this.doneFiles++;
    this.running = this.running.filter((id) => id !== m.moduleId);
    const ok = m.ok();
    this.print(`${ok ? c.green(" PASS ") : c.red(" FAIL ")} ${c.bold(this.short(m.moduleId))} ${c.dim(clock(m.diagnostic().duration))}`);
  }

  onTestRunEnd() {
    if (this.timer) clearInterval(this.timer);
    this.clearBar();
    if (this.tty) process.stdout.write("\x1b[?25h");
    for (const t of this.failures) {
      process.stdout.write(`\n${c.red(c.bold("FAIL"))} ${this.short(t.module.moduleId)} › ${t.fullName}\n`);
      for (const e of t.result().errors ?? []) {
        process.stdout.write(`${c.red(String(e.message || e))}\n`);
        if (e.stack) process.stdout.write(c.dim(e.stack.split("\n").slice(1, 6).join("\n")) + "\n");
      }
    }
    const total = this.passed + this.failed + this.skipped;
    const took = clock(Date.now() - this.started);
    process.stdout.write(
      this.failed
        ? `\n${c.red(c.bold(`💥 ${this.failed} failed`))} ${c.dim("·")} ${c.green(`${this.passed} passed`)} ${c.dim(`· ${this.skipped} skipped · ${total} total · ${took}`)}\n`
        : `\n${c.green(c.bold("🎉 All tests passed"))} ${c.dim("·")} ${c.green(`${this.passed} passed`)} ${c.dim(`· ${this.skipped} skipped · ${total} total · ${took}`)}\n`,
    );
  }

  private short(id: string) {
    return path.relative(process.cwd(), id);
  }

  /** Share of tests done: finished files count fully, running files by their finished tests. */
  private ratio() {
    if (!this.totalFiles) return 0;
    let partial = 0;
    for (const id of this.running) {
      const plan = this.planned.get(id);
      if (plan) partial += Math.min(1, (this.finished.get(id) || 0) / plan);
    }
    return Math.min(1, (this.doneFiles + partial) / this.totalFiles);
  }

  private print(line: string) {
    this.clearBar();
    process.stdout.write(`${line}\n`);
    this.draw();
  }

  private clearBar() {
    if (this.tty) process.stdout.write("\r\x1b[2K");
  }

  private draw() {
    if (!this.tty || !this.timer) return;
    const ratio = this.ratio();
    const width = Math.max(12, Math.min(36, (process.stdout.columns || 100) - 64));
    const fill = Math.floor(ratio * width);
    // Gold gradient with a shimmering head.
    const shades = ["38;5;136", "38;5;178", "38;5;220"];
    let bar = "";
    for (let i = 0; i < fill; i++) bar += esc(shades[Math.floor((i / Math.max(1, width)) * shades.length)])("█");
    if (fill < width) bar += (this.frame % 4 < 2 ? c.amber : c.gold)("▓") + c.dim("░".repeat(width - fill - 1));
    const elapsed = Date.now() - this.started;
    const eta = ratio > 0.02 && ratio < 1 ? ` ETA ${clock(elapsed / ratio - elapsed)}` : "";
    const spin = c.gold(SPINNER[this.frame % SPINNER.length]);
    // Before the first file starts, the global setup is sweeping old fixtures from the shared DB.
    const cheer =
      !this.running.length && !this.doneFiles ? "🧹 preparing the test database" : CHEERS[Math.min(CHEERS.length - 1, Math.floor(ratio * CHEERS.length))];
    const counts = `${c.green(`✓ ${this.passed}`)}${this.failed ? ` ${c.red(`✗ ${this.failed}`)}` : ""}${this.skipped ? c.dim(` ↷ ${this.skipped}`) : ""}`;
    const now = this.running[0] ? path.basename(this.running[0]).replace(/\.(integration\.)?(test|spec)\.tsx?$/, "") : "";
    // Never wider than the terminal: a wrapped bar can't be redrawn in place.
    const cols = (process.stdout.columns || 100) - 1;
    const visible = (x: string) => x.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").length;
    const base = `${spin} ${bar} ${c.bold(`${(ratio * 100).toFixed(0).padStart(3)}%`)} ${c.dim(`${this.doneFiles}/${this.totalFiles} files`)}  ${counts}  ${c.dim(`⏱ ${clock(elapsed)}${eta}`)}`;
    const tail = [now ? `${cheer} · ${now}` : cheer, now, ""].find((t) => visible(base) + 2 + t.length <= cols) ?? "";
    process.stdout.write(`\r\x1b[2K${base}${tail ? `  ${c.dim(tail)}` : ""}`);
  }
}
