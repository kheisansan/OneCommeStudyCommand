import {
  parseSharedDictionaryResponse,
  parseSharedPendingResponse,
  parseSharedSubmissionsResponse,
  type SharedDictionaryFetchPayload,
  type SharedPendingSubmission,
  type SharedReviewDecision,
  type SharedSubmissionInput,
  type SharedSubmissionRecord
} from "./sharedDictionary";

export const SHARED_DICTIONARY_FETCH_TIMEOUT_MS = 10_000;

export type SharedDictionaryClientErrorCode =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "SERVER_REJECTED";

export type SharedDictionaryClientError = {
  ok: false;
  code: SharedDictionaryClientErrorCode;
  status?: number;
  serverCode?: string;
};

export type SharedDictionaryFetchOutcome =
  | { ok: true; payload: SharedDictionaryFetchPayload }
  | SharedDictionaryClientError;

export type SharedSubmissionsFetchOutcome =
  | { ok: true; submissions: SharedSubmissionRecord[] }
  | SharedDictionaryClientError;

export type SharedSubmitOutcome =
  | { ok: true; submissionId: string }
  | SharedDictionaryClientError;

export type FetchResponseLike = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    redirect?: "follow";
  }
) => Promise<FetchResponseLike>;

export async function fetchSharedDictionary(
  endpointUrl: string,
  knownVersion: number | null,
  fetchImpl: FetchLike = fetch,
  timeoutMs = SHARED_DICTIONARY_FETCH_TIMEOUT_MS
): Promise<SharedDictionaryFetchOutcome> {
  const url = buildUrl(endpointUrl, {
    action: "dictionary",
    ...(knownVersion === null ? {} : { version: String(knownVersion) })
  });
  const requested = await requestJson(url, undefined, fetchImpl, timeoutMs);
  if (!requested.ok) return requested;

  const payload = parseSharedDictionaryResponse(requested.body);
  if (!payload) return serverErrorFrom(requested.body);
  return { ok: true, payload };
}

export async function fetchOwnSubmissions(
  endpointUrl: string,
  token: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = SHARED_DICTIONARY_FETCH_TIMEOUT_MS
): Promise<SharedSubmissionsFetchOutcome> {
  const url = buildUrl(endpointUrl, { action: "submissions", token });
  const requested = await requestJson(url, undefined, fetchImpl, timeoutMs);
  if (!requested.ok) return requested;

  const submissions = parseSharedSubmissionsResponse(requested.body);
  if (!submissions) return serverErrorFrom(requested.body);
  return { ok: true, submissions };
}

export async function submitSharedEntry(
  endpointUrl: string,
  submission: SharedSubmissionInput,
  token: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = SHARED_DICTIONARY_FETCH_TIMEOUT_MS
): Promise<SharedSubmitOutcome> {
  const requested = await requestJson(
    endpointUrl,
    {
      method: "POST",
      // GASのWebアプリはtext/plainで受けるとpreflightなしで動作する
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "submit", ...submission, token })
    },
    fetchImpl,
    timeoutMs
  );
  if (!requested.ok) return requested;

  const body = requested.body as { ok?: unknown; submissionId?: unknown } | null;
  if (body && body.ok === true && typeof body.submissionId === "string") {
    return { ok: true, submissionId: body.submissionId };
  }
  return serverErrorFrom(requested.body);
}

export type SharedRegisterOutcome =
  | { ok: true }
  | SharedDictionaryClientError;

export type SharedPendingFetchOutcome =
  | { ok: true; pending: SharedPendingSubmission[] }
  | SharedDictionaryClientError;

export type SharedReviewOutcome =
  | { ok: true; submissionId: string; word: string }
  | SharedDictionaryClientError;

export async function registerSharedModerator(
  endpointUrl: string,
  password: string,
  name: string,
  token: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = SHARED_DICTIONARY_FETCH_TIMEOUT_MS
): Promise<SharedRegisterOutcome> {
  const requested = await requestJson(
    endpointUrl,
    {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "registerModerator", password, name, token })
    },
    fetchImpl,
    timeoutMs
  );
  if (!requested.ok) return requested;

  const body = requested.body as { ok?: unknown } | null;
  if (body && body.ok === true) return { ok: true };
  return serverErrorFrom(requested.body);
}

export async function fetchPendingSubmissions(
  endpointUrl: string,
  token: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = SHARED_DICTIONARY_FETCH_TIMEOUT_MS
): Promise<SharedPendingFetchOutcome> {
  const url = buildUrl(endpointUrl, { action: "pending", token });
  const requested = await requestJson(url, undefined, fetchImpl, timeoutMs);
  if (!requested.ok) return requested;

  const pending = parseSharedPendingResponse(requested.body);
  if (!pending) return serverErrorFrom(requested.body);
  return { ok: true, pending };
}

export async function reviewSharedSubmission(
  endpointUrl: string,
  submissionId: string,
  decision: SharedReviewDecision,
  token: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = SHARED_DICTIONARY_FETCH_TIMEOUT_MS
): Promise<SharedReviewOutcome> {
  const requested = await requestJson(
    endpointUrl,
    {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "review", submissionId, decision, token })
    },
    fetchImpl,
    timeoutMs
  );
  if (!requested.ok) return requested;

  const body = requested.body as { ok?: unknown; word?: unknown } | null;
  if (body && body.ok === true) {
    return {
      ok: true,
      submissionId,
      word: typeof body.word === "string" ? body.word : ""
    };
  }
  return serverErrorFrom(requested.body);
}

type JsonRequestOutcome =
  | { ok: true; body: unknown }
  | SharedDictionaryClientError;

async function requestJson(
  url: string,
  init: Parameters<FetchLike>[1],
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<JsonRequestOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let phase: "request" | "body" = "request";

  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal
    });

    // GASはエラー応答もHTTP 200で返すため、本文のokで判定する
    if (!response.ok) {
      return { ok: false, code: "HTTP_ERROR", status: response.status };
    }

    // fetchのsignalはヘッダー受信後の本文読み取りを中断しない実装が
    // あり得るため、本文の完了もタイムアウト対象にする
    phase = "body";
    const body = await withAbort(response.json(), controller.signal);
    return { ok: true, body };
  } catch {
    if (controller.signal.aborted) {
      return { ok: false, code: "TIMEOUT" };
    }
    return { ok: false, code: phase === "request" ? "NETWORK_ERROR" : "INVALID_RESPONSE" };
  } finally {
    clearTimeout(timer);
  }
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function serverErrorFrom(body: unknown): SharedDictionaryClientError {
  if (body && typeof body === "object") {
    const candidate = body as { ok?: unknown; code?: unknown };
    if (candidate.ok === false && typeof candidate.code === "string") {
      return { ok: false, code: "SERVER_REJECTED", serverCode: candidate.code };
    }
  }
  return { ok: false, code: "INVALID_RESPONSE" };
}

function buildUrl(endpointUrl: string, params: Record<string, string>): string {
  const url = new URL(endpointUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
