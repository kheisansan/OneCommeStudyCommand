import test from "node:test";
import assert from "node:assert/strict";
import { StoreDictionaryRepository, DICTIONARY_STORE_KEY } from "./storeDictionaryRepository";
import type { StoreLike } from "./types";

test("initialize empty dictionary when store has no value", () => {
  const store = new MemoryStore();
  const repository = new StoreDictionaryRepository(store);

  const dictionary = repository.load();

  assert.deepEqual(dictionary, { version: 2, entries: [] });
  assert.deepEqual(store.get(DICTIONARY_STORE_KEY), dictionary);
});

test("use empty in-memory dictionary without overwriting invalid store value", () => {
  const store = new MemoryStore();
  store.set(DICTIONARY_STORE_KEY, { broken: true });

  const repository = new StoreDictionaryRepository(store);
  const dictionary = repository.load();

  assert.deepEqual(dictionary, { version: 2, entries: [] });
  assert.deepEqual(store.get(DICTIONARY_STORE_KEY), { broken: true });
});

test("migrate a valid version 1 dictionary once without mutating the source", () => {
  const store = new MemoryStore();
  const source = {
    version: 1,
    entries: [entry("古狸", 100), entry("𠮷野家", 100)]
  };
  const snapshot = structuredClone(source);
  store.set(DICTIONARY_STORE_KEY, source);
  const repository = new StoreDictionaryRepository(store);

  const dictionary = repository.load();

  assert.deepEqual(source, snapshot);
  assert.equal(dictionary.version, 2);
  assert.deepEqual(dictionary.entries.map(({ word, priority }) => ({ word, priority })), [
    { word: "古狸", priority: 2 },
    { word: "𠮷野家", priority: 3 }
  ]);
  assert.equal(store.setCalls, 2);
  assert.equal(repository.load(), dictionary);
  assert.equal(store.setCalls, 2);
});

test("merge normalized version 1 duplicates deterministically", () => {
  const store = new MemoryStore();
  store.set(DICTIONARY_STORE_KEY, {
    version: 1,
    entries: [
      { ...entry("ＦＦ１４", 500), reading: "無効", enabled: false },
      { ...entry("ff14", 10), reading: "古い", updatedAt: "2026-07-01T00:00:00.000Z" },
      { ...entry("FF14", 20), reading: "残す", updatedAt: "2026-07-02T00:00:00.000Z" }
    ]
  });
  const repository = new StoreDictionaryRepository(store);

  const dictionary = repository.load();

  assert.equal(dictionary.entries.length, 1);
  assert.equal(dictionary.entries[0].word, "ff14");
  assert.equal(dictionary.entries[0].reading, "残す");
  assert.equal(dictionary.entries[0].priority, 4);
});

test("do not overwrite invalid version 1 or version 2 dictionaries", () => {
  for (const value of [
    { version: 1, entries: [entry("", 100)] },
    { version: 2, entries: [entry("word", 0)] },
    { version: 2, entries: [entry("FF14", 4), entry("ｆｆ１４", 4)] },
    { version: 99, entries: [] }
  ]) {
    const store = new MemoryStore();
    store.set(DICTIONARY_STORE_KEY, value);
    const repository = new StoreDictionaryRepository(store);

    assert.deepEqual(repository.load(), { version: 2, entries: [] });
    assert.equal(store.get(DICTIONARY_STORE_KEY), value);
    assert.equal(store.setCalls, 1);
  }
});

function entry(word: string, priority: number) {
  return {
    word,
    reading: "よみ",
    priority,
    enabled: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  };
}

class MemoryStore implements StoreLike {
  private readonly data = new Map<string, unknown>();
  setCalls = 0;

  get(key: string, defaultValue?: unknown): unknown {
    return this.data.has(key) ? this.data.get(key) : defaultValue;
  }

  set(key: string, value: unknown): void {
    this.setCalls += 1;
    this.data.set(key, value);
  }
}
