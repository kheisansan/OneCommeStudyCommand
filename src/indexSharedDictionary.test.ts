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
    submissions: [],
    moderator: { registered: false, name: "", registeredAt: "" },
    pending: []
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

async function registerAsModerator(): Promise<void> {
  await withFetchStub(
    () => ({ ok: true }),
    async () => {
      const registered = await sharedRequest({
        action: "registerModerator",
        password: "secret-password",
        name: "mod-alice"
      });
      assert.equal(registered.code, 200);
      assert.equal(registered.response.sharedDictionary.moderator.registered, true);
      assert.equal(registered.response.sharedDictionary.moderator.name, "mod-alice");
    }
  );
}

test("moderator registration requires the endpoint and posts the password", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  const unconfigured = await sharedRequest({
    action: "registerModerator",
    password: "x"
  });
  assert.equal(unconfigured.code, 400);
  assert.equal(unconfigured.response.sharedError.code, "NOT_CONFIGURED");

  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  let postedBody: Record<string, unknown> | null = null;
  await withFetchStub(
    (_url, init) => {
      postedBody = JSON.parse(init?.body ?? "{}");
      return { ok: true };
    },
    async () => {
      const registered = await sharedRequest({
        action: "registerModerator",
        password: "secret-password",
        name: "mod-alice"
      });
      assert.equal(registered.code, 200);
    }
  );

  assert.equal(postedBody!.action, "registerModerator");
  assert.equal(postedBody!.password, "secret-password");
  assert.equal(postedBody!.name, "mod-alice");
  assert.equal(typeof postedBody!.token, "string");
  plugin.destroy();
});

test("moderator registration surfaces an invalid password", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  await withFetchStub(
    () => ({ ok: false, code: "INVALID_PASSWORD" }),
    async () => {
      const rejected = await sharedRequest({
        action: "registerModerator",
        password: "wrong"
      });
      assert.equal(rejected.code, 502);
      assert.equal(rejected.response.sharedError.serverCode, "INVALID_PASSWORD");
      assert.equal(rejected.response.sharedDictionary.moderator.registered, false);
    }
  );
  plugin.destroy();
});

test("refreshPending requires moderator registration and stores the pending list", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  const notModerator = await sharedRequest({ action: "refreshPending" });
  assert.equal(notModerator.code, 403);
  assert.equal(notModerator.response.sharedError.code, "NOT_MODERATOR");

  await registerAsModerator();

  await withFetchStub(
    (url) => {
      assert.equal(new URL(url).searchParams.get("action"), "pending");
      return {
        ok: true,
        pending: [
          {
            submissionId: "p-1",
            type: "add",
            word: "github",
            reading: "ギットハブ",
            category: "IT",
            authorName: "user99",
            createdAt: "2026-08-07T00:00:00.000Z"
          }
        ]
      };
    },
    async () => {
      const refreshed = await sharedRequest({ action: "refreshPending" });
      assert.equal(refreshed.code, 200);
      assert.equal(refreshed.response.sharedDictionary.pending.length, 1);
      assert.equal(refreshed.response.sharedDictionary.pending[0].word, "github");
    }
  );
  plugin.destroy();
});

test("review sends the decision and removes the pending entry locally", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });
  await registerAsModerator();

  await withFetchStub(
    (url) => ({
      ok: true,
      pending: [
        {
          submissionId: "p-1",
          type: "add",
          word: "github",
          reading: "ギットハブ",
          category: "",
          authorName: "",
          createdAt: ""
        }
      ]
    }),
    async () => {
      await sharedRequest({ action: "refreshPending" });
    }
  );

  let postedBody: Record<string, unknown> | null = null;
  await withFetchStub(
    (_url, init) => {
      postedBody = JSON.parse(init?.body ?? "{}");
      return { ok: true, submissionId: "p-1", word: "github", decision: "approve" };
    },
    async () => {
      const reviewed = await sharedRequest({
        action: "review",
        submissionId: "p-1",
        decision: "approve"
      });
      assert.equal(reviewed.code, 200);
      assert.deepEqual(reviewed.response.sharedReviewResult, {
        submissionId: "p-1",
        word: "github",
        decision: "approve"
      });
      assert.equal(reviewed.response.sharedDictionary.pending.length, 0);
    }
  );

  assert.equal(postedBody!.action, "review");
  assert.equal(postedBody!.submissionId, "p-1");
  assert.equal(postedBody!.decision, "approve");
  plugin.destroy();
});

test("review reports NOT_FOUND for stale submission ids", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });
  await registerAsModerator();

  await withFetchStub(
    () => ({ ok: false, code: "NOT_FOUND" }),
    async () => {
      const rejected = await sharedRequest({
        action: "review",
        submissionId: "already-processed",
        decision: "approve"
      });
      assert.equal(rejected.code, 502);
      assert.equal(rejected.response.sharedError.serverCode, "NOT_FOUND");
    }
  );
  plugin.destroy();
});

test("revoked moderators are cleared locally on server rejection", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });
  await registerAsModerator();

  await withFetchStub(
    () => ({ ok: false, code: "NOT_MODERATOR" }),
    async () => {
      const rejected = await sharedRequest({ action: "refreshPending" });
      assert.equal(rejected.code, 502);
      assert.equal(rejected.response.sharedDictionary.moderator.registered, false);
    }
  );
  plugin.destroy();
});

test("shared approve command runs only for the channel owner", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });
  await registerAsModerator();

  let reviewBody: Record<string, unknown> | null = null;
  await withFetchStub(
    (url, init) => {
      if (init?.body) {
        reviewBody = JSON.parse(init.body);
        return { ok: true, submissionId: "p-9", word: "github", decision: "approve" };
      }
      assert.equal(new URL(url).searchParams.get("action"), "pending");
      return {
        ok: true,
        pending: [
          {
            submissionId: "p-9",
            type: "add",
            word: "GitHub",
            reading: "ギットハブ",
            category: "",
            authorName: "",
            createdAt: ""
          }
        ]
      };
    },
    async () => {
      const viewerComment = {
        data: {
          comment: "共有承認(GitHub)",
          speechText: "共有承認(GitHub)",
          isOwner: false
        }
      };
      const ignored = plugin.filterComment(viewerComment, null, { name: "viewer" });
      assert.equal(ignored, viewerComment);
      assert.equal(ignored.data.speechText, "共有承認(GitHub)");

      const ownerComment = plugin.filterComment(
        {
          data: {
            comment: "共有承認(GitHub)",
            speechText: "共有承認(GitHub)",
            isOwner: true
          }
        },
        null,
        { name: "owner" }
      );
      assert.notEqual(ownerComment, false);
      assert.equal(ownerComment.data?.speechText, "github の承認を送信しました。");
      await waitForAsyncSubmission();
    }
  );

  assert.notEqual(reviewBody, null);
  assert.equal(reviewBody!.action, "review");
  assert.equal(reviewBody!.submissionId, "p-9");
  assert.equal(reviewBody!.decision, "approve");
  plugin.destroy();
});

test("changing the endpoint regenerates the token and clears shared state", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });
  await registerAsModerator();

  let firstToken = "";
  await withFetchStub(
    (_url, init) => {
      firstToken = String(JSON.parse(init?.body ?? "{}").token ?? "");
      return { ok: true, submissionId: "s-1" };
    },
    async () => {
      await sharedRequest({ action: "submit", word: "GitHub", reading: "ギットハブ" });
    }
  );
  assert.ok(firstToken.length > 0);

  const reconfigured = await sharedRequest({
    action: "configure",
    endpointUrl: "https://script.google.com/macros/s/other-deploy/exec"
  });
  assert.equal(reconfigured.response.sharedDictionary.moderator.registered, false);
  assert.equal(reconfigured.response.sharedDictionary.submissions.length, 0);
  assert.equal(reconfigured.response.sharedDictionary.pending.length, 0);
  assert.equal(reconfigured.response.sharedDictionary.cache, null);

  let secondToken = "";
  await withFetchStub(
    (_url, init) => {
      secondToken = String(JSON.parse(init?.body ?? "{}").token ?? "");
      return { ok: true, submissionId: "s-2" };
    },
    async () => {
      await sharedRequest({ action: "submit", word: "GitHub", reading: "ギットハブ" });
    }
  );
  assert.ok(secondToken.length > 0);
  assert.notEqual(secondToken, firstToken, "token must be regenerated per endpoint");
  plugin.destroy();
});

test("shared reject command requires moderator registration", async () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  await sharedRequest({ action: "configure", endpointUrl: ENDPOINT });

  const filteredComment = plugin.filterComment(
    {
      data: {
        comment: "共有却下(GitHub)",
        speechText: "共有却下(GitHub)",
        isOwner: true
      }
    },
    null,
    { name: "owner" }
  );
  assert.notEqual(filteredComment, false);
  assert.equal(filteredComment.data?.speechText, "モデレーター登録がされていません。");
  plugin.destroy();
});
