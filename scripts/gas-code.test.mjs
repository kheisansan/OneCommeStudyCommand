import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gasSource = readFileSync(path.join(__dirname, "..", "gas", "Code.gs"), "utf8");

// Code.gs のトップレベルは定数と関数宣言のみで、読み込み時にGASサービスへは
// 触れないため、空のサンドボックスで評価して純関数を回帰テストできる
function loadGasSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(gasSource, sandbox, { filename: "Code.gs" });
  return sandbox;
}

const gas = loadGasSandbox();

test("sanitizeCellValue_ neutralizes formula prefixes", () => {
  assert.equal(gas.sanitizeCellValue_("=SUM(A1:B1)"), "'=SUM(A1:B1)");
  assert.equal(gas.sanitizeCellValue_("+1+2"), "'+1+2");
  assert.equal(gas.sanitizeCellValue_("-cmd"), "'-cmd");
  assert.equal(gas.sanitizeCellValue_("@import"), "'@import");
  assert.equal(gas.sanitizeCellValue_("=IMPORTXML(\"https://x\",\"//a\")").startsWith("'"), true);
});

test("sanitizeCellValue_ keeps ordinary values unchanged", () => {
  assert.equal(gas.sanitizeCellValue_("github"), "github");
  assert.equal(gas.sanitizeCellValue_("ギットハブ"), "ギットハブ");
  assert.equal(gas.sanitizeCellValue_("a=b"), "a=b");
  assert.equal(gas.sanitizeCellValue_(""), "");
  assert.equal(gas.sanitizeCellValue_(null), "");
  assert.equal(gas.sanitizeCellValue_(123), "123");
});

test("validateSubmission_ accepts formula-like words but they stay sanitized on write", () => {
  const validated = gas.validateSubmission_({
    type: "add",
    word: "=SUM(A1)",
    reading: "サム"
  });
  assert.equal(validated.code, undefined);
  assert.equal(gas.sanitizeCellValue_(validated.word), "'=sum(a1)");
});

test("validateSubmission_ enforces types, lengths, and forbidden characters", () => {
  assert.equal(gas.validateSubmission_({ type: "bogus", word: "w", reading: "r" }).code, "INVALID_BODY");
  assert.equal(gas.validateSubmission_({ word: "", reading: "r" }).code, "INVALID_WORD");
  assert.equal(gas.validateSubmission_({ word: "w", reading: "" }).code, "INVALID_READING");
  assert.equal(
    gas.validateSubmission_({ type: "remove", word: "w", reading: "" }).code,
    undefined
  );
  assert.equal(
    gas.validateSubmission_({ word: "a\u0000b", reading: "r" }).code,
    "INVALID_WORD"
  );
  assert.equal(
    gas.validateSubmission_({ word: "あ".repeat(101), reading: "r" }).code,
    "INVALID_WORD"
  );
});

test("normalizeDictionaryWord_ matches the plugin-side normalization", () => {
  assert.equal(gas.normalizeDictionaryWord_("　ＧitＨub　"), "github");
  assert.equal(gas.normalizeDictionaryWord_("A  B\tC"), "a b c");
});

test("constantTimeEquals_ compares passwords without early exit semantics", () => {
  assert.equal(gas.constantTimeEquals_("secret-password", "secret-password"), true);
  assert.equal(gas.constantTimeEquals_("secret-password", "secret-passworD"), false);
  assert.equal(gas.constantTimeEquals_("short", "longer-value"), false);
  assert.equal(gas.constantTimeEquals_("", ""), true);
});

test("isStrongModeratorPassword_ enforces length and character classes", () => {
  assert.equal(gas.MIN_MODERATOR_PASSWORD_LENGTH, 12);
  // 12文字以上 + 英大・英小・数字・記号のうち3種類以上
  assert.equal(gas.isStrongModeratorPassword_("Abcdef123456"), true);
  assert.equal(gas.isStrongModeratorPassword_("abcdef123!@#"), true);
  assert.equal(gas.isStrongModeratorPassword_("ABCDEF-12345"), true);
  assert.equal(gas.isStrongModeratorPassword_("Ab1!"), false, "too short");
  assert.equal(gas.isStrongModeratorPassword_("abcdefghijkl"), false, "one class");
  assert.equal(gas.isStrongModeratorPassword_("abcdef123456"), false, "two classes");
  assert.equal(gas.isStrongModeratorPassword_("ABCDEFGH1234"), false, "two classes");
  assert.equal(gas.isStrongModeratorPassword_(null), false);
});

function fakeSubmissionsSheet(record) {
  const writes = {};
  return {
    writes,
    getRange(row, column, numRows, numColumns) {
      if (numRows !== undefined) {
        return { getValues: () => [record.slice(column - 1, column - 1 + numColumns)] };
      }
      return {
        getValue: () => record[column - 1],
        setValue: (value) => {
          writes[column] = value;
          record[column - 1] = value;
        }
      };
    }
  };
}

function fakeDictionarySheet() {
  const appended = [];
  return {
    appended,
    appendRow: (row) => appended.push(row)
  };
}

test("processReviewRow_ sanitizes reviewedBy and dictionary values", () => {
  const record = [
    "sub-1",
    "add",
    "=cmd",
    "=SUM(A1)",
    "@import",
    "+author",
    "token-123",
    "pending",
    "2026-08-08T00:00:00.000Z",
    "",
    ""
  ];
  const submissions = fakeSubmissionsSheet(record);
  const dictionary = fakeDictionarySheet();

  const result = gas.processReviewRow_(submissions, dictionary, 2, "approved", "=TEST");

  assert.equal(result, "reviewed");
  assert.equal(submissions.writes[gas.SUB_STATUS + 1], "approved");
  assert.equal(submissions.writes[gas.SUB_REVIEWED_BY + 1], "'=TEST");
  assert.equal(dictionary.appended.length, 1);
  const [, word, reading, category, author] = dictionary.appended[0];
  assert.equal(word, "'=cmd");
  assert.equal(reading, "'=SUM(A1)");
  assert.equal(category, "'@import");
  assert.equal(author, "'+author");
});

test("processReviewRow_ skips rows that were already reviewed", () => {
  const record = [
    "sub-1",
    "add",
    "word",
    "reading",
    "",
    "",
    "token-123",
    "approved",
    "2026-08-08T00:00:00.000Z",
    "2026-08-08T01:00:00.000Z",
    "owner"
  ];
  const submissions = fakeSubmissionsSheet(record);
  const dictionary = fakeDictionarySheet();

  assert.equal(gas.processReviewRow_(submissions, dictionary, 2, "approved", "mod"), "skipped");
  assert.equal(dictionary.appended.length, 0);
  assert.deepEqual(submissions.writes, {});
});
