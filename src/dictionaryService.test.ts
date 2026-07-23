import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDefaultPriority,
  createEmptyDictionary,
  handleEducationCommand
} from "./dictionaryService";

test("calculate default priority by normalized Unicode code points", () => {
  assert.equal(calculateDefaultPriority("  ＦＦ14  "), 4);
  assert.equal(calculateDefaultPriority("𠮷野家"), 3);
});

test("teach creates an entry and update keeps createdAt", () => {
  const created = handleEducationCommand(
    createEmptyDictionary(),
    { type: "teach", word: "FF14", reading: "えふえふじゅうよん" },
    { createdBy: "user", now: new Date("2026-07-06T00:00:00.000Z") }
  );

  assert.equal(
    created.result.speechText,
    "ff14 は えふえふじゅうよん を覚えました。"
  );

  const updated = handleEducationCommand(
    created.dictionary,
    { type: "teach", word: "FF14", reading: "えふじゅうよん" },
    { createdBy: "other", now: new Date("2026-07-07T00:00:00.000Z") }
  );

  assert.equal(updated.dictionary.entries.length, 1);
  assert.equal(updated.dictionary.entries[0].reading, "えふじゅうよん");
  assert.equal(updated.dictionary.entries[0].createdBy, "user");
  assert.equal(updated.dictionary.entries[0].createdAt, "2026-07-06T00:00:00.000Z");
  assert.equal(updated.dictionary.entries[0].updatedAt, "2026-07-07T00:00:00.000Z");
  assert.equal(updated.dictionary.entries[0].priority, 4);
  assert.equal(
    updated.result.speechText,
    "ff14 は えふえふじゅうよん から えふじゅうよん に覚え直しました。"
  );
});

test("teach and forget use normalized dictionary words", () => {
  const created = handleEducationCommand(createEmptyDictionary(), {
    type: "teach",
    word: "ＦＦＸＩＶ",
    reading: "ファイナルファンタジー"
  });

  assert.equal(created.dictionary.entries[0].word, "ffxiv");

  const updated = handleEducationCommand(created.dictionary, {
    type: "teach",
    word: "FFxiv",
    reading: "えふえふ"
  });
  assert.equal(updated.dictionary.entries.length, 1);
  assert.equal(updated.dictionary.entries[0].word, "ffxiv");
  assert.equal(updated.dictionary.entries[0].reading, "えふえふ");

  const removed = handleEducationCommand(updated.dictionary, {
    type: "forget",
    word: "ＦＦｘｉｖ"
  });
  assert.equal(removed.dictionary.entries.length, 0);
});

test("teach stores repeated whitespace as a single space", () => {
  const created = handleEducationCommand(
    createEmptyDictionary(),
    { type: "teach", word: "  Tember　　Hashiru\tHashiru  ", reading: "空也上人" }
  );

  assert.equal(created.dictionary.entries[0].word, "tember hashiru hashiru");
  assert.equal(
    created.result.speechText,
    "tember hashiru hashiru は 空也上人 を覚えました。"
  );
});

test("forget removes existing entry and reports missing entry", () => {
  const dictionary = handleEducationCommand(
    createEmptyDictionary(),
    { type: "teach", word: "FF14", reading: "えふえふじゅうよん" }
  ).dictionary;

  const removed = handleEducationCommand(dictionary, {
    type: "forget",
    word: "FF14"
  });

  assert.equal(removed.dictionary.entries.length, 0);
  assert.equal(removed.result.speechText, "えふえふじゅうよん を忘れました。");

  const missing = handleEducationCommand(removed.dictionary, {
    type: "forget",
    word: "FF14"
  });

  assert.match(missing.result.message, /登録がありません/);
  assert.equal(missing.result.speechText, undefined);
});
