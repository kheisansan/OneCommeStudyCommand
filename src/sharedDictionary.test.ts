import test from "node:test";
import assert from "node:assert/strict";
import {
  importSharedEntries,
  isValidSharedEndpointUrl,
  MAX_SHARED_READING_CODE_POINTS,
  MAX_SHARED_WORD_CODE_POINTS,
  parseSharedDictionaryResponse,
  parseSharedSubmissionsResponse,
  validateSharedSubmission,
  type SharedDictionaryEntry
} from "./sharedDictionary";
import { createEmptyDictionary } from "./dictionaryService";
import type { DictionaryFile } from "./types";

function sharedEntry(overrides: Partial<SharedDictionaryEntry> = {}): SharedDictionaryEntry {
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

test("validateSharedSubmission normalizes word and trims fields", () => {
  const result = validateSharedSubmission({
    word: "　ＧitＨub　",
    reading: " ギットハブ ",
    category: " IT  用語 ",
    authorName: " alice "
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.submission.word, "github");
  assert.equal(result.submission.reading, "ギットハブ");
  assert.equal(result.submission.category, "IT 用語");
  assert.equal(result.submission.authorName, "alice");
});

test("validateSharedSubmission rejects empty and oversized fields", () => {
  const empty = validateSharedSubmission({ word: "  ", reading: "" });
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.ok(empty.errors.includes("EMPTY_WORD"));
    assert.ok(empty.errors.includes("EMPTY_READING"));
  }

  const oversized = validateSharedSubmission({
    word: "あ".repeat(MAX_SHARED_WORD_CODE_POINTS + 1),
    reading: "い".repeat(MAX_SHARED_READING_CODE_POINTS + 1)
  });
  assert.equal(oversized.ok, false);
  if (!oversized.ok) {
    assert.ok(oversized.errors.includes("WORD_TOO_LONG"));
    assert.ok(oversized.errors.includes("READING_TOO_LONG"));
  }
});

test("validateSharedSubmission rejects control and invisible characters", () => {
  for (const value of ["te\u0000st", "te\u200Bst", "te\u202Est"]) {
    const result = validateSharedSubmission({ word: value, reading: "よみ" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.includes("FORBIDDEN_CHARACTER"));
  }
});

test("parseSharedDictionaryResponse accepts a valid payload", () => {
  const payload = parseSharedDictionaryResponse({
    ok: true,
    version: 3,
    entries: [sharedEntry(), sharedEntry({ id: "id-2", word: "onecomme", reading: "ワンコメ" })]
  });

  assert.notEqual(payload, null);
  assert.equal(payload?.version, 3);
  assert.equal(payload?.notModified, false);
  assert.equal(payload?.entries.length, 2);
});

test("parseSharedDictionaryResponse accepts notModified without entries", () => {
  const payload = parseSharedDictionaryResponse({ ok: true, version: 3, notModified: true });
  assert.deepEqual(payload, { version: 3, notModified: true, entries: [] });
});

test("parseSharedDictionaryResponse rejects invalid payloads", () => {
  assert.equal(parseSharedDictionaryResponse(null), null);
  assert.equal(parseSharedDictionaryResponse({ ok: false, version: 1, entries: [] }), null);
  assert.equal(parseSharedDictionaryResponse({ ok: true, version: -1, entries: [] }), null);
  assert.equal(parseSharedDictionaryResponse({ ok: true, version: 1 }), null);
  assert.equal(
    parseSharedDictionaryResponse({
      ok: true,
      version: 1,
      entries: [sharedEntry({ reading: "" })]
    }),
    null
  );
  assert.equal(
    parseSharedDictionaryResponse({
      ok: true,
      version: 1,
      entries: [sharedEntry(), sharedEntry()]
    }),
    null,
    "duplicate ids should be rejected"
  );
  assert.equal(
    parseSharedDictionaryResponse({
      ok: true,
      version: 1,
      entries: [sharedEntry({ word: "te\u0000st" })]
    }),
    null,
    "control characters should be rejected"
  );
});

test("parseSharedDictionaryResponse keeps first entry for duplicated words", () => {
  const payload = parseSharedDictionaryResponse({
    ok: true,
    version: 1,
    entries: [
      sharedEntry({ id: "id-1", word: "GitHub", reading: "ギットハブ" }),
      sharedEntry({ id: "id-2", word: "ｇｉｔｈｕｂ", reading: "ギットハーブ" })
    ]
  });

  assert.equal(payload?.entries.length, 1);
  assert.equal(payload?.entries[0].id, "id-1");
  assert.equal(payload?.entries[0].reading, "ギットハブ");
});

test("parseSharedSubmissionsResponse maps records and validates status", () => {
  const submissions = parseSharedSubmissionsResponse({
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
  });

  assert.notEqual(submissions, null);
  assert.equal(submissions?.[0].submissionId, "abc-123");
  assert.equal(submissions?.[0].status, "approved");
  assert.equal(submissions?.[0].submittedAt, "2026-08-07T00:00:00.000Z");

  assert.equal(
    parseSharedSubmissionsResponse({
      ok: true,
      submissions: [{ submissionId: "abc", word: "w", reading: "r", status: "unknown" }]
    }),
    null
  );
});

test("importSharedEntries adds selected entries and skips existing words", () => {
  const dictionary: DictionaryFile = {
    ...createEmptyDictionary(),
    entries: [
      {
        word: "github",
        reading: "既存の読み",
        priority: 6,
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  };
  const shared = [
    sharedEntry({ id: "id-1", word: "GitHub" }),
    sharedEntry({ id: "id-2", word: "onecomme", reading: "ワンコメ", author: "" })
  ];

  const imported = importSharedEntries(
    dictionary,
    shared,
    ["id-1", "id-2", "id-2", "missing"],
    new Date("2026-08-07T00:00:00.000Z")
  );

  assert.deepEqual(imported.result, { addedCount: 1, skippedCount: 1, missingCount: 1 });
  assert.equal(imported.dictionary.entries.length, 2);
  const added = imported.dictionary.entries[1];
  assert.equal(added.word, "onecomme");
  assert.equal(added.reading, "ワンコメ");
  assert.equal(added.createdBy, "共有辞書");
  assert.equal(added.enabled, true);
  assert.equal(added.priority, 8);
  assert.equal(added.createdAt, "2026-08-07T00:00:00.000Z");
  assert.equal(dictionary.entries.length, 1, "the original dictionary must not change");
});

test("importSharedEntries keeps shared author as createdBy", () => {
  const imported = importSharedEntries(createEmptyDictionary(), [sharedEntry()], ["id-1"]);
  assert.equal(imported.dictionary.entries[0].createdBy, "alice");
});

test("isValidSharedEndpointUrl requires https URLs", () => {
  assert.equal(isValidSharedEndpointUrl("https://script.google.com/macros/s/x/exec"), true);
  assert.equal(isValidSharedEndpointUrl("http://script.google.com/macros/s/x/exec"), false);
  assert.equal(isValidSharedEndpointUrl("not a url"), false);
  assert.equal(isValidSharedEndpointUrl(""), false);
});
