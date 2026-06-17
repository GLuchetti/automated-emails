// anthropic.js — Shared Claude client with rate-limit (429) retry/backoff.
//
// Both formatters send one large transcript per call. On a burst (e.g. a
// backfill) the API can return 429; we retry, honoring the Retry-After header
// when present, and only fall back to Gong content after exhausting retries.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_MODEL = "claude-sonnet-4-6";

const MAX_ATTEMPTS = 6;
const MAX_WAIT_MS = 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt) {
  // 2s, 4s, 8s, 16s, capped at MAX_WAIT_MS
  return Math.min(MAX_WAIT_MS, 1000 * 2 ** attempt);
}

// Calls Claude and returns the first JSON object found in the response,
// or null if unavailable / unparseable after retries.
export async function extractJson({ prompt, maxTokens = 900, temperature = 0.4, label = "Anthropic" }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) { console.warn(`[${label}] request failed: ${err.message}`); return null; }
      await sleep(backoffMs(attempt));
      continue;
    }

    // Retry on rate limit and transient server errors.
    if (res.status === 429 || res.status >= 500) {
      if (attempt === MAX_ATTEMPTS) { console.warn(`[${label}] ${res.status} — giving up after ${MAX_ATTEMPTS} attempts`); return null; }
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
      console.warn(`[${label}] ${res.status} — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) { console.warn(`[${label}] API error ${res.status}`); return null; }

    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) { console.warn(`[${label}] no JSON in response: ${text.slice(0, 200)}`); return null; }
    try {
      return JSON.parse(match[0]);
    } catch {
      console.warn(`[${label}] JSON parse failed`);
      return null;
    }
  }
  return null;
}
