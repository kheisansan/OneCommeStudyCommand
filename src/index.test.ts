import test from "node:test";
import assert from "node:assert/strict";
import type { DictionaryFile, StoreLike } from "./types";
import { MAX_STUDY_DICTIONARY_BODY_LENGTH } from "./studyDictionaryImport";

const plugin = require("./index");

test("expose the owned-domain plugin identity and management URL", () => {
  assert.equal(plugin.uid, "games.tang-chao.study-command");
  assert.equal(
    plugin.url,
    "http://localhost:11180/plugins/games.tang-chao.study-command/index.html"
  );
});

test("teach command updates speechText while keeping comment text", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  const filteredComment = plugin.filterComment(
    {
      data: {
        comment: "教育(FF14=えふえふじゅうよん)",
        speechText: "教育(FF14=えふえふじゅうよん)"
      }
    },
    null,
    { name: "user" }
  );

  assert.notEqual(filteredComment, false);

  assert.equal(filteredComment.data?.comment, "教育(FF14=えふえふじゅうよん)");
  assert.equal(filteredComment.data?.speechText, "ff14 は えふえふじゅうよん を覚えました。");
  assert.equal(
    plugin.filterSpeech("教育(FF14=えふえふじゅうよん)", null, null, filteredComment),
    "ff14 は えふえふじゅうよん を覚えました。"
  );

  assert.equal(plugin.filterSpeech("FF14に行きます"), "えふえふじゅうよんに行きます");
  plugin.destroy();
});

test("teach command uses OneComme speech text instead of Twitch emote HTML", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  const emoteHtml =
    '<img src="https://static-cdn.jtvnw.net/emoticons/v2/tember/default/light/1.0" alt="tangch4Tember" class="emote">' +
    ' <img src="https://static-cdn.jtvnw.net/emoticons/v2/hashiru/default/light/1.0" alt="tangch4Hashiru" class="emote">' +
    ' <img src="https://static-cdn.jtvnw.net/emoticons/v2/hashiru/default/light/1.0" alt="tangch4Hashiru" class="emote">';

  const filteredComment = plugin.filterComment(
    {
      data: {
        comment: `教育(${emoteHtml} = 空也上人)`,
        speechText: "教育( Tember Hashiru Hashiru = 空也上人)"
      }
    },
    null,
    { name: "user" }
  );

  assert.notEqual(filteredComment, false);
  assert.equal(
    filteredComment.data?.comment,
    `教育(${emoteHtml} = 空也上人)`
  );
  assert.equal(
    filteredComment.data?.speechText,
    "tember hashiru hashiru は 空也上人 を覚えました。"
  );

  const response = plugin.request({ method: "GET" });
  assert.equal(response.response.dictionary.entries.length, 1);
  assert.equal(response.response.dictionary.entries[0].word, "tember hashiru hashiru");
  assert.equal(response.response.dictionary.entries[0].reading, "空也上人");
  plugin.destroy();
});

test("forget command updates speechText with removed reading", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  plugin.filterComment(
    {
      data: {
        comment: "教育(FF14=えふえふじゅうよん)",
        speechText: "教育(FF14=えふえふじゅうよん)"
      }
    },
    null,
    { name: "user" }
  );

  const filteredComment = plugin.filterComment(
    {
      data: {
        comment: "忘却(FF14)",
        speechText: "忘却(FF14)"
      }
    },
    null,
    { name: "user" }
  );

  assert.notEqual(filteredComment, false);
  assert.equal(filteredComment.data?.comment, "忘却(FF14)");
  assert.equal(filteredComment.data?.speechText, "えふえふじゅうよん を忘れました。");
  plugin.destroy();
});

test("forget command uses OneComme speech text instead of Twitch emote HTML", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  plugin.request({
    method: "PUT",
    body: { word: "tember hashiru hashiru", reading: "空也上人" }
  });
  const emoteHtml =
    '<img src="https://static-cdn.jtvnw.net/emoticons/v2/tember/default/light/1.0" alt="tangch4Tember" class="emote">' +
    ' <img src="https://static-cdn.jtvnw.net/emoticons/v2/hashiru/default/light/1.0" alt="tangch4Hashiru" class="emote">' +
    ' <img src="https://static-cdn.jtvnw.net/emoticons/v2/hashiru/default/light/1.0" alt="tangch4Hashiru" class="emote">';

  const filteredComment = plugin.filterComment(
    {
      data: {
        comment: `忘却(${emoteHtml})`,
        speechText: "忘却( Tember   Hashiru Hashiru )"
      }
    },
    null,
    { name: "user" }
  );

  assert.notEqual(filteredComment, false);
  assert.equal(filteredComment.data?.comment, `忘却(${emoteHtml})`);
  assert.equal(filteredComment.data?.speechText, "空也上人 を忘れました。");
  assert.equal(plugin.request({ method: "GET" }).response.dictionary.entries.length, 0);
  plugin.destroy();
});

test("filterSpeech keeps a forget command word before filterComment handles it", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  plugin.request({
    method: "PUT",
    body: { word: "tember hashiru hashiru", reading: "空也上人" }
  });
  const comment = {
    data: {
      comment: "忘却(<img alt=\"tangch4Tember\"> <img alt=\"tangch4Hashiru\"> <img alt=\"tangch4Hashiru\">)",
      speechText: undefined as string | undefined
    }
  };
  const processedSpeechText = "忘却( Tember Hashiru Hashiru )";

  comment.data.speechText = plugin.filterSpeech(
    processedSpeechText,
    null,
    null,
    comment
  );
  assert.equal(comment.data.speechText, processedSpeechText);

  const filteredComment = plugin.filterComment(comment, null, { name: "user" });
  assert.notEqual(filteredComment, false);
  assert.equal(filteredComment.data?.speechText, "空也上人 を忘れました。");
  assert.equal(plugin.request({ method: "GET" }).response.dictionary.entries.length, 0);
  plugin.destroy();
});

test("filterSpeech keeps a teach command word while replacing normal comments", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  plugin.request({
    method: "PUT",
    body: { word: "tember hashiru hashiru", reading: "空也上人" }
  });

  assert.equal(
    plugin.filterSpeech("教育( Tember Hashiru Hashiru = 新しい読み )"),
    "教育( Tember Hashiru Hashiru = 新しい読み )"
  );
  assert.equal(
    plugin.filterSpeech("Tember Hashiru Hashiru"),
    "空也上人"
  );
  plugin.destroy();
});

test("explicit comment speechText remains unchanged", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  plugin.filterComment(
    {
      data: {
        comment: "教育((＾ω＾≡＾ω＾)=マルコ)",
        speechText: "教育((＾ω＾≡＾ω＾)=マルコ)"
      }
    },
    null,
    null
  );

  const comment = {
    data: {
      comment: "(＾ω＾≡＾ω＾)",
      speechText: "(＾ω＾≡＾ω＾)"
    }
  };

  assert.equal(
    plugin.filterSpeech(comment.data.speechText, null, null, comment),
    "(＾ω＾≡＾ω＾)"
  );
  assert.equal(plugin.filterSpeech(comment.data.speechText), "マルコ");
  plugin.destroy();
});

test("filterSpeech replaces a masked face while preserving OneComme URL processing", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  plugin.filterComment(
    {
      data: {
        comment: "教育((＾ω＾≡＾ω＾)=マルコ)",
        speechText: "教育((＾ω＾≡＾ω＾)=マルコ)"
      }
    },
    null,
    null
  );

  const comment = {
    data: {
      comment: "(＾ω＾≡＾ω＾)https://example.com/test" as string,
      speechText: undefined as string | undefined
    }
  };
  assert.equal(comment.data.speechText, undefined);
  assert.equal(
    plugin.filterSpeech("(*******)URL", null, null, comment),
    "マルコURL"
  );
  plugin.destroy();
});

test("filterSpeech replaces masked and unmasked dictionary words independently", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  plugin.request({
    method: "PUT",
    body: { word: "(＾ω＾≡＾ω＾)", reading: "マルコ" }
  });
  plugin.request({
    method: "PUT",
    body: { word: "FFXIV", reading: "えふえふ" }
  });

  assert.equal(
    plugin.filterSpeech("(*******)FFXIV", null, null, {
      data: {
        comment: "(＾ω＾≡＾ω＾)FFXIV"
      }
    }),
    "マルコえふえふ"
  );

  assert.equal(
    plugin.filterSpeech("FFXIVのみ", null, null, {
      data: {
        comment: "FFXIVのみ"
      }
    }),
    "えふえふのみ"
  );
  plugin.destroy();
});

test("management API returns settings and dictionary", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  plugin.filterComment(
    {
      data: {
        comment: "教育(FF14=えふえふじゅうよん)",
        speechText: "教育(FF14=えふえふじゅうよん)"
      }
    },
    null,
    { name: "user" }
  );

  const response = plugin.request({
    method: "GET"
  });

  assert.equal(response.code, 200);
  assert.deepEqual(response.response.settings, {
    educationCommandEnabled: true,
    forgetCommandEnabled: true,
    sharedEducationCommandEnabled: true,
    sharedForgetCommandEnabled: true
  });
  assert.equal(response.response.dictionary.version, 2);
  assert.equal(response.response.dictionary.entries.length, 1);
  assert.equal(response.response.dictionary.entries[0].word, "ff14");
  assert.equal(response.response.dictionary.entries[0].reading, "えふえふじゅうよん");
  plugin.destroy();
});

test("management API returns 404 for unsupported methods", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  const response = plugin.request({
    method: "POST"
  });

  assert.equal(response.code, 404);
  assert.deepEqual(response.response, {});
  plugin.destroy();
});

test("management API updates settings only", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  const response = plugin.request({
    method: "PUT",
    body: {
      settings: {
        educationCommandEnabled: false,
        forgetCommandEnabled: true
      },
    }
  });

  assert.equal(response.code, 200);
  assert.deepEqual(store.get("settings"), {
    educationCommandEnabled: false,
    forgetCommandEnabled: true,
    sharedEducationCommandEnabled: true,
    sharedForgetCommandEnabled: true
  });
  assert.deepEqual(store.get("dictionary"), {
    version: 2,
    entries: []
  });
  plugin.destroy();
});

test("management API accepts JSON string body and complements missing settings", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  const response = plugin.request({
    method: "PUT",
    body: JSON.stringify({
      settings: {
        educationCommandEnabled: false
      }
    })
  });

  assert.equal(response.code, 200);
  assert.deepEqual(store.get("settings"), {
    educationCommandEnabled: false,
    forgetCommandEnabled: true,
    sharedEducationCommandEnabled: true,
    sharedForgetCommandEnabled: true
  });
  plugin.destroy();
});

test("management API rejects invalid settings", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  const response = plugin.request({
    method: "PUT",
    body: {
      settings: {
        educationCommandEnabled: "false",
        forgetCommandEnabled: true
      }
    }
  });

  assert.equal(response.code, 400);
  assert.deepEqual(store.get("settings"), undefined);
  plugin.destroy();
});

test("disabled teach command is handled as a normal comment", () => {
  const store = new MemoryStore();
  store.set("settings", {
    educationCommandEnabled: false,
    forgetCommandEnabled: true
  });
  plugin.init({ dir: "", store });

  const comment = {
    data: {
      comment: "教育(FF14=えふえふじゅうよん)",
      speechText: "教育(FF14=えふえふじゅうよん)"
    }
  };
  const filteredComment = plugin.filterComment(comment, null, { name: "user" });

  assert.equal(filteredComment, comment);
  assert.deepEqual(store.get("dictionary"), {
    version: 2,
    entries: []
  });
  plugin.destroy();
});

test("disabled forget command is handled as a normal comment", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  plugin.filterComment(
    {
      data: {
        comment: "教育(FF14=えふえふじゅうよん)",
        speechText: "教育(FF14=えふえふじゅうよん)"
      }
    },
    null,
    { name: "user" }
  );

  plugin.request({
    method: "PUT",
    body: {
      settings: {
        educationCommandEnabled: true,
        forgetCommandEnabled: false
      }
    }
  });

  const comment = {
    data: {
      comment: "忘却(FF14)",
      speechText: "忘却(FF14)"
    }
  };
  const filteredComment = plugin.filterComment(comment, null, { name: "user" });

  const dictionary = store.get("dictionary") as DictionaryFile;
  assert.equal(filteredComment, comment);
  assert.equal(dictionary.entries.length, 1);
  plugin.destroy();
});

test("management API deletes entry", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  plugin.filterComment(
    {
      data: {
        comment: "教育(FF14=えふえふじゅうよん)",
        speechText: "教育(FF14=えふえふじゅうよん)"
      }
    },
    null,
    { name: "user" }
  );

  const response = plugin.request({
    method: "DELETE",
    body: {
      word: "FF14"
    }
  });

  assert.equal(response.code, 200);
  assert.equal(response.response.dictionary.entries.length, 0);
  assert.equal((store.get("dictionary") as DictionaryFile).entries.length, 0);
  plugin.destroy();
});

test("management API creates entry with defaults", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  const response = plugin.request({
    method: "PUT",
    body: JSON.stringify({
      word: "  FF14  ",
      reading: "  えふえふじゅうよん  "
    })
  });

  assert.equal(response.code, 200);
  const entry = response.response.dictionary.entries[0];
  assert.equal(entry.word, "ff14");
  assert.equal(entry.reading, "えふえふじゅうよん");
  assert.equal(entry.priority, 4);
  assert.equal(entry.enabled, true);
  assert.equal(entry.createdBy, undefined);
  assert.equal((store.get("dictionary") as DictionaryFile).entries.length, 1);
  plugin.destroy();
});

test("management API rejects invalid and duplicate entry create", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  assert.equal(
    plugin.request({
      method: "PUT",
      body: { word: " ", reading: "よみ" }
    }).code,
    400
  );
  assert.equal(
    plugin.request({
      method: "PUT",
      body: { word: "単語", reading: " " }
    }).code,
    400
  );
  assert.equal(
    plugin.request({
      method: "PUT",
      body: { word: "単語", reading: "よみ" }
    }).code,
    200
  );
  assert.equal(
    plugin.request({
      method: "PUT",
      body: { word: "単語", reading: "別の読み" }
    }).code,
    409
  );
  assert.equal((store.get("dictionary") as DictionaryFile).entries[0].reading, "よみ");
  plugin.destroy();
});

test("management API normalizes entry create, duplicate, and delete words", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  const created = plugin.request({
    method: "PUT",
    body: { word: "ＦＦＸＩＶ", reading: "えふえふ" }
  });
  assert.equal(created.code, 200);
  assert.equal(created.response.dictionary.entries[0].word, "ffxiv");

  assert.equal(
    plugin.request({ method: "PUT", body: { word: "FFxiv", reading: "別の読み" } }).code,
    409
  );
  assert.equal(plugin.request({ method: "DELETE", body: { word: "ｆｆｘｉｖ" } }).code, 200);
  assert.equal((store.get("dictionary") as DictionaryFile).entries.length, 0);
  plugin.destroy();
});

test("management API rejects mixed and unknown PUT bodies", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  assert.equal(
    plugin.request({
      method: "PUT",
      body: {
        settings: { educationCommandEnabled: true },
        word: "単語",
        reading: "よみ"
      }
    }).code,
    400
  );
  assert.equal(plugin.request({ method: "PUT", body: { unknown: true } }).code, 400);
  assert.equal(
    plugin.request({
      method: "PUT",
      body: { settings: { educationCommandEnabled: true }, unknown: true }
    }).code,
    400
  );
  assert.equal(store.get("settings"), undefined);
  assert.deepEqual(store.get("dictionary"), { version: 2, entries: [] });
  plugin.destroy();
});

test("management API imports a study dictionary in one save", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  plugin.request({ method: "PUT", body: { word: "FF14", reading: "既存" } });
  const setCalls = store.setCalls;
  const content = "4\tE\tＦＦ１４\t新規\r\n2\tN\t原神\tげんしん\r\n";

  const response = plugin.request({
    method: "PUT",
    body: {
      fileName: "ReplaceStudy.dic",
      contentBase64: Buffer.from(content).toString("base64")
    }
  });

  assert.equal(response.code, 200);
  assert.deepEqual(response.response.importResult, {
    sourceRowCount: 2,
    candidateCount: 2,
    mergedDuplicateCount: 0,
    addedCount: 1,
    skippedCount: 1
  });
  assert.equal(response.response.dictionary.entries.length, 2);
  assert.equal(response.response.dictionary.entries[0].reading, "既存");
  assert.equal(response.response.dictionary.entries[1].word, "原神");
  assert.equal(store.setCalls, setCalls + 1);
  plugin.destroy();
});

test("management API rejects invalid study dictionary requests without saving", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  const before = structuredClone(store.get("dictionary"));
  const setCalls = store.setCalls;

  const invalidName = plugin.request({
    method: "PUT",
    body: {
      fileName: "other.dic",
      contentBase64: Buffer.from("1\tN\tword\treading").toString("base64")
    }
  });
  assert.equal(invalidName.code, 400);
  assert.equal(invalidName.response.errors[0].code, "INVALID_FILE_NAME");

  const invalidContent = plugin.request({
    method: "PUT",
    body: {
      fileName: "ReplaceStudy.dic",
      contentBase64: Buffer.from("1\tN\tword").toString("base64")
    }
  });
  assert.equal(invalidContent.code, 400);
  assert.equal(invalidContent.response.errors[0].code, "INVALID_COLUMN_COUNT");

  const mixedBody = plugin.request({
    method: "PUT",
    body: {
      fileName: "ReplaceStudy.dic",
      contentBase64: Buffer.from("1\tN\tword\treading").toString("base64"),
      unknown: true
    }
  });
  assert.equal(mixedBody.code, 400);
  assert.equal(mixedBody.response.errors[0].code, "INVALID_BODY");
  assert.deepEqual(store.get("dictionary"), before);
  assert.equal(store.setCalls, setCalls);
  plugin.destroy();
});

test("management API rejects oversized string bodies before JSON parsing", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  const response = plugin.request({
    method: "PUT",
    body: "x".repeat(MAX_STUDY_DICTIONARY_BODY_LENGTH + 1)
  });

  assert.equal(response.code, 400);
  assert.equal(response.response.errors[0].code, "BODY_TOO_LARGE");
  assert.equal(store.setCalls, 1);
  plugin.destroy();
});

test("management API keeps memory and stored dictionaries when import persistence fails", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  const before = structuredClone(store.get("dictionary"));
  store.failDictionarySave = true;

  const response = plugin.request({
    method: "PUT",
    body: {
      fileName: "ReplaceStudy.dic",
      contentBase64: Buffer.from("1\tN\tword\treading").toString("base64")
    }
  });

  assert.equal(response.code, 500);
  assert.deepEqual(response.response, { message: "Failed to save study dictionary" });
  assert.deepEqual(store.get("dictionary"), before);
  assert.deepEqual(plugin.request({ method: "GET" }).response.dictionary, before);
  plugin.destroy();
});

test("management API updates entry priority and updatedAt", () => {
  const store = new MemoryStore();
  store.set("dictionary", {
    version: 2,
    entries: [
      {
        word: "ff14",
        reading: "よみ",
        priority: 4,
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  });
  plugin.init({ dir: "", store });
  const before = (store.get("dictionary") as DictionaryFile).entries[0];

  const response = plugin.request({
    method: "PUT",
    body: { word: "FF14", priority: 10 }
  });

  assert.equal(response.code, 200);
  assert.equal(response.response.dictionary.entries[0].priority, 10);
  assert.notEqual(response.response.dictionary.entries[0].updatedAt, before.updatedAt);
  assert.equal((store.get("dictionary") as DictionaryFile).entries[0].priority, 10);
  plugin.destroy();
});

test("management API does not save an equal priority update", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  plugin.request({ method: "PUT", body: { word: "FF14", reading: "よみ" } });
  const before = structuredClone(store.get("dictionary"));
  const setCalls = store.setCalls;

  const response = plugin.request({
    method: "PUT",
    body: { word: "FF14", priority: 4 }
  });

  assert.equal(response.code, 200);
  assert.deepEqual(store.get("dictionary"), before);
  assert.equal(store.setCalls, setCalls);
  plugin.destroy();
});

test("management API rejects invalid priority updates", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });
  plugin.request({ method: "PUT", body: { word: "FF14", reading: "よみ" } });

  for (const priority of [0, -1, 1.5, "10", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(plugin.request({ method: "PUT", body: { word: "FF14", priority } }).code, 400);
  }
  assert.equal(
    plugin.request({ method: "PUT", body: { word: "FF14", reading: "よみ", priority: 10 } }).code,
    400
  );
  assert.equal(plugin.request({ method: "PUT", body: { word: "missing", priority: 10 } }).code, 404);
  plugin.destroy();
});

test("management API rejects invalid entry delete", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  assert.equal(plugin.request({ method: "DELETE", body: { word: "" } }).code, 400);
  plugin.destroy();
});

test("management API returns 404 for missing entry delete", () => {
  const store = new MemoryStore();
  plugin.init({ dir: "", store });

  assert.equal(plugin.request({ method: "DELETE", body: { word: "FF14" } }).code, 404);
  plugin.destroy();
});

class MemoryStore implements StoreLike {
  private readonly data = new Map<string, unknown>();
  setCalls = 0;
  failDictionarySave = false;

  get(key: string, defaultValue?: unknown): unknown {
    return this.data.has(key) ? this.data.get(key) : defaultValue;
  }

  set(key: string, value: unknown): void {
    this.setCalls += 1;
    if (key === "dictionary" && this.failDictionarySave) {
      throw new Error("dictionary save failed");
    }
    this.data.set(key, value);
  }
}
