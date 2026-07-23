import { calculateDefaultPriority } from "./dictionaryService";
import type { DictionaryEntry, DictionaryFile } from "./types";
import { normalizeDictionaryWord } from "./wordNormalizer";

export const STUDY_DICTIONARY_FILE_NAME = "ReplaceStudy.dic";
export const MAX_STUDY_DICTIONARY_BYTES = 1024 * 1024;
export const MAX_STUDY_DICTIONARY_BASE64_LENGTH = 1_398_104;
export const MAX_STUDY_DICTIONARY_BODY_LENGTH = 1_400_000;
export const MAX_STUDY_DICTIONARY_ROWS = 10_000;
export const MAX_STUDY_DICTIONARY_LINE_BYTES = 8 * 1024;
export const MAX_STUDY_DICTIONARY_VALUE_CODE_POINTS = 1_000;
export const MAX_STUDY_DICTIONARY_ERROR_DETAILS = 100;

export type StudyDictionaryImportErrorCode =
  | "INVALID_FILE_NAME"
  | "INVALID_BODY"
  | "BODY_TOO_LARGE"
  | "INVALID_BASE64"
  | "BASE64_TOO_LARGE"
  | "FILE_TOO_LARGE"
  | "INVALID_UTF8"
  | "EMPTY_DICTIONARY"
  | "TOO_MANY_ROWS"
  | "LINE_TOO_LARGE"
  | "INVALID_COLUMN_COUNT"
  | "INVALID_SOURCE_LENGTH"
  | "INVALID_MATCH_TYPE"
  | "EMPTY_WORD"
  | "EMPTY_READING"
  | "WORD_TOO_LONG"
  | "READING_TOO_LONG"
  | "CONFLICTING_DUPLICATE"
  | "INVALID_BOM"
  | "INVALID_LINE_BREAK";

export type StudyDictionaryImportError = {
  code: StudyDictionaryImportErrorCode;
  line?: number;
};

export type StudyDictionaryImportErrorResponse = {
  message: "Invalid study dictionary";
  errorCount: number;
  errors: StudyDictionaryImportError[];
  truncated: boolean;
};

export type StudyDictionaryImportResult = {
  sourceRowCount: number;
  candidateCount: number;
  mergedDuplicateCount: number;
  addedCount: number;
  skippedCount: number;
};

export type StudyDictionaryImportSuccess = {
  ok: true;
  dictionary: DictionaryFile;
  importResult: StudyDictionaryImportResult;
};

export type StudyDictionaryImportFailure = {
  ok: false;
  error: StudyDictionaryImportErrorResponse;
};

export type StudyDictionaryImportOutcome =
  | StudyDictionaryImportSuccess
  | StudyDictionaryImportFailure;

type ImportCandidate = {
  word: string;
  reading: string;
  firstLine: number;
};

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export function importStudyDictionary(
  contentBase64: string,
  currentDictionary: DictionaryFile,
  now = new Date()
): StudyDictionaryImportOutcome {
  const decoded = decodeCanonicalBase64(contentBase64);
  if (!decoded.ok) return decoded;

  const parsed = parseStudyDictionaryBytes(decoded.bytes);
  if (!parsed.ok) return parsed;

  const existingWords = new Set(
    currentDictionary.entries.map((entry) => normalizeDictionaryWord(entry.word))
  );
  const timestamp = now.toISOString();
  const addedEntries: DictionaryEntry[] = [];
  let skippedCount = 0;

  for (const candidate of parsed.candidates) {
    if (existingWords.has(candidate.word)) {
      skippedCount += 1;
      continue;
    }

    addedEntries.push({
      word: candidate.word,
      reading: candidate.reading,
      priority: calculateDefaultPriority(candidate.word),
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  return {
    ok: true,
    dictionary: {
      ...currentDictionary,
      entries: [...currentDictionary.entries, ...addedEntries]
    },
    importResult: {
      sourceRowCount: parsed.sourceRowCount,
      candidateCount: parsed.candidates.length,
      mergedDuplicateCount: parsed.mergedDuplicateCount,
      addedCount: addedEntries.length,
      skippedCount
    }
  };
}

export function parseStudyDictionaryBytes(bytes: Uint8Array):
  | {
      ok: true;
      sourceRowCount: number;
      candidates: ImportCandidate[];
      mergedDuplicateCount: number;
    }
  | StudyDictionaryImportFailure {
  if (bytes.byteLength > MAX_STUDY_DICTIONARY_BYTES) {
    return failure("FILE_TOO_LARGE");
  }

  if (hasInvalidBom(bytes)) {
    return failure("INVALID_BOM");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failure("INVALID_UTF8");
  }

  if (text.startsWith("\uFEFF")) text = text.slice(1);
  if (text.includes("\uFEFF")) return failure("INVALID_BOM");
  if (/\r(?!\n)/u.test(text)) return failure("INVALID_LINE_BREAK");

  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return failure("EMPTY_DICTIONARY");
  if (lines.length > MAX_STUDY_DICTIONARY_ROWS) return failure("TOO_MANY_ROWS");

  const errors: StudyDictionaryImportError[] = [];
  const candidates = new Map<string, ImportCandidate>();
  let mergedDuplicateCount = 0;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (Buffer.byteLength(line, "utf8") > MAX_STUDY_DICTIONARY_LINE_BYTES) {
      errors.push({ code: "LINE_TOO_LARGE", line: lineNumber });
      return;
    }

    const columns = line.split("\t");
    if (columns.length !== 4) {
      errors.push({ code: "INVALID_COLUMN_COUNT", line: lineNumber });
      return;
    }

    const [sourceLength, matchType, sourceWord, sourceReading] = columns;
    let valid = true;
    if (!/^[0-9]+$/u.test(sourceLength) || /^0+$/u.test(sourceLength)) {
      errors.push({ code: "INVALID_SOURCE_LENGTH", line: lineNumber });
      valid = false;
    }
    if (matchType !== "N" && matchType !== "E") {
      errors.push({ code: "INVALID_MATCH_TYPE", line: lineNumber });
      valid = false;
    }
    if (sourceWord.length === 0) {
      errors.push({ code: "EMPTY_WORD", line: lineNumber });
      valid = false;
    }
    if (sourceReading.length === 0) {
      errors.push({ code: "EMPTY_READING", line: lineNumber });
      valid = false;
    }

    const word = normalizeDictionaryWord(sourceWord);
    const reading = sourceReading.trim();
    if (sourceWord.length > 0 && word.length === 0) {
      errors.push({ code: "EMPTY_WORD", line: lineNumber });
      valid = false;
    }
    if (sourceReading.length > 0 && reading.length === 0) {
      errors.push({ code: "EMPTY_READING", line: lineNumber });
      valid = false;
    }
    if (Array.from(word).length > MAX_STUDY_DICTIONARY_VALUE_CODE_POINTS) {
      errors.push({ code: "WORD_TOO_LONG", line: lineNumber });
      valid = false;
    }
    if (Array.from(reading).length > MAX_STUDY_DICTIONARY_VALUE_CODE_POINTS) {
      errors.push({ code: "READING_TOO_LONG", line: lineNumber });
      valid = false;
    }
    if (!valid) return;

    const existing = candidates.get(word);
    if (!existing) {
      candidates.set(word, { word, reading, firstLine: lineNumber });
    } else if (existing.reading === reading) {
      mergedDuplicateCount += 1;
    } else {
      errors.push({ code: "CONFLICTING_DUPLICATE", line: lineNumber });
    }
  });

  if (errors.length > 0) return failures(errors);

  return {
    ok: true,
    sourceRowCount: lines.length,
    candidates: [...candidates.values()],
    mergedDuplicateCount
  };
}

function decodeCanonicalBase64(contentBase64: string):
  | { ok: true; bytes: Uint8Array }
  | StudyDictionaryImportFailure {
  if (contentBase64.length > MAX_STUDY_DICTIONARY_BASE64_LENGTH) {
    return failure("BASE64_TOO_LARGE");
  }
  if (contentBase64.length === 0 || !CANONICAL_BASE64.test(contentBase64)) {
    return failure("INVALID_BASE64");
  }

  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.toString("base64") !== contentBase64) return failure("INVALID_BASE64");
  if (bytes.byteLength > MAX_STUDY_DICTIONARY_BYTES) return failure("FILE_TOO_LARGE");
  return { ok: true, bytes };
}

function hasInvalidBom(bytes: Uint8Array): boolean {
  let bomCount = 0;
  let firstBomOffset = -1;
  for (let index = 0; index <= bytes.length - UTF8_BOM.length; index += 1) {
    if (UTF8_BOM.every((byte, offset) => bytes[index + offset] === byte)) {
      bomCount += 1;
      if (firstBomOffset < 0) firstBomOffset = index;
    }
  }
  return bomCount > 1 || (bomCount === 1 && firstBomOffset !== 0);
}

export function failure(
  code: StudyDictionaryImportErrorCode,
  line?: number
): StudyDictionaryImportFailure {
  return failures([{ code, ...(line === undefined ? {} : { line }) }]);
}

function failures(errors: StudyDictionaryImportError[]): StudyDictionaryImportFailure {
  return {
    ok: false,
    error: {
      message: "Invalid study dictionary",
      errorCount: errors.length,
      errors: errors.slice(0, MAX_STUDY_DICTIONARY_ERROR_DETAILS),
      truncated: errors.length > MAX_STUDY_DICTIONARY_ERROR_DETAILS
    }
  };
}
