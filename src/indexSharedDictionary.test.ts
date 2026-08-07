import test from "node:test";
import assert from "node:assert/strict";
import type { StoreLike } from "./types";

const plugin = require("./index");

class MemoryStore implements StoreLike {
  private readonly values = new Map<string, unknown>();

  get(key: string, defaultValue?: unknown): unknown {
    return this.values.has(key) ? this.values.get(key) : defaultValue;
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

const ENDPOINT = "https://script.google.com/macros/s/deploy-id/exec";

function sharedRequest(body: Record<string, unknown>) {
  return plugin.request({ method: "PUT", body: { sharedDictionary: body } });
}

function withFetchStub(
  handler: (url: string, init?: { body?: string }) => unknown,
  run: () => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = async (
    url: string,
    init?: { body?: string }
  ) => ({
    ok: true,
    status: 200,
    json: async () => handler(url, init)
  });
  return run().finally(() => {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
  });
}

test("shared dictionary requires configuration before fetching", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  const response = await sharedRequest({ action: "fetch" });
  assert.equal(response.code, 400);
  assert.equal(response.response.sharedError.code, "NOT_CONFIGURED");
  plugin.destroy();
});

test("configure validates the endpoint URL and clears cache on change", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  const invalid = await sharedRequest({ action: "configure", endpointUrl: "ftp://x" });
  assert.equal(invalid.code, 400);
  assert.equal(invalid.response.sharedError.code, "INVALID_ENDPOINT");

  const configured = await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });
  assert.equal(configured.code, 200);
  assert.equal(configured.response.sharedDictionary.settings.endpointUrl, ENDPOINT);
  plugin.destroy();
});

test("fetch stores the shared dictionary cache and import adds entries", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  await withFetchStub(
    () => ({
      ok: true,
      version: 2,
      entries: [
        {
          id: "id-1",
          word: "GitHub",
          reading: "ギットハブ",
          category: "IT",
          author: "alice",
          updatedAt: "2026-08-07T00:00:00.000Z"
        },
        {
          id: "id-2",
          word: "onecomme",
          reading: "ワンコメ",
          category: "配信",
          author: "user01",
          updatedAt: "2026-08-07T00:00:00.000Z"
        }
      ]
    }),
    async () => {
      const fetched = await sharedRequest({ action: "fetch" });
      assert.equal(fetched.code, 200);
      assert.equal(fetched.response.sharedFetch.source, "remote");
      assert.equal(fetched.response.sharedDictionary.cache.version, 2);
      assert.equal(fetched.response.sharedDictionary.cache.entries.length, 2);
      assert.equal(fetched.response.sharedDictionary.cache.entries[0].word, "github");
    }
  );

  const imported = await sharedRequest({ action: "import", ids: ["id-1"] });
  assert.equal(imported.code, 200);
  assert.deepEqual(imported.response.sharedImportResult, {
    addedCount: 1,
    skippedCount: 0,
    missingCount: 0
  });
  const words = imported.response.dictionary.entries.map(
    (entry: { word: string }) => entry.word
  );
  assert.deepEqual(words, ["github"]);
  assert.equal(imported.response.dictionary.entries[0].createdBy, "alice");

  const again = await sharedRequest({ action: "import", ids: ["id-1", "id-2"] });
  assert.deepEqual(again.response.sharedImportResult, {
    addedCount: 1,
    skippedCount: 1,
    missingCount: 0
  });
  plugin.destroy();
});

test("fetch serves fresh results from cache without calling the network", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  let networkCalls = 0;
  await withFetchStub(
    () => {
      networkCalls += 1;
      return { ok: true, version: 1, entries: [] };
    },
    async () => {
      await sharedRequest({ action: "fetch" });
      const cached = await sharedRequest({ action: "fetch" });
      assert.equal(cached.response.sharedFetch.source, "cache");
      assert.equal(networkCalls, 1);

      const forced = await sharedRequest({ action: "fetch", force: true });
      assert.equal(forced.response.sharedFetch.source, "remote");
      assert.equal(networkCalls, 2);
    }
  );
  plugin.destroy();
});

test("submit validates locally, posts with a token, and records pending status", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  const invalid = await sharedRequest({ action: "submit", word: "  ", reading: "" });
  assert.equal(invalid.code, 400);
  assert.equal(invalid.response.sharedError.code, "INVALID_SUBMISSION");

  let postedBody: Record<string, unknown> | null = null;
  await withFetchStub(
    (_url, init) => {
      postedBody = JSON.parse(init?.body ?? "{}");
      return { ok: true, submissionId: "abc-123" };
    },
    async () => {
      const submitted = await sharedRequest({
        action: "submit",
        word: "GitHub",
        reading: "ギットハブ",
        category: "IT",
        authorName: "alice"
      });
      assert.equal(submitted.code, 200);
      assert.equal(submitted.response.sharedSubmissionId, "abc-123");
      const records = submitted.response.sharedDictionary.submissions;
      assert.equal(records.length, 1);
      assert.equal(records[0].status, "pending");
      assert.equal(records[0].word, "github");
    }
  );

  assert.notEqual(postedBody, null);
  assert.equal(postedBody!.word, "github");
  assert.equal(typeof postedBody!.token, "string");
  assert.ok((postedBody!.token as string).length > 0);
  plugin.destroy();
});

test("submit surfaces server rejection codes", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  await withFetchStub(
    () => ({ ok: false, code: "DUPLICATE" }),
    async () => {
      const rejected = await sharedRequest({
        action: "submit",
        word: "GitHub",
        reading: "ギットハブ"
      });
      assert.equal(rejected.code, 502);
      assert.equal(rejected.response.sharedError.code, "SERVER_REJECTED");
      assert.equal(rejected.response.sharedError.serverCode, "DUPLICATE");
      assert.equal(rejected.response.sharedDictionary.submissions.length, 0);
    }
  );
  plugin.destroy();
});

test("refreshSubmissions merges server statuses into local records", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  await withFetchStub(
    (url, init) => {
      if (init?.body) return { ok: true, submissionId: "abc-123" };
      assert.ok(new URL(url).searchParams.get("token"));
      return {
        ok: true,
        submissions: [
          {
            submissionId: "abc-123",
            word: "github",
            reading: "ギットハブ",
            category: "IT",
            status: "approved",
            createdAt: "2026-08-07T00:00:00.000Z"
          }
        ]
      };
    },
    async () => {
      await sharedRequest({
        action: "submit",
        word: "GitHub",
        reading: "ギットハブ",
        category: "IT"
      });
      const refreshed = await sharedRequest({ action: "refreshSubmissions" });
      assert.equal(refreshed.code, 200);
      const records = refreshed.response.sharedDictionary.submissions;
      assert.equal(records.length, 1);
      assert.equal(records[0].status, "approved");
    }
  );
  plugin.destroy();
});

test("GET exposes the shared dictionary state", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  const response = plugin.request({ method: "GET" });
  assert.equal(response.code, 200);
  assert.deepEqual(response.response.sharedDictionary, {
    settings: { endpointUrl: ENDPOINT },
    cache: null,
    submissions: []
  });
  plugin.destroy();
});

function waitForAsyncSubmission(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

test("shared teach command teaches locally and submits to the shared dictionary", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  let postedBody: Record<string, unknown> | null = null;
  await withFetchStub(
    (_url, init) => {
      postedBody = JSON.parse(init?.body ?? "{}");
      return { ok: true, submissionId: "cmd-1" };
    },
    async () => {
      const filteredComment = plugin.filterComment(
        {
          data: {
            comment: "共有教育(GitHub=ギットハブ)",
            speechText: "共有教育(GitHub=ギットハブ)"
          }
        },
        null,
        { name: "alice" }
      );

      assert.notEqual(filteredComment, false);
      assert.equal(
        filteredComment.data?.speechText,
        "github は ギットハブ を覚えました。 共有辞書へも申請しました。"
      );
      await waitForAsyncSubmission();
    }
  );

  assert.notEqual(postedBody, null);
  assert.equal(postedBody!.type, "add");
  assert.equal(postedBody!.word, "github");
  assert.equal(postedBody!.reading, "ギットハブ");
  assert.equal(postedBody!.authorName, "alice");

  const state = plugin.request({ method: "GET" });
  assert.equal(state.response.dictionary.entries[0].word, "github");
  assert.equal(state.response.sharedDictionary.submissions[0].submissionId, "cmd-1");
  assert.equal(state.response.sharedDictionary.submissions[0].type, "add");
  plugin.destroy();
});

test("shared forget command forgets locally and submits a removal request", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });
  plugin.request({ method: "PUT", body: { word: "GitHub", reading: "ギットハブ" } });

  let postedBody: Record<string, unknown> | null = null;
  await withFetchStub(
    (_url, init) => {
      postedBody = JSON.parse(init?.body ?? "{}");
      return { ok: true, submissionId: "cmd-2" };
    },
    async () => {
      const filteredComment = plugin.filterComment(
        {
          data: {
            comment: "共有忘却(GitHub)",
            speechText: "共有忘却(GitHub)"
          }
        },
        null,
        { name: "alice" }
      );

      assert.notEqual(filteredComment, false);
      assert.equal(
        filteredComment.data?.speechText,
        "ギットハブ を忘れました。 共有辞書からの削除も申請しました。"
      );
      await waitForAsyncSubmission();
    }
  );

  assert.notEqual(postedBody, null);
  assert.equal(postedBody!.type, "remove");
  assert.equal(postedBody!.word, "github");
  assert.equal(postedBody!.reading, "");

  const state = plugin.request({ method: "GET" });
  assert.equal(state.response.dictionary.entries.length, 0);
  assert.equal(state.response.sharedDictionary.submissions[0].type, "remove");
  plugin.destroy();
});

test("shared forget command submits removal even when the word is not local", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  await withFetchStub(
    () => ({ ok: true, submissionId: "cmd-3" }),
    async () => {
      const filteredComment = plugin.filterComment(
        {
          data: {
            comment: "共有忘却(GitHub)",
            speechText: "共有忘却(GitHub)"
          }
        },
        null,
        null
      );

      assert.notEqual(filteredComment, false);
      assert.equal(
        filteredComment.data?.speechText,
        "github の削除を共有辞書へ申請しました。"
      );
      await waitForAsyncSubmission();
    }
  );
  plugin.destroy();
});

test("shared commands report a missing configuration", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  const filteredComment = plugin.filterComment(
    {
      data: {
        comment: "共有教育(GitHub=ギットハブ)",
        speechText: "共有教育(GitHub=ギットハブ)"
      }
    },
    null,
    { name: "alice" }
  );

  assert.notEqual(filteredComment, false);
  assert.equal(filteredComment.data?.speechText, "共有辞書が設定されていません。");
  const state = plugin.request({ method: "GET" });
  assert.equal(state.response.dictionary.entries.length, 0);
  plugin.destroy();
});

test("shared commands can be disabled via settings", async () => {
  const store = new MemoryStore();
  store.set("settings", {
    educationCommandEnabled: true,
    forgetCommandEnabled: true,
    sharedEducationCommandEnabled: false,
    sharedForgetCommandEnabled: false
  });
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  const comment = {
    data: {
      comment: "共有教育(GitHub=ギットハブ)",
      speechText: "共有教育(GitHub=ギットハブ)"
    }
  };
  const filteredComment = plugin.filterComment(comment, null, { name: "alice" });
  assert.equal(filteredComment, comment);
  plugin.destroy();
});
