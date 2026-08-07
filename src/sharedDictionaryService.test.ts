import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureSharedToken,
  isSharedCacheFresh,
  loadSharedCache,
  loadSharedSettings,
  loadSubmissionRecords,
  mergeSubmissionRecords,
  parseSharedDictionaryAction,
  recordSubmission,
  saveSharedCache,
  SHARED_CACHE_TTL_MS
} from "./sharedDictionaryService";
import { MAX_SHARED_SUBMISSION_RECORDS, type SharedSubmissionRecord } from "./sharedDictionary";
import type { StoreLike } from "./types";

class MemoryStore implements StoreLike {
  private readonly values = new Map<string, unknown>();

  get(key: string, defaultValue?: unknown): unknown {
    return this.values.has(key) ? this.values.get(key) : defaultValue;
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

function submissionRecord(
  overrides: Partial<SharedSubmissionRecord> = {}
): SharedSubmissionRecord {
  return {
    submissionId: "abc-123",
    word: "github",
    reading: "ギットハブ",
    category: "IT",
    status: "pending",
    submittedAt: "2026-08-07T00:00:00.000Z",
    ...overrides
  };
}

test("parseSharedDictionaryAction parses supported actions", () => {
  assert.deepEqual(parseSharedDictionaryAction({ action: "configure", endpointUrl: " https://x " }), {
    action: "configure",
    endpointUrl: "https://x"
  });
  assert.deepEqual(parseSharedDictionaryAction({ action: "configure", endpointUrl: null }), {
    action: "configure",
    endpointUrl: null
  });
  assert.deepEqual(parseSharedDictionaryAction({ action: "configure", endpointUrl: "  " }), {
    action: "configure",
    endpointUrl: null
  });
  assert.deepEqual(parseSharedDictionaryAction({ action: "fetch" }), {
    action: "fetch",
    force: false
  });
  assert.deepEqual(parseSharedDictionaryAction({ action: "fetch", force: true }), {
    action: "fetch",
    force: true
  });
  assert.deepEqual(
    parseSharedDictionaryAction({ action: "submit", word: "w", reading: "r" }),
    { action: "submit", word: "w", reading: "r", category: "", authorName: "" }
  );
  assert.deepEqual(parseSharedDictionaryAction({ action: "refreshSubmissions" }), {
    action: "refreshSubmissions"
  });
  assert.deepEqual(parseSharedDictionaryAction({ action: "import", ids: ["a", "b"] }), {
    action: "import",
    ids: ["a", "b"]
  });
});

test("parseSharedDictionaryAction rejects invalid payloads", () => {
  assert.equal(parseSharedDictionaryAction(null), null);
  assert.equal(parseSharedDictionaryAction({ action: "unknown" }), null);
  assert.equal(parseSharedDictionaryAction({ action: "configure", endpointUrl: 1 }), null);
  assert.equal(parseSharedDictionaryAction({ action: "fetch", force: "yes" }), null);
  assert.equal(parseSharedDictionaryAction({ action: "submit", word: "w" }), null);
  assert.equal(parseSharedDictionaryAction({ action: "import", ids: [] }), null);
  assert.equal(parseSharedDictionaryAction({ action: "import", ids: ["a", 1] }), null);
});

test("loadSharedSettings falls back to a null endpoint", () => {
  const store = new MemoryStore();
  assert.deepEqual(loadSharedSettings(store), { endpointUrl: null });

  store.set("sharedDictionarySettings", { endpointUrl: "https://example.com" });
  assert.deepEqual(loadSharedSettings(store), { endpointUrl: "https://example.com" });

  store.set("sharedDictionarySettings", { endpointUrl: 42 });
  assert.deepEqual(loadSharedSettings(store), { endpointUrl: null });
});

test("loadSharedCache validates stored cache data", () => {
  const store = new MemoryStore();
  assert.equal(loadSharedCache(store), null);

  const cache = {
    version: 2,
    entries: [
      {
        id: "id-1",
        word: "github",
        reading: "ギットハブ",
        category: "",
        author: "",
        updatedAt: ""
      }
    ],
    fetchedAt: "2026-08-07T00:00:00.000Z"
  };
  saveSharedCache(store, cache);
  assert.deepEqual(loadSharedCache(store), cache);

  store.set("sharedDictionaryCache", { version: -1, entries: [], fetchedAt: "x" });
  assert.equal(loadSharedCache(store), null);

  store.set("sharedDictionaryCache", {
    version: 1,
    entries: [{ id: "", word: "w", reading: "r", category: "", author: "", updatedAt: "" }],
    fetchedAt: "x"
  });
  assert.equal(loadSharedCache(store), null);
});

test("isSharedCacheFresh honors the TTL window", () => {
  const now = new Date("2026-08-07T12:00:00.000Z");
  const fresh = {
    version: 1,
    entries: [],
    fetchedAt: new Date(now.getTime() - SHARED_CACHE_TTL_MS + 1000).toISOString()
  };
  const stale = {
    version: 1,
    entries: [],
    fetchedAt: new Date(now.getTime() - SHARED_CACHE_TTL_MS - 1000).toISOString()
  };
  const future = { version: 1, entries: [], fetchedAt: "2027-01-01T00:00:00.000Z" };
  const invalid = { version: 1, entries: [], fetchedAt: "not a date" };

  assert.equal(isSharedCacheFresh(fresh, now), true);
  assert.equal(isSharedCacheFresh(stale, now), false);
  assert.equal(isSharedCacheFresh(future, now), false);
  assert.equal(isSharedCacheFresh(invalid, now), false);
});

test("ensureSharedToken generates a token once and reuses it", () => {
  const store = new MemoryStore();
  let generated = 0;
  const generate = () => {
    generated += 1;
    return `token-${generated}`;
  };

  assert.equal(ensureSharedToken(store, generate), "token-1");
  assert.equal(ensureSharedToken(store, generate), "token-1");
  assert.equal(generated, 1);
});

test("recordSubmission prepends records and caps the history", () => {
  const store = new MemoryStore();
  for (let index = 0; index < MAX_SHARED_SUBMISSION_RECORDS + 5; index += 1) {
    recordSubmission(store, submissionRecord({ submissionId: `id-${index}` }));
  }

  const records = loadSubmissionRecords(store);
  assert.equal(records.length, MAX_SHARED_SUBMISSION_RECORDS);
  assert.equal(records[0].submissionId, `id-${MAX_SHARED_SUBMISSION_RECORDS + 4}`);
});

test("mergeSubmissionRecords prefers server records and keeps local-only ones", () => {
  const store = new MemoryStore();
  recordSubmission(store, submissionRecord({ submissionId: "local-only" }));
  recordSubmission(store, submissionRecord({ submissionId: "abc-123", status: "pending" }));

  const merged = mergeSubmissionRecords(store, [
    submissionRecord({ submissionId: "abc-123", status: "approved" })
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].submissionId, "abc-123");
  assert.equal(merged[0].status, "approved");
  assert.equal(merged[1].submissionId, "local-only");
  assert.deepEqual(loadSubmissionRecords(store), merged);
});

test("loadSubmissionRecords drops invalid stored records", () => {
  const store = new MemoryStore();
  store.set("sharedDictionarySubmissions", [
    submissionRecord(),
    { submissionId: "", word: "w", reading: "r", category: "", status: "pending", submittedAt: "" },
    "broken"
  ]);
  assert.equal(loadSubmissionRecords(store).length, 1);
});
