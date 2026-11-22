import { execFileSync } from "node:child_process";
import { chownSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface TestDb {
  url: string;
  stop: () => void;
}

function findPgBin(): string | null {
  const base = "/usr/lib/postgresql";
  if (!existsSync(base)) return null;
  const versions = readdirSync(base).sort().reverse();
  for (const v of versions) {
    const bin = path.join(base, v, "bin");
    if (existsSync(path.join(bin, "initdb"))) return bin;
  }
  return null;
}

/**
 * Database for tests: TEST_DATABASE_URL if set, otherwise a throwaway local
 * PostgreSQL cluster in a temp dir. Returns null when neither is available.
 */
export function startTestDb(): TestDb | null {
  if (process.env.TEST_DATABASE_URL) {
    return { url: process.env.TEST_DATABASE_URL, stop: () => {} };
  }
  const bin = findPgBin();
  if (!bin) return null;

  const isRoot = process.getuid?.() === 0;
  const dir = mkdtempSync(path.join(tmpdir(), "ludo-pg-"));
  const run = (cmd: string, args: string[]) => {
    const full = path.join(bin, cmd);
    if (isRoot) execFileSync("runuser", ["-u", "postgres", "--", full, ...args], { stdio: "pipe" });
    else execFileSync(full, args, { stdio: "pipe" });
  };
  if (isRoot) {
    const uid = Number(execFileSync("id", ["-u", "postgres"]).toString().trim());
    const gid = Number(execFileSync("id", ["-g", "postgres"]).toString().trim());
    chownSync(dir, uid, gid);
  }
  const data = path.join(dir, "data");
  const port = 40000 + Math.floor(Math.random() * 10000);
  run("initdb", ["-D", data, "-A", "trust", "-U", "postgres"]);
  run("pg_ctl", [
    "-D", data,
    "-o", `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`,
    "-l", path.join(dir, "pg.log"),
    "-w", "start",
  ]);
  return {
    url: `postgresql://postgres@127.0.0.1:${port}/postgres`,
    stop: () => {
      try {
        run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
