import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(process.env.JEV_SESSION_DIR || join(process.cwd(), "jev-sessions"));
async function json(path: string) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}
async function main() {
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
