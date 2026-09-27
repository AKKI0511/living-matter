import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSessionReview, exportSessionDataset, replaySession } from "../src/server/jev-session-review";

const root = resolve(process.env.JEV_SESSION_DIR || join(process.cwd(), "jev-sessions"));
async function json(path: string) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}
async function main() {
  const args = process.argv.slice(2);
  if (args[0] && ["replay", "review", "export"].includes(args[0])) {
    const [command, sessionId] = args;
    if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("Use pnpm jev:sessions replay|review|export <session-id>");
    const directory = join(root, sessionId);
    if (command === "export") {
      const rows = await exportSessionDataset(directory);
      process.stdout.write(rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
    } else {
      const result = command === "replay" ? await replaySession(directory) : await createSessionReview(directory);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    }
    return;
  }
  if (args.some((arg) => arg !== "--latest")) throw new Error("Use --latest, replay, review or export");
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const sessions = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const path = join(root, entry.name);
    return { path, session: await json(join(path, "session.json")), summary: await json(join(path, "summary.json")) };
  }));
  sessions.sort((a, b) => String(b.session?.started_at ?? "").localeCompare(String(a.session?.started_at ?? "")));
  const result = process.argv.includes("--latest") ? sessions.slice(0, 1) : sessions;
  process.stdout.write(JSON.stringify({ root, sessions: result }, null, 2) + "\n");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
