// gongClient.js — Gong REST API wrapper
// Handles auth, pagination, call retrieval, AI data, transcripts, and user/team lookup.

const BASE_URL = "https://us-62894.api.gong.io";

export class GongClient {
  constructor(accessKey, secret) {
    const credentials = Buffer.from(`${accessKey}:${secret}`).toString("base64");
    this.headers = {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    };
    this._usersCache = null;
    this._teamMapCache = null;
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  async _get(path, params = {}) {
    const url = new URL(`${BASE_URL}${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { headers: this.headers });
    if (res.status === 404) {
      console.info(`[Gong] 404 on ${path} — no results in window, treating as empty.`);
      return {};
    }
    if (!res.ok) {
      const text = await res.text();
      console.error(`[Gong] GET ${path} → ${res.status}: ${text.slice(0, 500)}`);
      throw new Error(`Gong API error ${res.status} on GET ${path}`);
    }
    return res.json();
  }

  async _post(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[Gong] POST ${path} → ${res.status}: ${text.slice(0, 500)}`);
      throw new Error(`Gong API error ${res.status} on POST ${path}`);
    }
    return res.json();
  }

  async _paginateGet(path, listKey, params = {}) {
    const items = [];
    let currentParams = { ...params };
    while (true) {
      const data = await this._get(path, currentParams);
      items.push(...(data[listKey] || []));
      const cursor = data?.records?.cursor;
      if (!cursor) break;
      currentParams = { ...currentParams, cursor };
    }
    return items;
  }

  // ------------------------------------------------------------------
  // Calls
  // ------------------------------------------------------------------

  async getCompletedCalls(fromDt, toDt) {
    const params = {
      fromDateTime: fromDt.toISOString().slice(0, 19) + "Z",
      toDateTime: toDt.toISOString().slice(0, 19) + "Z",
    };
    return this._paginateGet("/v2/calls", "calls", params);
  }

  async getCallsExtensive(callIds) {
    if (!callIds.length) return [];
    const body = {
      filter: { callIds },
      contentSelector: {
        exposedFields: {
          content: {
            trackers: true,
            highlights: true,
            keyPoints: true,
            actions: true,
            structure: true,
            topics: true,
            brief: true,
            outline: true,
          },
          parties: true,
        },
      },
    };
    const data = await this._post("/v2/calls/extensive", body);
    const calls = data.calls || [];
    for (const c of calls) {
      const contentKeys = Object.keys(c.content || {});
      console.info(`[Gong] Content fields available: ${contentKeys.join(", ")}`);
    }
    return calls;
  }

  async getTranscripts(callIds) {
    if (!callIds.length) return {};
    const body = { filter: { callIds } };
    const data = await this._post("/v2/calls/transcript", body);
    const result = {};
    for (const item of data.callTranscripts || []) {
      const callId = item.callId;
      const sentences = [];
      for (const segment of item.transcript || []) {
        const speakerId = segment.speakerId || "";
        for (const s of segment.sentences || []) {
          sentences.push({
            speakerId,
            text: (s.text || "").trim(),
            start: s.start || 0,
          });
        }
      }
      result[callId] = sentences;
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Users & team mapping
  // ------------------------------------------------------------------

  async getUsers() {
    if (!this._usersCache) {
      this._usersCache = await this._paginateGet("/v2/users", "users");
    }
    return this._usersCache;
  }

  async buildTeamMap(salesManagerName, supportManagerName) {
    if (this._teamMapCache) return this._teamMapCache;

    const users = await this.getUsers();
    let salesMgrId = null;
    let supportMgrId = null;

    for (const u of users) {
      const fullName = `${u.firstName || ""} ${u.lastName || ""}`.trim();
      if (fullName === salesManagerName) salesMgrId = u.id;
      if (fullName === supportManagerName) supportMgrId = u.id;
    }

    if (!salesMgrId) console.warn(`[Gong] Sales manager '${salesManagerName}' not found`);
    if (!supportMgrId) console.warn(`[Gong] Support manager '${supportManagerName}' not found`);

    const teamMap = {};
    for (const u of users) {
      if (u.managerId === salesMgrId) teamMap[u.id] = "sales";
      else if (u.managerId === supportMgrId) teamMap[u.id] = "support";
    }

    const salesCount = Object.values(teamMap).filter(v => v === "sales").length;
    const supportCount = Object.values(teamMap).filter(v => v === "support").length;
    console.info(`[Gong] Team map built: ${salesCount} sales reps, ${supportCount} support reps`);

    this._teamMapCache = teamMap;
    return teamMap;
  }

  async userEmailMap() {
    const users = await this.getUsers();
    return Object.fromEntries(users.map(u => [u.id, u.emailAddress || ""]));
  }
}
