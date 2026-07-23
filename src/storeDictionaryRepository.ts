import {
  calculateDefaultPriority,
  createEmptyDictionary,
  DICTIONARY_VERSION
} from "./dictionaryService";
import type { DictionaryEntry, DictionaryFile, StoreLike } from "./types";
import { normalizeDictionaryWord } from "./wordNormalizer";

export const DICTIONARY_STORE_KEY = "dictionary";

export class StoreDictionaryRepository {
  constructor(private readonly store: StoreLike) {}

  load(): DictionaryFile {
    const value = this.store.get(DICTIONARY_STORE_KEY);

    if (value === undefined || value === null) {
      const dictionary = createEmptyDictionary();
      this.save(dictionary);
      return dictionary;
    }

    if (isDictionaryFileV2(value)) {
      return value;
    }

    if (isDictionaryFileV1(value)) {
      const migrated = migrateDictionaryV1ToV2(value);
      if (isDictionaryFileV2(migrated)) {
        this.save(migrated);
        return migrated;
      }
    }

    console.warn("[OneCommeStudyCommand] Invalid dictionary data in store. Using empty dictionary in memory.");
    return createEmptyDictionary();
  }

  save(dictionary: DictionaryFile): void {
    this.store.set(DICTIONARY_STORE_KEY, dictionary);
  }
}

type DictionaryFileV1 = {
  version: 1;
  entries: DictionaryEntry[];
};

export function isDictionaryFileV1(value: unknown): value is DictionaryFileV1 {
  if (!isDictionaryFileVersion(value, 1, false)) return false;
  return value.entries.every(
    (entry) => normalizeDictionaryWord(entry.word).length > 0 && Number.isFinite(entry.priority)
  );
}

export function isDictionaryFileV2(value: unknown): value is DictionaryFile {
  if (!isDictionaryFileVersion(value, DICTIONARY_VERSION, true)) return false;

  const normalizedWords = value.entries.map((entry) => normalizeDictionaryWord(entry.word));
  return normalizedWords.every((word) => word.length > 0) &&
    new Set(normalizedWords).size === normalizedWords.length;
}

export function migrateDictionaryV1ToV2(dictionary: DictionaryFileV1): DictionaryFile {
  const groups = new Map<string, Array<{ entry: DictionaryEntry; index: number }>>();

  dictionary.entries.forEach((entry, index) => {
    const word = normalizeDictionaryWord(entry.word);
    const group = groups.get(word) ?? [];
    group.push({ entry, index });
    groups.set(word, group);
  });

  let duplicateCount = 0;
  const entries = [...groups.entries()].map(([word, candidates]) => {
    const selected = [...candidates].sort((left, right) => {
      if (left.entry.enabled !== right.entry.enabled) return left.entry.enabled ? -1 : 1;
      if (left.entry.priority !== right.entry.priority) {
        return right.entry.priority - left.entry.priority;
      }
      const updatedAt = left.entry.updatedAt.localeCompare(right.entry.updatedAt);
      if (updatedAt !== 0) return updatedAt;
      return left.index - right.index;
    })[0];

    duplicateCount += candidates.length - 1;
    return {
      ...selected.entry,
      word,
      priority: calculateDefaultPriority(word)
    };
  });

  if (duplicateCount > 0) {
    console.warn(
      `[OneCommeStudyCommand] dictionary migration v1 -> v2: merged ${duplicateCount} duplicate entries`
    );
  }

  return { version: DICTIONARY_VERSION, entries };
}

function isDictionaryFileVersion(
  value: unknown,
  version: 1 | 2,
  validatePriority: boolean
): value is DictionaryFileV1 | DictionaryFile {
  if (!value || typeof value !== "object") return false;

  const candidate = value as { version?: unknown; entries?: unknown };
  if (candidate.version !== version) return false;
  if (!Array.isArray(candidate.entries)) return false;

  return candidate.entries.every((entry) => {
    if (!entry || typeof entry !== "object") return false;

    const candidateEntry = entry as Record<string, unknown>;
    return (
      typeof candidateEntry.word === "string" &&
      typeof candidateEntry.reading === "string" &&
      typeof candidateEntry.priority === "number" &&
      (!validatePriority ||
        (Number.isSafeInteger(candidateEntry.priority) && candidateEntry.priority >= 1)) &&
      typeof candidateEntry.enabled === "boolean" &&
      (candidateEntry.createdBy === undefined || typeof candidateEntry.createdBy === "string") &&
      typeof candidateEntry.createdAt === "string" &&
      typeof candidateEntry.updatedAt === "string"
    );
  });
}
