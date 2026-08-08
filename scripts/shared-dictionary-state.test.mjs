import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const stateApi = require("../static/shared-dictionary-state.js");

function sharedEntry(overrides = {}) {
  return {
    id: "id-1",
    word: "github",
    reading: "ギットハブ",
    category: "IT",
    author: "alice",
    updatedAt: "2026-08-07T00:00:00.000Z",
    ...overrides
  };
}

function sharedData(overrides = {}) {
  return {
    settings: { endpointUrl: "https://example.com" },
    cache: {
      version: 1,
      entries: [sharedEntry(), sharedEntry({ id: "id-2", word: "onecomme" })],
      fetchedAt: "2026-08-07T00:00:00.000Z"
    },
    submissions: [],
    ...overrides
  };
}

test("applySharedData adopts settings, cache, and submissions", () => {
  const state = stateApi.createSharedDictionaryState();
  const applied = stateApi.applySharedData(state, sharedData(), []);

  assert.equal(applied.settings.endpointUrl, "https://example.com");
  assert.equal(applied.cache.version, 1);
  assert.equal(applied.cache.entries.length, 2);
});

test("applySharedData prunes selections that are no longer importable", () => {
  let state = stateApi.createSharedDictionaryState();
  state = stateApi.applySharedData(state, sharedData(), []);
  state = stateApi.toggleSelected(state, "id-1", true);
  state = stateApi.toggleSelected(state, "id-2", true);

  const localEntries = [{ word: "GitHub" }];
  state = stateApi.applySharedData(state, sharedData(), localEntries);

  assert.deepEqual([...state.selectedIds], ["id-2"]);
});

test("applySharedData tolerates invalid payloads", () => {
  const state = stateApi.createSharedDictionaryState();
  assert.equal(stateApi.applySharedData(state, null, []), state);

  const applied = stateApi.applySharedData(
    state,
    { settings: { endpointUrl: 42 }, cache: { broken: true }, submissions: "x" },
    []
  );
  assert.equal(applied.settings.endpointUrl, null);
  assert.equal(applied.cache, null);
  assert.deepEqual(applied.submissions, []);
});

test("isImported matches by normalized word", () => {
  const localEntries = [{ word: "ＧitＨub" }];
  assert.equal(stateApi.isImported(sharedEntry(), localEntries), true);
  assert.equal(stateApi.isImported(sharedEntry({ word: "onecomme" }), localEntries), false);
});

test("importableIds lists only entries missing from the local dictionary", () => {
  const cache = sharedData().cache;
  assert.deepEqual(stateApi.importableIds(cache, [{ word: "github" }]), ["id-2"]);
  assert.deepEqual(stateApi.importableIds(null, []), []);
});

test("setAllSelected selects and clears the given ids", () => {
  let state = stateApi.createSharedDictionaryState();
  state = stateApi.setAllSelected(state, ["id-1", "id-2"], true);
  assert.deepEqual([...state.selectedIds].sort(), ["id-1", "id-2"]);

  state = stateApi.setAllSelected(state, ["id-1", "id-2"], false);
  assert.equal(state.selectedIds.size, 0);
});

test("submissionStatusLabel maps statuses to Japanese labels", () => {
  assert.equal(stateApi.submissionStatusLabel("pending"), "承認待ち");
  assert.equal(stateApi.submissionStatusLabel("approved"), "承認済み");
  assert.equal(stateApi.submissionStatusLabel("rejected"), "却下");
  assert.equal(stateApi.submissionStatusLabel("unknown"), "unknown");
});

test("sharedErrorMessage maps client, validation, and server codes", () => {
  assert.equal(
    stateApi.sharedErrorMessage({ code: "NOT_CONFIGURED" }),
    "共有辞書のURLが設定されていません。"
  );
  assert.equal(
    stateApi.sharedErrorMessage({ code: "SERVER_REJECTED", serverCode: "DUPLICATE" }),
    "同じ単語がすでに登録または承認待ちです。"
  );
  assert.equal(
    stateApi.sharedErrorMessage({
      code: "INVALID_SUBMISSION",
      errors: ["EMPTY_WORD", "READING_TOO_LONG"]
    }),
    "単語を入力してください。 読みは200文字以内で入力してください。"
  );
  assert.equal(stateApi.sharedErrorMessage(undefined), "エラーが発生しました。");
});

test("submissionTypeLabel maps types to Japanese labels", () => {
  assert.equal(stateApi.submissionTypeLabel("add"), "追加");
  assert.equal(stateApi.submissionTypeLabel("remove"), "削除");
  assert.equal(stateApi.submissionTypeLabel(undefined), "追加");
});
