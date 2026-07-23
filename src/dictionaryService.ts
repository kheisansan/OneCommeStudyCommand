import type {
  CommandResult,
  DictionaryEntry,
  DictionaryFile,
  EducationCommand
} from "./types";
import { normalizeDictionaryWord, normalizeForDictionaryMatch } from "./wordNormalizer";

export const DICTIONARY_VERSION = 2;
export const DEFAULT_LIST_LIMIT = 20;

export function createEmptyDictionary(): DictionaryFile {
  return {
    version: DICTIONARY_VERSION,
    entries: []
  };
}

export function calculateDefaultPriority(word: string): number {
  return Array.from(normalizeDictionaryWord(word)).length;
}

export function handleEducationCommand(
  dictionary: DictionaryFile,
  command: EducationCommand,
  options: {
    createdBy?: string;
    now?: Date;
    listLimit?: number;
  } = {}
): { dictionary: DictionaryFile; result: CommandResult } {
  switch (command.type) {
    case "invalid":
      return result(dictionary, command.message);
    case "teach":
      return teach(dictionary, command.word, command.reading, options);
    case "forget":
      return forget(dictionary, command.word);
    case "list":
      return list(dictionary, options.listLimit ?? DEFAULT_LIST_LIMIT);
    case "search":
      return search(dictionary, command.query, options.listLimit ?? DEFAULT_LIST_LIMIT);
  }
}

function teach(
  dictionary: DictionaryFile,
  word: string,
  reading: string,
  options: { createdBy?: string; now?: Date }
): { dictionary: DictionaryFile; result: CommandResult } {
  const now = (options.now ?? new Date()).toISOString();
  const normalizedWord = normalizeDictionaryWord(word);
  const entries = [...dictionary.entries];
  const existingIndex = entries.findIndex(
    (entry) => normalizeDictionaryWord(entry.word) === normalizedWord
  );

  if (existingIndex >= 0) {
    const current = entries[existingIndex];
    entries[existingIndex] = {
      ...current,
      word: normalizedWord,
      reading,
      updatedAt: now
    };

    return result(
      { ...dictionary, entries },
      `教育を更新しました: ${normalizedWord}=${reading}`,
      `${normalizedWord} は ${current.reading} から ${reading} に覚え直しました。`
    );
  }

  const entry: DictionaryEntry = {
    word: normalizedWord,
    reading,
    priority: calculateDefaultPriority(normalizedWord),
    enabled: true,
    createdBy: options.createdBy,
    createdAt: now,
    updatedAt: now
  };

  entries.push(entry);

  return result(
    { ...dictionary, entries },
    `教育しました: ${normalizedWord}=${reading}`,
    `${normalizedWord} は ${reading} を覚えました。`
  );
}

function forget(
  dictionary: DictionaryFile,
  word: string
): { dictionary: DictionaryFile; result: CommandResult } {
  const normalizedWord = normalizeDictionaryWord(word);
  const current = dictionary.entries.find(
    (entry) => normalizeDictionaryWord(entry.word) === normalizedWord
  );
  const entries = dictionary.entries.filter(
    (entry) => normalizeDictionaryWord(entry.word) !== normalizedWord
  );

  if (entries.length === dictionary.entries.length) {
    return result(dictionary, `登録がありません: ${normalizedWord}`);
  }

  return result(
    { ...dictionary, entries },
    `忘却しました: ${normalizedWord}`,
    `${current?.reading ?? normalizedWord} を忘れました。`
  );
}

function list(
  dictionary: DictionaryFile,
  limit: number
): { dictionary: DictionaryFile; result: CommandResult } {
  const entries = dictionary.entries.slice(0, limit);

  if (entries.length === 0) {
    return result(dictionary, "教育辞書は空です");
  }

  const suffix = dictionary.entries.length > limit ? ` 他${dictionary.entries.length - limit}件` : "";
  return result(dictionary, `教育一覧: ${formatEntries(entries)}${suffix}`);
}

function search(
  dictionary: DictionaryFile,
  query: string,
  limit: number
): { dictionary: DictionaryFile; result: CommandResult } {
  const normalizedQuery = normalizeForDictionaryMatch(query);
  const matches = dictionary.entries
    .filter(
      (entry) =>
        normalizeForDictionaryMatch(entry.word).includes(normalizedQuery) ||
        normalizeForDictionaryMatch(entry.reading).includes(normalizedQuery)
    )
    .slice(0, limit);

  if (matches.length === 0) {
    return result(dictionary, `検索結果はありません: ${query}`);
  }

  return result(dictionary, `教育検索: ${formatEntries(matches)}`);
}

function formatEntries(entries: DictionaryEntry[]): string {
  return entries.map((entry) => `${entry.word}=${entry.reading}`).join(", ");
}

function result(
  dictionary: DictionaryFile,
  message: string,
  speechText?: string
): { dictionary: DictionaryFile; result: CommandResult } {
  return {
    dictionary,
    result: {
      handled: true,
      message,
      speechText
    }
  };
}
