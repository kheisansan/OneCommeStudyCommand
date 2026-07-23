import test from "node:test";
import assert from "node:assert/strict";
import {
  importStudyDictionary,
  MAX_STUDY_DICTIONARY_BASE64_LENGTH,
  MAX_STUDY_DICTIONARY_BYTES,
  MAX_STUDY_DICTIONARY_LINE_BYTES,
  MAX_STUDY_DICTIONARY_ROWS,
  MAX_STUDY_DICTIONARY_VALUE_CODE_POINTS,
  parseStudyDictionaryBytes
} from "./studyDictionaryImport";
import type { DictionaryFile } from "./types";

const encoder = new TextEncoder();

test("parse UTF-8 study dictionaries with BOM and CRLF or without BOM and LF", () => {
  for (const bytes of [
    Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("7\tE\tGANBARE\tがんばれ\r\n2\tN\t原神\tげんしん\r\n")
    ]),
    encoder.encode("7\tE\tGANBARE\tがんばれ\n2\tN\t原神\tげんしん")
  ]) {
    const parsed = parseStudyDictionaryBytes(bytes);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    assert.equal(parsed.sourceRowCount, 2);
    assert.deepEqual(
      parsed.candidates.map(({ word, reading }) => ({ word, reading })),
      [
        { word: "ganbare", reading: "がんばれ" },
        { word: "原神", reading: "げんしん" }
      ]
    );
  }
});

test("merge identical normalized words and reject conflicting readings", () => {
  const merged = parseStudyDictionaryBytes(
    encoder.encode("3\tE\tＦＦ１４\t よみ \n3\tN\tff14\tよみ")
  );
  assert.equal(merged.ok, true);
  if (merged.ok) {
    assert.equal(merged.candidates.length, 1);
    assert.equal(merged.mergedDuplicateCount, 1);
  }

  const conflicted = parseStudyDictionaryBytes(
    encoder.encode("3\tE\tＦＦ１４\tよみ\n3\tN\tff14\t別\n3\tN\tFF14\tさらに別")
  );
  assert.equal(conflicted.ok, false);
  if (!conflicted.ok) {
    assert.deepEqual(conflicted.error.errors, [
      { code: "CONFLICTING_DUPLICATE", line: 2 },
      { code: "CONFLICTING_DUPLICATE", line: 3 }
    ]);
  }
});

test("report row validation errors without exposing dictionary contents", () => {
  const parsed = parseStudyDictionaryBytes(
    encoder.encode("0\tX\t \t \nabc\tN\tword\treading\n1\tN\tmissing-column")
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;

  assert.deepEqual(parsed.error.errors, [
    { code: "INVALID_SOURCE_LENGTH", line: 1 },
    { code: "INVALID_MATCH_TYPE", line: 1 },
    { code: "EMPTY_WORD", line: 1 },
    { code: "EMPTY_READING", line: 1 },
    { code: "INVALID_SOURCE_LENGTH", line: 2 },
    { code: "INVALID_COLUMN_COUNT", line: 3 }
  ]);
  assert.equal(JSON.stringify(parsed.error).includes("word"), false);
  assert.equal(JSON.stringify(parsed.error).includes("reading"), false);
});

test("reject invalid BOM, UTF-8, line breaks, and empty dictionaries", () => {
  const cases: Array<[Uint8Array, string]> = [
    [Buffer.from("1\tN\tword\treading\n\ufeff1\tN\tother\treading"), "INVALID_BOM"],
    [Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x31]), "INVALID_BOM"],
    [Buffer.from([0xff]), "INVALID_UTF8"],
    [encoder.encode("1\tN\tword\treading\rother"), "INVALID_LINE_BREAK"],
    [encoder.encode(""), "EMPTY_DICTIONARY"]
  ];

  for (const [bytes, code] of cases) {
    const parsed = parseStudyDictionaryBytes(bytes);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.error.errors[0].code, code);
  }
});

test("truncate error details after 100 while preserving the total", () => {
  const parsed = parseStudyDictionaryBytes(
    encoder.encode(Array.from({ length: 101 }, () => "invalid").join("\n"))
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.error.errorCount, 101);
  assert.equal(parsed.error.errors.length, 100);
  assert.equal(parsed.error.truncated, true);
});

test("enforce file, row, line, word, and reading limits", () => {
  const cases: Array<[Uint8Array, string]> = [
    [new Uint8Array(MAX_STUDY_DICTIONARY_BYTES + 1), "FILE_TOO_LARGE"],
    [
      encoder.encode(
        Array.from({ length: MAX_STUDY_DICTIONARY_ROWS + 1 }, () => "1\tN\ta\tb").join("\n")
      ),
      "TOO_MANY_ROWS"
    ],
    [
      encoder.encode(`1\tN\t${"a".repeat(MAX_STUDY_DICTIONARY_LINE_BYTES)}\tb`),
      "LINE_TOO_LARGE"
    ],
    [
      encoder.encode(`1\tN\t${"a".repeat(MAX_STUDY_DICTIONARY_VALUE_CODE_POINTS + 1)}\tb`),
      "WORD_TOO_LONG"
    ],
    [
      encoder.encode(`1\tN\ta\t${"b".repeat(MAX_STUDY_DICTIONARY_VALUE_CODE_POINTS + 1)}`),
      "READING_TOO_LONG"
    ]
  ];

  for (const [bytes, code] of cases) {
    const parsed = parseStudyDictionaryBytes(bytes);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.error.errors[0].code, code);
  }
});

test("accept source lengths with leading zeros and both match types", () => {
  const parsed = parseStudyDictionaryBytes(
    encoder.encode("001\tN\tword\treading\n0002\tE\tother\treading")
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.candidates.length, 2);
});

test("import canonical Base64, preserve existing entries, and assign defaults", () => {
  const current: DictionaryFile = {
    version: 2,
    entries: [
      {
        word: "ff14",
        reading: "既存",
        priority: 99,
        enabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  };
  const content = "4\tE\tＦＦ１４\t新規\n3\tN\t𠮷野家\tよしのや\n3\tN\t𠮷野家\tよしのや";
  const imported = importStudyDictionary(
    Buffer.from(content).toString("base64"),
    current,
    new Date("2026-07-16T00:00:00.000Z")
  );

  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.deepEqual(imported.importResult, {
    sourceRowCount: 3,
    candidateCount: 2,
    mergedDuplicateCount: 1,
    addedCount: 1,
    skippedCount: 1
  });
  assert.deepEqual(imported.dictionary.entries[0], current.entries[0]);
  assert.deepEqual(imported.dictionary.entries[1], {
    word: "𠮷野家",
    reading: "よしのや",
    priority: 3,
    enabled: true,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z"
  });
});

test("reject non-canonical and oversized Base64 before parsing", () => {
  const current: DictionaryFile = { version: 2, entries: [] };
  for (const content of ["", "YQ", "YQ===", "YQ==\n", "YQ__"]) {
    const imported = importStudyDictionary(content, current);
    assert.equal(imported.ok, false);
    if (!imported.ok) assert.equal(imported.error.errors[0].code, "INVALID_BASE64");
  }

  const oversized = importStudyDictionary(
    "A".repeat(MAX_STUDY_DICTIONARY_BASE64_LENGTH + 1),
    current
  );
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.error.errors[0].code, "BASE64_TOO_LARGE");
});
