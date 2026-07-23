import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const studyImport = require("../static/study-dictionary-import.js");
const encoder = new TextEncoder();

test("preview a representative study dictionary with a normalized duplicate", () => {
  const rows = [
    "5\tE\tALPHA\tあるふぁ",
    "4\tE\tBETA\tべーた",
    "5\tE\tGAMMA\tがんま",
    "5\tE\tDELTA\tでるた",
    "7\tE\tEPSILON\tいぷしろん",
    "4\tE\tZETA\tぜーた",
    "3\tE\tETA\tいーた",
    "5\tE\tTHETA\tしーた",
    "4\tE\tIOTA\tいおた",
    "5\tE\tKAPPA\tかっぱ",
    "6\tE\tLAMBDA\tらむだ",
    "2\tN\t猫\tねこ",
    "2\tN\t犬\tいぬ",
    "11\tE\tSAMPLE   WORD\tさんぷる",
    "11\tE\tsample word\tさんぷる"
  ];
  const bytes = encoder.encode(rows.join("\r\n"));

  const preview = studyImport.preview("ReplaceStudy.dic", bytes, []);

  assert.deepEqual(preview, {
    ok: true,
    sourceRowCount: 15,
    candidateCount: 14,
    mergedDuplicateCount: 1,
    addedCount: 14,
    skippedCount: 0
  });
});

test("preview uses normalized existing words without changing them", () => {
  const bytes = encoder.encode(
    "4\tE\tＦＦ１４\t新規\n3\tN\t原神\tげんしん\n3\tN\t原神\tげんしん"
  );
  const existing = [{ word: "ff14", reading: "既存", priority: 99 }];

  const preview = studyImport.preview("ReplaceStudy.dic", bytes, existing);

  assert.deepEqual(preview, {
    ok: true,
    sourceRowCount: 3,
    candidateCount: 2,
    mergedDuplicateCount: 1,
    addedCount: 1,
    skippedCount: 1
  });
  assert.deepEqual(existing, [{ word: "ff14", reading: "既存", priority: 99 }]);
});

test("preview reports fixed errors and source line numbers", () => {
  const bytes = encoder.encode(
    "0\tX\t \t \n1\tN\tword\tfirst\n1\tN\tWORD\tsecond\ninvalid"
  );

  const preview = studyImport.preview("ReplaceStudy.dic", bytes, []);

  assert.equal(preview.ok, false);
  assert.equal(preview.sourceRowCount, 4);
  assert.deepEqual(preview.errors, [
    { code: "INVALID_SOURCE_LENGTH", line: 1 },
    { code: "INVALID_MATCH_TYPE", line: 1 },
    { code: "EMPTY_WORD", line: 1 },
    { code: "EMPTY_READING", line: 1 },
    { code: "CONFLICTING_DUPLICATE", line: 3 },
    { code: "INVALID_COLUMN_COUNT", line: 4 }
  ]);
});

test("preview rejects the wrong file name before parsing", () => {
  const preview = studyImport.preview(
    "other.dic",
    encoder.encode("1\tN\tword\treading"),
    []
  );

  assert.equal(preview.ok, false);
  assert.deepEqual(preview.errors, [{ code: "INVALID_FILE_NAME" }]);
});

test("preview rejects invalid BOM, UTF-8, and line breaks", () => {
  const cases = [
    [Buffer.from("1\tN\tword\treading\n\ufeff1\tN\tother\treading"), "INVALID_BOM"],
    [Buffer.from([0xff]), "INVALID_UTF8"],
    [encoder.encode("1\tN\tword\treading\rother"), "INVALID_LINE_BREAK"]
  ];

  for (const [bytes, code] of cases) {
    const preview = studyImport.preview("ReplaceStudy.dic", new Uint8Array(bytes), []);
    assert.equal(preview.ok, false);
    assert.deepEqual(preview.errors, [{ code }]);
  }
});

test("preview enforces file, row, line, word, and reading limits", () => {
  const cases = [
    [new Uint8Array(studyImport.MAX_FILE_BYTES + 1), "FILE_TOO_LARGE"],
    [
      encoder.encode(Array.from({ length: 10_001 }, () => "1\tN\ta\tb").join("\n")),
      "TOO_MANY_ROWS"
    ],
    [encoder.encode(`1\tN\t${"a".repeat(8192)}\tb`), "LINE_TOO_LARGE"],
    [encoder.encode(`1\tN\t${"a".repeat(1001)}\tb`), "WORD_TOO_LONG"],
    [encoder.encode(`1\tN\ta\t${"b".repeat(1001)}`), "READING_TOO_LONG"]
  ];

  for (const [bytes, code] of cases) {
    const preview = studyImport.preview("ReplaceStudy.dic", bytes, []);
    assert.equal(preview.ok, false);
    assert.equal(preview.errors[0].code, code);
  }
});

test("validate the Base64 upload body limits", () => {
  const bytes = encoder.encode("1\tN\tword\treading");
  const contentBase64 = Buffer.from(bytes).toString("base64");
  const valid = studyImport.validateUploadPayload(
    "ReplaceStudy.dic",
    bytes,
    contentBase64
  );
  assert.equal(valid.ok, true);
  assert.deepEqual(JSON.parse(valid.body), {
    fileName: "ReplaceStudy.dic",
    contentBase64
  });

  const oversized = studyImport.validateUploadPayload(
    "ReplaceStudy.dic",
    bytes,
    "A".repeat(studyImport.MAX_BASE64_LENGTH + 1)
  );
  assert.equal(oversized.ok, false);
  assert.deepEqual(oversized.errors, [{ code: "BASE64_TOO_LARGE" }]);
});
