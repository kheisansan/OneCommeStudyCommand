import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDictionary,
  applyDictionaryWithMaskedFallback,
  getMatchingDictionaryWords
} from "./replacer";
import type { DictionaryEntry } from "./types";

test("replace longer words before shorter words", () => {
  const entries: DictionaryEntry[] = [
    entry("極", "ごく"),
    entry("極タイタン", "ごくたいたん")
  ];

  assert.equal(applyDictionary("極タイタンに行きます", entries), "ごくたいたんに行きます");
});

test("replace higher priority first when word length is same", () => {
  const entries: DictionaryEntry[] = [
    entry("ABC", "low", 100),
    entry("ABC", "high", 200)
  ];

  assert.equal(applyDictionary("ABC", entries), "high");
});

test("replace higher priority before a longer word", () => {
  const entries: DictionaryEntry[] = [
    entry("古", "いにしえ", 10),
    entry("古狸", "ふるだぬき", 2)
  ];

  assert.equal(applyDictionary("古狸", entries), "いにしえ狸");
});

test("replace longer word first when priority is equal", () => {
  const entries: DictionaryEntry[] = [
    entry("古", "こ", 2),
    entry("古狸", "ふるだぬき", 2)
  ];

  assert.equal(applyDictionary("古狸", entries), "ふるだぬき");
});

test("ignore disabled entries", () => {
  assert.equal(applyDictionary("FF14", [entry("FF14", "えふえふ", 100, false)]), "FF14");
});

test("replace case and width variants with normalized dictionary words", () => {
  const entries = [
    entry("FFXIV", "えふえふ"),
    entry("カタカナ", "かな"),
    entry("1", "いち")
  ];

  assert.equal(
    applyDictionary("ffxiv・ＦＦｘｉｖ・ｶﾀｶﾅ・①", entries),
    "えふえふ・えふえふ・かな・いち"
  );
});

test("replace dictionary words across repeated and mixed whitespace", () => {
  const entries = [entry("tember   hashiru\thashiru", "空也上人")];

  assert.equal(
    applyDictionary("tember hashiru hashiru", entries),
    "空也上人"
  );
  assert.equal(
    applyDictionary("tember　　hashiru\thashiru", entries),
    "空也上人"
  );
});

test("list normalized matching words and ignore disabled entries", () => {
  const entries = [
    entry("FFXIV", "えふえふ"),
    entry("(＾ω＾≡＾ω＾)", "マルコ"),
    entry("disabled", "無効", 100, false)
  ];

  assert.deepEqual(
    getMatchingDictionaryWords("(＾ω＾≡＾ω＾)ｆｆｘｉｖdisabled", entries),
    ["(^ω^≡^ω^)", "ffxiv"]
  );
});

test("replace masked face while preserving OneComme URL processing", () => {
  const entries = [entry("(＾ω＾≡＾ω＾)", "マルコ")];

  assert.equal(
    applyDictionaryWithMaskedFallback(
      "(*******)URL",
      "(＾ω＾≡＾ω＾)https://example.com/test",
      entries
    ),
    "マルコURL"
  );
});

test("preserve OneComme URL token before a masked face", () => {
  const entries = [entry("(＾ω＾≡＾ω＾)", "マルコ")];

  assert.equal(
    applyDictionaryWithMaskedFallback(
      "URL(*******)",
      "https://example.com/test(＾ω＾≡＾ω＾)",
      entries
    ),
    "URLマルコ"
  );
});

test("preserve unmatched letter casing", () => {
  const entries = [entry("FFXIV", "えふえふ")];

  assert.equal(applyDictionary("URL-FFxiv-ABC", entries), "URL-えふえふ-ABC");
});

test("replace masked face with surrounding exact dictionary words", () => {
  const entries = [
    entry("(＾ω＾≡＾ω＾)", "マルコ"),
    entry("FFXIV", "えふえふ")
  ];

  assert.equal(
    applyDictionaryWithMaskedFallback(
      "FFXIV(*******)ffxiv",
      "FFXIV(＾ω＾≡＾ω＾)ffxiv",
      entries
    ),
    "えふえふマルコえふえふ"
  );
});

test("do not replace unrelated, different-length, or different-structure masks", () => {
  const entries = [entry("(＾ω＾≡＾ω＾)", "マルコ")];

  assert.equal(
    applyDictionaryWithMaskedFallback("(*******)", "別のコメント", entries),
    "(*******)"
  );
  assert.equal(
    applyDictionaryWithMaskedFallback("(******)", "(＾ω＾≡＾ω＾)", entries),
    "(******)"
  );
  assert.equal(
    applyDictionaryWithMaskedFallback("[*******]", "(＾ω＾≡＾ω＾)", entries),
    "[*******]"
  );
  assert.equal(
    applyDictionaryWithMaskedFallback(
      "(*******)",
      "(＾ω＾≡＾ω＾)",
      [entry("(＾ω＾≡＾ω＾)", "マルコ", 100, false)]
    ),
    "(*******)"
  );
});

function entry(
  word: string,
  reading: string,
  priority = 100,
  enabled = true
): DictionaryEntry {
  return {
    word,
    reading,
    priority,
    enabled,
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z"
  };
}
