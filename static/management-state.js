(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ManagementState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SETTINGS_KEYS = [
    "educationCommandEnabled",
    "forgetCommandEnabled",
    "sharedEducationCommandEnabled",
    "sharedForgetCommandEnabled"
  ];

  function createManagementState() {
    return {
      baselineSettings: null,
      currentSettings: null,
      entries: [],
      priorityDrafts: new Map(),
      requestLocked: false
    };
  }

  function normalizeWord(value) {
    return String(value ?? "")
      .trim()
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .toLowerCase();
  }

  function applyManagementData(state, data, options = {}) {
    const baselineSettings = copySettings(data.settings);
    const currentSettings =
      state.currentSettings === null || options.adoptSettings
        ? copySettings(data.settings)
        : state.currentSettings;
    const entries = sortEntries(data.dictionary.entries);
    const entryWords = new Set(entries.map((entry) => normalizeWord(entry.word)));
    const priorityDrafts = new Map();

    for (const [word, draft] of state.priorityDrafts) {
      if (!entryWords.has(word)) continue;
      const entry = entries.find((candidate) => normalizeWord(candidate.word) === word);
      if (!entry || priorityEquals(draft.value, entry.priority)) continue;
      priorityDrafts.set(word, { ...draft });
    }

    return {
      ...state,
      baselineSettings,
      currentSettings,
      entries,
      priorityDrafts
    };
  }

  function setCurrentSettings(state, settings) {
    return { ...state, currentSettings: copySettings(settings) };
  }

  function sortEntries(entries) {
    return entries
      .map((entry, index) => ({ entry: { ...entry }, index }))
      .sort((left, right) => {
        const priority = right.entry.priority - left.entry.priority;
        if (priority !== 0) return priority;

        const wordLength =
          Array.from(normalizeWord(right.entry.word)).length -
          Array.from(normalizeWord(left.entry.word)).length;
        if (wordLength !== 0) return wordLength;

        const updatedAt = left.entry.updatedAt.localeCompare(right.entry.updatedAt);
        if (updatedAt !== 0) return updatedAt;
        return left.index - right.index;
      })
      .map(({ entry }) => entry);
  }

  function isSettingsDirty(state) {
    if (!state.baselineSettings || !state.currentSettings) return false;
    return SETTINGS_KEYS.some(
      (key) => state.baselineSettings[key] !== state.currentSettings[key]
    );
  }

  function setPriorityDraft(state, word, value) {
    const key = normalizeWord(word);
    const entry = state.entries.find((candidate) => normalizeWord(candidate.word) === key);
    const priorityDrafts = new Map(state.priorityDrafts);
    if (!entry || priorityEquals(value, entry.priority)) {
      priorityDrafts.delete(key);
    } else {
      priorityDrafts.set(key, { value: String(value), error: "" });
    }
    return { ...state, priorityDrafts };
  }

  function setPriorityError(state, word, error) {
    const key = normalizeWord(word);
    const draft = state.priorityDrafts.get(key);
    if (!draft) return state;
    const priorityDrafts = new Map(state.priorityDrafts);
    priorityDrafts.set(key, { ...draft, error });
    return { ...state, priorityDrafts };
  }

  function revertPriorityDraft(state, word) {
    const priorityDrafts = new Map(state.priorityDrafts);
    priorityDrafts.delete(normalizeWord(word));
    return { ...state, priorityDrafts };
  }

  function parsePriority(value) {
    if (typeof value !== "string" || value.trim() === "") return null;
    const priority = Number(value);
    return Number.isSafeInteger(priority) && priority >= 1 ? priority : null;
  }

  function tryLock(state) {
    if (state.requestLocked) return false;
    state.requestLocked = true;
    return true;
  }

  function unlock(state) {
    state.requestLocked = false;
  }

  async function runLockedRequest(state, operation) {
    if (!tryLock(state)) return { started: false };
    try {
      return { started: true, value: await operation() };
    } finally {
      unlock(state);
    }
  }

  function copySettings(settings) {
    const copied = {};
    for (const key of SETTINGS_KEYS) {
      copied[key] = Boolean(settings[key]);
    }
    return copied;
  }

  function priorityEquals(value, priority) {
    const parsed = parsePriority(String(value));
    return parsed !== null && parsed === priority;
  }

  return {
    applyManagementData,
    createManagementState,
    isSettingsDirty,
    normalizeWord,
    parsePriority,
    revertPriorityDraft,
    setCurrentSettings,
    setPriorityDraft,
    setPriorityError,
    sortEntries,
    runLockedRequest,
    tryLock,
    unlock
  };
});
