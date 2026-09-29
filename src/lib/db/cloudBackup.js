// Cloud backup — automatic JSON backup to a private GitHub repo + restore on startup.
//
// Why: on Vercel serverless, /tmp is ephemeral. When an instance goes cold,
// the SQLite database is wiped. This module:
//   1. On startup: if the DB is empty, pulls the latest backup from GitHub and imports it.
//   2. On writes: debounced push of a JSON export to GitHub (fire-and-forget).
//
// Tables backed up: _meta, settings, providerConnections, providerNodes,
// proxyPools, apiKeys, combos, kv.
// Skipped (observability, non-critical): usageHistory, usageDaily, requestDetails.
//
// Env vars (all optional — module is inert without them):
//   BACKUP_GITHUB_TOKEN — PAT with `repo` scope for the backup repo
//   BACKUP_GITHUB_REPO  — e.g. "aps7887/9router-backup"
//   BACKUP_GITHUB_PATH  — file path in repo (default "9router-backup.json")

const BACKUP_TABLES = [
  "_meta",
  "settings",
  "providerConnections",
  "providerNodes",
  "proxyPools",
  "apiKeys",
  "combos",
  "kv",
];

const BACKUP_DEBOUNCE_MS = 30_000;

function cfg() {
  const token = process.env.BACKUP_GITHUB_TOKEN;
  const repo = process.env.BACKUP_GITHUB_REPO;
  if (!token || !repo) return null;
  return {
    token,
    repo,
    path: process.env.BACKUP_GITHUB_PATH || "9router-backup.json",
  };
}

export function isBackupConfigured() {
  return !!cfg();
}

// --- Export / import -------------------------------------------------------

export function exportData(adapter) {
  const data = { version: 1, exportedAt: new Date().toISOString(), tables: {} };
  for (const table of BACKUP_TABLES) {
    try {
      data.tables[table] = adapter.all(`SELECT * FROM ${table}`);
    } catch {
      data.tables[table] = [];
    }
  }
  return data;
}

export function importData(adapter, data) {
  if (!data || !data.tables) throw new Error("[backup] invalid backup payload");
  let total = 0;
  for (const table of BACKUP_TABLES) {
    const rows = data.tables[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    for (const row of rows) {
      const cols = Object.keys(row);
      if (cols.length === 0) continue;
      const placeholders = cols.map(() => "?").join(",");
      // INSERT OR REPLACE: safe for re-import (idempotent)
      adapter.run(
        `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`,
        cols.map((c) => row[c])
      );
      total++;
    }
  }
  return total;
}

export function isDbEmpty(adapter) {
  const count = (table) => {
    try {
      return adapter.get(`SELECT COUNT(*) AS c FROM ${table}`)?.c ?? 0;
    } catch {
      return 0;
    }
  };
  return count("providerConnections") === 0 && count("apiKeys") === 0 && count("settings") === 0;
}

// --- GitHub API ------------------------------------------------------------

async function ghApi(path, { method = "GET", body = null } = {}) {
  const c = cfg();
  if (!c) throw new Error("[backup] not configured");
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[backup] GitHub API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function pullBackup() {
  const c = cfg();
  const file = await ghApi(`/repos/${c.repo}/contents/${encodeURIComponent(c.path)}`);
  if (file.type !== "file" || !file.content) throw new Error("[backup] unexpected GitHub response");
  const json = Buffer.from(file.content, "base64").toString("utf-8");
  return { data: JSON.parse(json), sha: file.sha };
}

async function pushBackup(data) {
  const c = cfg();
  const content = Buffer.from(JSON.stringify(data)).toString("base64");
  let sha = null;
  try {
    const existing = await ghApi(`/repos/${c.repo}/contents/${encodeURIComponent(c.path)}`);
    sha = existing.sha;
  } catch {
    // file doesn't exist yet — create it
  }
  await ghApi(`/repos/${c.repo}/contents/${encodeURIComponent(c.path)}`, {
    method: "PUT",
    body: {
      message: `9router backup ${data.exportedAt}`,
      content,
      ...(sha ? { sha } : {}),
    },
  });
}

// --- Public: restore on startup --------------------------------------------

export async function maybeRestore(adapter) {
  if (!isBackupConfigured()) return { restored: false, reason: "not-configured" };
  if (!isDbEmpty(adapter)) return { restored: false, reason: "db-not-empty" };
  try {
    const { data } = await pullBackup();
    const rows = importData(adapter, data);
    console.log(`[backup] restored ${rows} rows from GitHub (${data.exportedAt})`);
    return { restored: true, rows };
  } catch (e) {
    console.warn(`[backup] restore failed (continuing with empty DB): ${e.message}`);
    return { restored: false, reason: e.message };
  }
}

// --- Public: debounced backup on write (fire-and-forget) --------------------

let backupTimer = null;

export function scheduleBackup(adapter) {
  if (!isBackupConfigured()) return;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(async () => {
    backupTimer = null;
    try {
      const data = exportData(adapter);
      await pushBackup(data);
      console.log(`[backup] pushed to GitHub at ${data.exportedAt}`);
    } catch (e) {
      console.warn(`[backup] push failed: ${e.message}`);
    }
  }, BACKUP_DEBOUNCE_MS);
}
