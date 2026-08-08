import { calculateDefaultPriority } from "./dictionaryService";
import type { DictionaryEntry, DictionaryFile } from "./types";
import { normalizeDictionaryWord } from "./wordNormalizer";

export const MAX_SHARED_WORD_CODE_POINTS = 100;
export const MAX_SHARED_READING_CODE_POINTS = 200;
export const MAX_SHARED_CATEGORY_CODE_POINTS = 50;
export const MAX_SHARED_AUTHOR_CODE_POINTS = 50;
export const MAX_SHARED_ENTRY_COUNT = 10_000;
export const MAX_SHARED_SUBMISSION_RECORDS = 50;
export const SHARED_DICTIONARY_DEFAULT_AUTHOR = "共有辞書";

// 制御文字と不可視の書字方向制御文字。GAS側 (gas/Code.gs) と同じ定義を使う。
export const SHARED_FORBIDDEN_CHARACTERS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;

export type SharedDictionaryEntry = {
  id: string;
  word: string;
  reading: string;
  category: string;
  author: string;
  updatedAt: string;
};

export type SharedDictionaryCache = {
  version: number;
  entries: SharedDictionaryEntry[];
  fetchedAt: string;
};

export type SharedDictionarySettings = {
  endpointUrl: string | null;
};

export type SharedSubmissionStatus = "pending" | "approved" | "rejected";

export type SharedSubmissionType = "add" | "remove";

export type SharedSubmissionRecord = {
  submissionId: string;
  type: SharedSubmissionType;
  word: string;
  reading: string;
  category: string;
  status: SharedSubmissionStatus;
  submittedAt: string;
};

export type SharedSubmissionErrorCode =
  | "EMPTY_WORD"
  | "WORD_TOO_LONG"
  | "EMPTY_READING"
  | "READING_TOO_LONG"
  | "CATEGORY_TOO_LONG"
  | "AUTHOR_TOO_LONG"
  | "FORBIDDEN_CHARACTER";

export type SharedSubmissionInput = {
  type: SharedSubmissionType;
  word: string;
  reading: string;
  category: string;
  authorName: string;
};

export type SharedSubmissionValidation =
  | { ok: true; submission: SharedSubmissionInput }
  | { ok: false; errors: SharedSubmissionErrorCode[] };

export function validateSharedSubmission(
  input: {
    word: unknown;
    reading: unknown;
    category?: unknown;
    authorName?: unknown;
  },
  type: SharedSubmissionType = "add"
): SharedSubmissionValidation {
  const errors: SharedSubmissionErrorCode[] = [];
  const rawWord = typeof input.word === "string" ? input.word : "";
  const rawReading = typeof input.reading === "string" ? input.reading : "";
  const rawCategory = typeof input.category === "string" ? input.category : "";
  const rawAuthor = typeof input.authorName === "string" ? input.authorName : "";

  if (
    [rawWord, rawReading, rawCategory, rawAuthor].some((value) =>
      SHARED_FORBIDDEN_CHARACTERS.test(value)
    )
  ) {
    errors.push("FORBIDDEN_CHARACTER");
  }

  const word = normalizeDictionaryWord(rawWord);
  // 削除申請は単語だけを送る
  const reading = type === "remove" ? "" : rawReading.trim();
  const category = collapseWhitespace(rawCategory);
  const authorName = collapseWhitespace(rawAuthor);

  if (word.length === 0) errors.push("EMPTY_WORD");
  if (codePointLength(word) > MAX_SHARED_WORD_CODE_POINTS) errors.push("WORD_TOO_LONG");
  if (type === "add") {
    if (reading.length === 0) errors.push("EMPTY_READING");
    if (codePointLength(reading) > MAX_SHARED_READING_CODE_POINTS) {
      errors.push("READING_TOO_LONG");
    }
  }
  if (codePointLength(category) > MAX_SHARED_CATEGORY_CODE_POINTS) {
    errors.push("CATEGORY_TOO_LONG");
  }
  if (codePointLength(authorName) > MAX_SHARED_AUTHOR_CODE_POINTS) {
    errors.push("AUTHOR_TOO_LONG");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, submission: { type, word, reading, category, authorName } };
}

/** チャット由来の投稿者名を共有辞書の制限に収まる形へ丸める */
export function sanitizeSharedAuthorName(value: string | undefined): string {
  if (!value) return "";
  const cleaned = collapseWhitespace(value.replace(
    new RegExp(SHARED_FORBIDDEN_CHARACTERS.source, "gu"),
    ""
  ));
  return Array.from(cleaned).slice(0, MAX_SHARED_AUTHOR_CODE_POINTS).join("");
}

export type SharedDictionaryFetchPayload = {
  version: number;
  notModified: boolean;
  entries: SharedDictionaryEntry[];
};

export function parseSharedDictionaryResponse(
  value: unknown
): SharedDictionaryFetchPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    ok?: unknown;
    version?: unknown;
    notModified?: unknown;
    entries?: unknown;
  };
  if (candidate.ok !== true) return null;
  if (!Number.isSafeInteger(candidate.version) || (candidate.version as number) < 0) {
    return null;
  }
  const version = candidate.version as number;

  if (candidate.notModified === true) {
    return { version, notModified: true, entries: [] };
  }

  if (!Array.isArray(candidate.entries)) return null;
  if (candidate.entries.length > MAX_SHARED_ENTRY_COUNT) return null;

  const entries: SharedDictionaryEntry[] = [];
  const seenIds = new Set<string>();
  const seenWords = new Set<string>();
  for (const raw of candidate.entries) {
    const entry = parseSharedDictionaryEntry(raw);
    if (!entry) return null;
    if (seenIds.has(entry.id)) return null;
    seenIds.add(entry.id);
    // シート編集ミス等で同一単語が重複した場合は先頭を採用する
    const normalizedWord = normalizeDictionaryWord(entry.word);
    if (seenWords.has(normalizedWord)) continue;
    seenWords.add(normalizedWord);
    entries.push(entry);
  }

  return { version, notModified: false, entries };
}

function parseSharedDictionaryEntry(value: unknown): SharedDictionaryEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) return null;
  if (typeof candidate.word !== "string" || typeof candidate.reading !== "string") {
    return null;
  }

  const word = normalizeDictionaryWord(candidate.word);
  const reading = candidate.reading.trim();
  if (word.length === 0 || codePointLength(word) > MAX_SHARED_WORD_CODE_POINTS) return null;
  if (reading.length === 0 || codePointLength(reading) > MAX_SHARED_READING_CODE_POINTS) {
    return null;
  }
  if (
    [candidate.word, candidate.reading, candidate.category, candidate.author].some(
      (field) => typeof field === "string" && SHARED_FORBIDDEN_CHARACTERS.test(field)
    )
  ) {
    return null;
  }

  const category = collapseWhitespace(
    typeof candidate.category === "string" ? candidate.category : ""
  );
  const author = collapseWhitespace(
    typeof candidate.author === "string" ? candidate.author : ""
  );
  if (codePointLength(category) > MAX_SHARED_CATEGORY_CODE_POINTS) return null;
  if (codePointLength(author) > MAX_SHARED_AUTHOR_CODE_POINTS) return null;

  return {
    id: candidate.id.trim(),
    word,
    reading,
    category,
    author,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : ""
  };
}

export function parseSharedSubmissionsResponse(
  value: unknown
): SharedSubmissionRecord[] | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { ok?: unknown; submissions?: unknown };
  if (candidate.ok !== true || !Array.isArray(candidate.submissions)) return null;
  if (candidate.submissions.length > MAX_SHARED_SUBMISSION_RECORDS) return null;

  const records: SharedSubmissionRecord[] = [];
  for (const raw of candidate.submissions) {
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    if (typeof record.submissionId !== "string" || record.submissionId.length === 0) {
      return null;
    }
    if (typeof record.word !== "string" || typeof record.reading !== "string") return null;
    if (!isSubmissionStatus(record.status)) return null;
    if (record.type !== undefined && !isSubmissionType(record.type)) return null;
    records.push({
      submissionId: record.submissionId,
      type: isSubmissionType(record.type) ? record.type : "add",
      word: record.word,
      reading: record.reading,
      category: typeof record.category === "string" ? record.category : "",
      status: record.status,
      submittedAt: typeof record.createdAt === "string" ? record.createdAt : ""
    });
  }
  return records;
}

function isSubmissionStatus(value: unknown): value is SharedSubmissionStatus {
  return value === "pending" || value === "approved" || value === "rejected";
}

export function isSubmissionType(value: unknown): value is SharedSubmissionType {
  return value === "add" || value === "remove";
}

export type SharedModeratorState = {
  registered: boolean;
  name: string;
  registeredAt: string;
};

export type SharedReviewDecision = "approve" | "reject";

export type SharedPendingSubmission = {
  submissionId: string;
  type: SharedSubmissionType;
  word: string;
  reading: string;
  category: string;
  authorName: string;
  createdAt: string;
};

export const MAX_SHARED_PENDING_RECORDS = 200;
export const MAX_SHARED_MODERATOR_NAME_CODE_POINTS = 50;
export const MAX_SHARED_MODERATOR_PASSWORD_LENGTH = 200;

export function parseSharedPendingResponse(
  value: unknown
): SharedPendingSubmission[] | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { ok?: unknown; pending?: unknown };
  if (candidate.ok !== true || !Array.isArray(candidate.pending)) return null;
  if (candidate.pending.length > MAX_SHARED_PENDING_RECORDS) return null;

  const records: SharedPendingSubmission[] = [];
  for (const raw of candidate.pending) {
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    if (typeof record.submissionId !== "string" || record.submissionId.length === 0) {
      return null;
    }
    if (typeof record.word !== "string" || typeof record.reading !== "string") return null;
    records.push({
      submissionId: record.submissionId,
      type: isSubmissionType(record.type) ? record.type : "add",
      word: record.word,
      reading: record.reading,
      category: typeof record.category === "string" ? record.category : "",
      authorName: typeof record.authorName === "string" ? record.authorName : "",
      createdAt: typeof record.createdAt === "string" ? record.createdAt : ""
    });
  }
  return records;
}

export function isSharedReviewDecision(value: unknown): value is SharedReviewDecision {
  return value === "approve" || value === "reject";
}

export type SharedImportResult = {
  addedCount: number;
  skippedCount: number;
  missingCount: number;
};

export function importSharedEntries(
  dictionary: DictionaryFile,
  sharedEntries: SharedDictionaryEntry[],
  selectedIds: string[],
  now = new Date()
): { dictionary: DictionaryFile; result: SharedImportResult } {
  const entryById = new Map(sharedEntries.map((entry) => [entry.id, entry]));
  const existingWords = new Set(
    dictionary.entries.map((entry) => normalizeDictionaryWord(entry.word))
  );
  const timestamp = now.toISOString();
  const addedEntries: DictionaryEntry[] = [];
  let skippedCount = 0;
  let missingCount = 0;

  for (const id of dedupe(selectedIds)) {
    const shared = entryById.get(id);
    if (!shared) {
      missingCount += 1;
      continue;
    }

    const word = normalizeDictionaryWord(shared.word);
    if (existingWords.has(word)) {
      skippedCount += 1;
      continue;
    }

    existingWords.add(word);
    addedEntries.push({
      word,
      reading: shared.reading,
      priority: calculateDefaultPriority(word),
      enabled: true,
      createdBy: shared.author || SHARED_DICTIONARY_DEFAULT_AUTHOR,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  return {
    dictionary: {
      ...dictionary,
      entries: [...dictionary.entries, ...addedEntries]
    },
    result: {
      addedCount: addedEntries.length,
      skippedCount,
      missingCount
    }
  };
}

export function isValidSharedEndpointUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:";
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
