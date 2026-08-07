import { randomUUID } from "node:crypto";
import {
  MAX_SHARED_SUBMISSION_RECORDS,
  type SharedDictionaryCache,
  type SharedDictionaryEntry,
  type SharedDictionarySettings,
  type SharedSubmissionRecord,
  type SharedSubmissionStatus
} from "./sharedDictionary";
import type { StoreLike } from "./types";

export const SHARED_SETTINGS_STORE_KEY = "sharedDictionarySettings";
export const SHARED_CACHE_STORE_KEY = "sharedDictionaryCache";
export const SHARED_TOKEN_STORE_KEY = "sharedDictionaryToken";
export const SHARED_SUBMISSIONS_STORE_KEY = "sharedDictionarySubmissions";
export const SHARED_CACHE_TTL_MS = 60 * 60 * 1000;

export type SharedDictionaryAction =
  | { action: "configure"; endpointUrl: string | null }
  | { action: "fetch"; force: boolean }
  | { action: "submit"; word: string; reading: string; category: string; authorName: string }
  | { action: "refreshSubmissions" }
  | { action: "import"; ids: string[] };

export function parseSharedDictionaryAction(value: unknown): SharedDictionaryAction | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;

  switch (candidate.action) {
    case "configure": {
      if (candidate.endpointUrl === null) return { action: "configure", endpointUrl: null };
      if (typeof candidate.endpointUrl !== "string") return null;
      const endpointUrl = candidate.endpointUrl.trim();
      return { action: "configure", endpointUrl: endpointUrl.length === 0 ? null : endpointUrl };
    }
    case "fetch":
      if (candidate.force !== undefined && typeof candidate.force !== "boolean") return null;
      return { action: "fetch", force: candidate.force === true };
    case "submit":
      if (typeof candidate.word !== "string" || typeof candidate.reading !== "string") {
        return null;
      }
      if (candidate.category !== undefined && typeof candidate.category !== "string") {
        return null;
      }
      if (candidate.authorName !== undefined && typeof candidate.authorName !== "string") {
        return null;
      }
      return {
        action: "submit",
        word: candidate.word,
        reading: candidate.reading,
        category: typeof candidate.category === "string" ? candidate.category : "",
        authorName: typeof candidate.authorName === "string" ? candidate.authorName : ""
      };
    case "refreshSubmissions":
      return { action: "refreshSubmissions" };
    case "import":
      if (!Array.isArray(candidate.ids)) return null;
      if (candidate.ids.length === 0) return null;
      if (!candidate.ids.every((id) => typeof id === "string" && id.length > 0)) return null;
      return { action: "import", ids: candidate.ids as string[] };
    default:
      return null;
  }
}

export function loadSharedSettings(store: StoreLike): SharedDictionarySettings {
  const value = store.get(SHARED_SETTINGS_STORE_KEY);
  if (value && typeof value === "object") {
    const candidate = value as { endpointUrl?: unknown };
    if (typeof candidate.endpointUrl === "string" && candidate.endpointUrl.length > 0) {
      return { endpointUrl: candidate.endpointUrl };
    }
  }
  return { endpointUrl: null };
}

export function saveSharedSettings(store: StoreLike, settings: SharedDictionarySettings): void {
  store.set(SHARED_SETTINGS_STORE_KEY, settings);
}

export function loadSharedCache(store: StoreLike): SharedDictionaryCache | null {
  const value = store.get(SHARED_CACHE_STORE_KEY);
  if (!value || typeof value !== "object") return null;

  const candidate = value as { version?: unknown; entries?: unknown; fetchedAt?: unknown };
  if (!Number.isSafeInteger(candidate.version) || (candidate.version as number) < 0) {
    return null;
  }
  if (typeof candidate.fetchedAt !== "string") return null;
  if (!Array.isArray(candidate.entries)) return null;
  if (!candidate.entries.every(isSharedDictionaryEntry)) return null;

  return {
    version: candidate.version as number,
    entries: candidate.entries as SharedDictionaryEntry[],
    fetchedAt: candidate.fetchedAt
  };
}

export function saveSharedCache(store: StoreLike, cache: SharedDictionaryCache): void {
  store.set(SHARED_CACHE_STORE_KEY, cache);
}

export function clearSharedCache(store: StoreLike): void {
  store.set(SHARED_CACHE_STORE_KEY, null);
}

export function isSharedCacheFresh(
  cache: SharedDictionaryCache,
  now = new Date(),
  ttlMs = SHARED_CACHE_TTL_MS
): boolean {
  const fetchedAt = new Date(cache.fetchedAt).getTime();
  if (Number.isNaN(fetchedAt)) return false;
  const elapsed = now.getTime() - fetchedAt;
  return elapsed >= 0 && elapsed < ttlMs;
}

export function ensureSharedToken(
  store: StoreLike,
  generate: () => string = randomUUID
): string {
  const value = store.get(SHARED_TOKEN_STORE_KEY);
  if (typeof value === "string" && value.length > 0) return value;

  const token = generate();
  store.set(SHARED_TOKEN_STORE_KEY, token);
  return token;
}

export function loadSubmissionRecords(store: StoreLike): SharedSubmissionRecord[] {
  const value = store.get(SHARED_SUBMISSIONS_STORE_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter(isSubmissionRecord);
}

export function recordSubmission(store: StoreLike, record: SharedSubmissionRecord): void {
  const records = [record, ...loadSubmissionRecords(store)];
  store.set(SHARED_SUBMISSIONS_STORE_KEY, records.slice(0, MAX_SHARED_SUBMISSION_RECORDS));
}

export function mergeSubmissionRecords(
  store: StoreLike,
  serverRecords: SharedSubmissionRecord[]
): SharedSubmissionRecord[] {
  const serverIds = new Set(serverRecords.map((record) => record.submissionId));
  // サーバー側が保持期間超過などで返さなくなったローカル記録は残す
  const localOnly = loadSubmissionRecords(store).filter(
    (record) => !serverIds.has(record.submissionId)
  );
  const merged = [...serverRecords, ...localOnly].slice(0, MAX_SHARED_SUBMISSION_RECORDS);
  store.set(SHARED_SUBMISSIONS_STORE_KEY, merged);
  return merged;
}

function isSharedDictionaryEntry(value: unknown): value is SharedDictionaryEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.word === "string" &&
    candidate.word.length > 0 &&
    typeof candidate.reading === "string" &&
    candidate.reading.length > 0 &&
    typeof candidate.category === "string" &&
    typeof candidate.author === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function isSubmissionRecord(value: unknown): value is SharedSubmissionRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.submissionId === "string" &&
    candidate.submissionId.length > 0 &&
    typeof candidate.word === "string" &&
    typeof candidate.reading === "string" &&
    typeof candidate.category === "string" &&
    isSubmissionStatus(candidate.status) &&
    typeof candidate.submittedAt === "string"
  );
}

function isSubmissionStatus(value: unknown): value is SharedSubmissionStatus {
  return value === "pending" || value === "approved" || value === "rejected";
}
