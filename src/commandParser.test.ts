import test from "node:test";
import assert from "node:assert/strict";
import { parseEducationCommand } from "./commandParser";

test("parse teach command and split at the first equals sign", () => {
  assert.deepEqual(parseEducationCommand("教育( FF14 = えふ=えふ )"), {
    type: "teach",
    word: "FF14",
    reading: "えふ=えふ"
  });

  assert.deepEqual(parseEducationCommand("教育（ ＦＦＸＩＶ ＝ 読み=そのまま )"), {
    type: "teach",
    word: "ＦＦＸＩＶ",
    reading: "読み=そのまま"
  });
});

test("parse forget, list, and search commands", () => {
  assert.deepEqual(parseEducationCommand("忘却( FF14 )"), {
    type: "forget",
    word: "FF14"
  });

  assert.deepEqual(parseEducationCommand("忘却（ ＦＦＸＩＶ )"), {
    type: "forget",
    word: "ＦＦＸＩＶ"
  });

  assert.deepEqual(parseEducationCommand("教育一覧"), {
    type: "list"
  });

  assert.deepEqual(parseEducationCommand("教育検索(えふ)"), {
    type: "search",
    query: "えふ"
  });
});

test("return null for normal comments", () => {
  assert.equal(parseEducationCommand("FF14に行きます"), null);
});
