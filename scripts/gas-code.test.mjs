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

test("registration guard constants require a strong password and bounded attempts", () => {
  assert.ok(gas.MIN_MODERATOR_PASSWORD_LENGTH >= 12);
  assert.ok(gas.MAX_REGISTER_FAILURES_PER_HOUR <= 20);
});
