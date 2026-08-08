(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SharedDictionaryState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createSharedDictionaryState() {
    return {
      settings: { endpointUrl: null },
      cache: null,
      submissions: [],
      selectedIds: new Set(),
      moderator: { registered: false, name: "", registeredAt: "" },
      pending: []
    };
  }

  function normalizeWord(value) {
    return String(value ?? "")
      .trim()
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .toLowerCase();
  }

  function applySharedData(state, shared, localEntries) {
    if (!shared || typeof shared !== "object") return state;

    const settings = {
      endpointUrl:
        typeof shared.settings?.endpointUrl === "string" && shared.settings.endpointUrl
          ? shared.settings.endpointUrl
          : null
    };
    const cache = isCache(shared.cache) ? shared.cache : null;
    const submissions = Array.isArray(shared.submissions) ? shared.submissions : [];
    const moderator =
      shared.moderator && shared.moderator.registered === true
        ? {
            registered: true,
            name: typeof shared.moderator.name === "string" ? shared.moderator.name : "",
            registeredAt:
              typeof shared.moderator.registeredAt === "string"
                ? shared.moderator.registeredAt
                : ""
          }
        : { registered: false, name: "", registeredAt: "" };
    const pending = Array.isArray(shared.pending) ? shared.pending : [];
    const importable = new Set(importableIds(cache, localEntries));
    const selectedIds = new Set(
      [...state.selectedIds].filter((id) => importable.has(id))
    );

    return { ...state, settings, cache, submissions, selectedIds, moderator, pending };
  }

  function isCache(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        Number.isSafeInteger(value.version) &&
        Array.isArray(value.entries) &&
        typeof value.fetchedAt === "string"
    );
  }

  function isImported(entry, localEntries) {
    const word = normalizeWord(entry.word);
    return localEntries.some((local) => normalizeWord(local.word) === word);
  }

  function importableIds(cache, localEntries) {
    if (!cache) return [];
    return cache.entries
      .filter((entry) => !isImported(entry, localEntries))
      .map((entry) => entry.id);
  }

  function toggleSelected(state, id, selected) {
    const selectedIds = new Set(state.selectedIds);
    if (selected) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
    return { ...state, selectedIds };
  }

  function setAllSelected(state, ids, selected) {
    const selectedIds = selected ? new Set(ids) : new Set();
    return { ...state, selectedIds };
  }

  function submissionStatusLabel(status) {
    const labels = {
      pending: "承認待ち",
      approved: "承認済み",
      rejected: "却下"
    };
    return labels[status] || status;
  }

  function submissionTypeLabel(type) {
    if (type === "remove") return "削除";
    return "追加";
  }

  function sharedErrorMessage(sharedError) {
    if (!sharedError || typeof sharedError !== "object") return "エラーが発生しました。";

    if (sharedError.code === "SERVER_REJECTED") {
      const serverMessages = {
        DUPLICATE: "同じ単語がすでに登録または承認待ちです。",
        NOT_FOUND: "対象が見つかりません。すでに処理済みか、共有辞書に存在しない可能性があります。",
        INVALID_SUBMISSION_ID: "対象の申請を特定できませんでした。一覧を更新してください。",
        WEAK_PASSWORD: "共有辞書側のパスワードが短すぎます。オーナーは12文字以上のパスワードを設定してください。",
        REGISTRATION_LOCKED: "登録の失敗が続いたため一時的に停止しています。時間をおいて再度お試しください。",
        BLOCKED: "この利用者からの投稿は受け付けられていません。",
        RATE_LIMITED: "投稿回数の上限に達しました。時間をおいて再度お試しください。",
        QUEUE_FULL: "承認待ちが上限に達しています。時間をおいて再度お試しください。",
        INVALID_BODY: "送信内容が不正です。",
        INVALID_WORD: "単語が不正です。",
        INVALID_READING: "読みが不正です。",
        INVALID_CATEGORY: "カテゴリが不正です。",
        INVALID_AUTHOR: "投稿者名・表示名が不正です。",
        PASSWORD_NOT_SET: "共有辞書側にモデレータ用パスワードが設定されていません。オーナーに確認してください。",
        INVALID_PASSWORD: "パスワードが違います。",
        NOT_MODERATOR: "モデレータ登録が確認できませんでした。登録が解除された可能性があります。"
      };
      return (
        serverMessages[sharedError.serverCode] ||
        `サーバーが投稿を受け付けませんでした (${sharedError.serverCode || "不明"})。`
      );
    }

    const messages = {
      NOT_CONFIGURED: "共有辞書のURLが設定されていません。",
      INVALID_ENDPOINT: "共有辞書のURLはhttpsで始まるURLを入力してください。",
      INVALID_ACTION: "リクエストが不正です。",
      INVALID_SUBMISSION: formatSubmissionErrors(sharedError.errors),
      NO_CACHE: "共有辞書を取得してから取り込んでください。",
      NOT_MODERATOR: "モデレータ登録が必要です。",
      NETWORK_ERROR: "共有辞書へ接続できませんでした。",
      TIMEOUT: "共有辞書への接続がタイムアウトしました。",
      HTTP_ERROR: "共有辞書がエラーを返しました。",
      INVALID_RESPONSE: "共有辞書の応答を解釈できませんでした。"
    };
    return messages[sharedError.code] || "エラーが発生しました。";
  }

  function formatSubmissionErrors(errors) {
    const messages = {
      EMPTY_WORD: "単語を入力してください。",
      WORD_TOO_LONG: "単語は100文字以内で入力してください。",
      EMPTY_READING: "読みを入力してください。",
      READING_TOO_LONG: "読みは200文字以内で入力してください。",
      CATEGORY_TOO_LONG: "カテゴリは50文字以内で入力してください。",
      AUTHOR_TOO_LONG: "投稿者名は50文字以内で入力してください。",
      FORBIDDEN_CHARACTER: "使用できない文字が含まれています。"
    };
    if (!Array.isArray(errors) || errors.length === 0) return "入力内容が不正です。";
    return errors.map((code) => messages[code] || `入力エラー (${code})`).join(" ");
  }

  return {
    applySharedData,
    createSharedDictionaryState,
    importableIds,
    isImported,
    normalizeWord,
    setAllSelected,
    sharedErrorMessage,
    submissionStatusLabel,
    submissionTypeLabel,
    toggleSelected
  };
});
