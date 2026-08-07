import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchOwnSubmissions,
  fetchSharedDictionary,
  submitSharedEntry,
  type FetchLike
} from "./sharedDictionaryClient";

const ENDPOINT = "https://script.google.com/macros/s/deploy-id/exec";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test("fetchSharedDictionary requests the dictionary action with known version", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    return jsonResponse({ ok: true, version: 4, entries: [] });
  };

  const outcome = await fetchSharedDictionary(ENDPOINT, 3, fetchImpl);

  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.payload.version, 4);
    assert.equal(outcome.payload.notModified, false);
  }
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get("action"), "dictionary");
  assert.equal(url.searchParams.get("version"), "3");
});

test("fetchSharedDictionary omits version parameter without a cache", async () => {
  let requestedUrl = "";
  const fetchImpl: FetchLike = async (url) => {
    requestedUrl = url;
    return jsonResponse({ ok: true, version: 1, entries: [] });
  };

  await fetchSharedDictionary(ENDPOINT, null, fetchImpl);
  assert.equal(new URL(requestedUrl).searchParams.has("version"), false);
});

test("fetchSharedDictionary maps failures to error codes", async () => {
  const httpError = await fetchSharedDictionary(ENDPOINT, null, async () =>
    jsonResponse({}, 500)
  );
  assert.deepEqual(httpError, { ok: false, code: "HTTP_ERROR", status: 500 });

  const networkError = await fetchSharedDictionary(ENDPOINT, null, async () => {
    throw new Error("offline");
  });
  assert.deepEqual(networkError, { ok: false, code: "NETWORK_ERROR" });

  const invalidJson = await fetchSharedDictionary(ENDPOINT, null, async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("not json");
    }
  }));
  assert.deepEqual(invalidJson, { ok: false, code: "INVALID_RESPONSE" });

  const rejected = await fetchSharedDictionary(ENDPOINT, null, async () =>
    jsonResponse({ ok: false, code: "BLOCKED" })
  );
  assert.deepEqual(rejected, { ok: false, code: "SERVER_REJECTED", serverCode: "BLOCKED" });
});

test("fetchSharedDictionary reports a timeout when the signal aborts", async () => {
  const fetchImpl: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });

  const outcome = await fetchSharedDictionary(ENDPOINT, null, fetchImpl, 20);
  assert.deepEqual(outcome, { ok: false, code: "TIMEOUT" });
});

test("submitSharedEntry posts JSON as text/plain and returns the submission id", async () => {
  let requestInit: Parameters<FetchLike>[1];
  const fetchImpl: FetchLike = async (_url, init) => {
    requestInit = init;
    return jsonResponse({ ok: true, submissionId: "abc-123" });
  };

  const outcome = await submitSharedEntry(
    ENDPOINT,
    { type: "add", word: "github", reading: "ギットハブ", category: "IT", authorName: "alice" },
    "token-1",
    fetchImpl
  );

  assert.deepEqual(outcome, { ok: true, submissionId: "abc-123" });
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.headers?.["Content-Type"], "text/plain;charset=utf-8");
  assert.deepEqual(JSON.parse(requestInit?.body ?? "{}"), {
    action: "submit",
    type: "add",
    word: "github",
    reading: "ギットハブ",
    category: "IT",
    authorName: "alice",
    token: "token-1"
  });
});

test("submitSharedEntry passes through server rejection codes", async () => {
  const outcome = await submitSharedEntry(
    ENDPOINT,
    { type: "add", word: "github", reading: "ギットハブ", category: "", authorName: "" },
    "token-1",
    async () => jsonResponse({ ok: false, code: "DUPLICATE" })
  );
  assert.deepEqual(outcome, { ok: false, code: "SERVER_REJECTED", serverCode: "DUPLICATE" });
});

test("fetchOwnSubmissions requests the submissions action with the token", async () => {
  let requestedUrl = "";
  const fetchImpl: FetchLike = async (url) => {
    requestedUrl = url;
    return jsonResponse({
      ok: true,
      submissions: [
        {
          submissionId: "abc-123",
          word: "github",
          reading: "ギットハブ",
          category: "",
          status: "pending",
          createdAt: "2026-08-07T00:00:00.000Z"
        }
      ]
    });
  };

  const outcome = await fetchOwnSubmissions(ENDPOINT, "token-1", fetchImpl);

  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.submissions.length, 1);
    assert.equal(outcome.submissions[0].submissionId, "abc-123");
  }
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("action"), "submissions");
  assert.equal(url.searchParams.get("token"), "token-1");
});
