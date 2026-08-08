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

test("parse shared teach and shared forget commands", () => {
  assert.deepEqual(parseEducationCommand("共有教育( FF14 = えふえふじゅうよん )"), {
    type: "sharedTeach",
    word: "FF14",
    reading: "えふえふじゅうよん"
  });

  assert.deepEqual(parseEducationCommand("共有教育（ＦＦＸＩＶ＝えふえふじゅうよん）"), {
    type: "sharedTeach",
    word: "ＦＦＸＩＶ",
    reading: "えふえふじゅうよん"
  });

  assert.deepEqual(parseEducationCommand("共有忘却( FF14 )"), {
    type: "sharedForget",
    word: "FF14"
  });

  assert.deepEqual(parseEducationCommand("共有忘却（ＦＦ１４）"), {
    type: "sharedForget",
    word: "ＦＦ１４"
  });
});

test("shared commands report invalid bodies", () => {
  assert.deepEqual(parseEducationCommand("共有教育(FF14)"), {
    type: "invalid",
    message: "教育コマンドには = が必要です"
  });
  assert.deepEqual(parseEducationCommand("共有忘却( )"), {
    type: "invalid",
    message: "忘却する単語が空です"
  });
});

test("parse shared approve and shared reject commands", () => {
  assert.deepEqual(parseEducationCommand("共有承認( GitHub )"), {
    type: "sharedApprove",
    word: "GitHub"
  });
  assert.deepEqual(parseEducationCommand("共有却下（ＧitＨub）"), {
    type: "sharedReject",
    word: "ＧitＨub"
  });
  assert.deepEqual(parseEducationCommand("共有承認()"), {
    type: "invalid",
    message: "承認する単語が空です"
  });
  assert.deepEqual(parseEducationCommand("共有却下( )"), {
    type: "invalid",
    message: "却下する単語が空です"
  });
});
