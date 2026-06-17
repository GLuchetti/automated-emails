// processedStore.js — Tracks which Gong calls have already been emailed.
//
// The workflow scans a multi-hour window every 15 minutes and may see the
// same call many times before its transcript is ready. This store lets us
// retry a call until Gong has transcribed it, then mark it done so it is
// never emailed twice. Persisted to state/processed_calls.json and committed
// back by the GitHub Actions workflow.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_FILE = join(__dirname, "..", "state", "processed_calls.json");
const RETENTION_DAYS = 7; // prune entries older than this so the file stays small

export function loadProcessed() {
  if (existsSync(STORE_FILE)) {
    try {
      const data = JSON.parse(readFileSync(STORE_FILE, "utf-8"));
      if (data && typeof data.calls === "object" && data.calls) return data;
    } catch { /* fall through to empty */ }
  }
  return { calls: {} };
}

export function isProcessed(store, callId) {
  return Boolean(store.calls[callId]);
}

export function markProcessed(store, callId, info = {}) {
  store.calls[callId] = { ...info, processedAt: new Date().toISOString() };
}

export function saveProcessed(store, now = new Date()) {
  // Prune old records.
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const [id, rec] of Object.entries(store.calls)) {
    const t = Date.parse(rec?.processedAt || "");
    if (!Number.isNaN(t) && t < cutoff) delete store.calls[id];
  }
  store.last_updated = now.toISOString();
  mkdirSync(dirname(STORE_FILE), { recursive: true });
  writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
}
