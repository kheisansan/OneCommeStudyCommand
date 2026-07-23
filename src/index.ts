import { parseEducationCommand } from "./commandParser";
import { createEmptyDictionary, handleEducationCommand } from "./dictionaryService";
import { applyDictionary, applyDictionaryWithMaskedFallback } from "./replacer";
import { StoreDictionaryRepository } from "./storeDictionaryRepository";
import {
  failure as studyDictionaryImportFailure,
  importStudyDictionary,
  MAX_STUDY_DICTIONARY_BODY_LENGTH,
  STUDY_DICTIONARY_FILE_NAME
} from "./studyDictionaryImport";
import type { DictionaryFile, PluginSettings, StoreLike } from "./types";
import { normalizeDictionaryWord } from "./wordNormalizer";
import { IS_PRERELEASE, PLUGIN_VERSION } from "./version";

type PluginInitParam = {
  dir: string;
  filepath?: string;
  store: StoreLike;
};

type CommentLike = {
  comment?: string;
  text?: string;
  data?: {
    comment?: string;
    speechText?: string;
    text?: string;
  };
  [key: string]: unknown;
};

type UserDataLike = {
  name?: string;
  displayName?: string;
  userName?: string;
  [key: string]: unknown;
} | null;

type PluginRequestLike = {
  method: "GET" | "POST" | "PUT" | "DELETE" | string;
  body?: unknown;
};

type PluginResponseLike = {
  code: number;
  response: unknown;
};

const PLUGIN_UID = "com.onecomme.study-command";
const SETTINGS_STORE_KEY = "settings";
const DEFAULT_SETTINGS: PluginSettings = {
  educationCommandEnabled: true,
  forgetCommandEnabled: true
};

let repository: StoreDictionaryRepository | null = null;
let dictionary: DictionaryFile | null = null;
let pluginStore: StoreLike | null = null;
let settings: PluginSettings = DEFAULT_SETTINGS;

const plugin = {
  name: "教育辞書プラグイン",
  uid: PLUGIN_UID,
  version: PLUGIN_VERSION,
  author: "タンチャオ(@tangchao_games)",
  url: `http://localhost:11180/plugins/${PLUGIN_UID}/index.html`,
  permissions: ["filter.comment", "filter.speech"],

  init({ store }: PluginInitParam) {
    pluginStore = store;
    repository = new StoreDictionaryRepository(store);
    dictionary = repository.load();
    settings = loadSettings(store);
    console.info(`[OneCommeStudyCommand] plugin initialized: version=${this.version}`);
  },

  destroy() {
    pluginStore = null;
    repository = null;
    dictionary = null;
    console.info("[OneCommeStudyCommand] plugin destroyed");
  },

  filterComment(comment: CommentLike, _service: unknown, userData: UserDataLike) {
    const commandInput = getEducationCommandInput(comment);
    if (!commandInput.text) return comment;

    const command = parseEducationCommand(commandInput.text);
    if (!command) return comment;
    if (!isCommandEnabled(command.type)) return comment;

    const currentDictionary = ensureDictionary();
    logPrereleaseCommandDiagnostic(comment, commandInput, command, currentDictionary);
    const handled = handleEducationCommand(currentDictionary, command, {
      createdBy: getUserName(userData)
    });

    dictionary = handled.dictionary;
    repository?.save(handled.dictionary);

    console.info(`[OneCommeStudyCommand] ${handled.result.message}`);
    if (handled.result.speechText) {
      const nextComment = setFeedbackText(comment, handled.result.speechText);
      return nextComment;
    }
    return false;
  },

  filterSpeech(text: string, _userData?: unknown, _config?: unknown, comment?: CommentLike) {
    const replacement = comment?.data?.speechText;
    if (replacement) {
      return replacement;
    }

    if (parseEducationCommand(text)) {
      return text;
    }

    const currentDictionary = ensureDictionary();
    const originalText = comment ? getCommentText(comment) : "";
    if (!originalText) {
      return applyDictionary(text, currentDictionary.entries);
    }

    return applyDictionaryWithMaskedFallback(
      text,
      originalText,
      currentDictionary.entries
    );
  },

  request(req: PluginRequestLike): PluginResponseLike {
    if (req.method === "GET") {
      return {
        code: 200,
        response: {
          settings,
          dictionary: ensureDictionary()
        }
      };
    }

    if (req.method === "PUT") {
      const bodySizeError = validateStringBodySize(req.body);
      if (bodySizeError) return bodySizeError;

      const requestType = getPutRequestType(req.body);
      if (requestType === "importStudyDictionary") {
        return importStudyDictionaryEntries(req.body);
      }
      if (requestType === "createEntry") {
        return createDictionaryEntry(req.body);
      }
      if (requestType === "updatePriority") {
        return updateDictionaryEntryPriority(req.body);
      }
      if (requestType !== "settings") {
        return {
          code: 400,
          response: {
            message: "Invalid request body"
          }
        };
      }

      const nextSettings = parseSettingsRequest(req.body);
      if (!nextSettings) {
        return {
          code: 400,
          response: {
            message: "Invalid settings"
          }
        };
      }

      settings = nextSettings;
      pluginStore?.set(SETTINGS_STORE_KEY, settings);

      return {
        code: 200,
        response: {
          settings,
          dictionary: ensureDictionary()
        }
      };
    }

    if (req.method === "DELETE") {
      const result = deleteDictionaryEntry(req.body);
      return result;
    }

    return {
      code: 404,
      response: {}
    };
  }
};

function ensureDictionary(): DictionaryFile {
  if (dictionary) return dictionary;
  dictionary = repository?.load() ?? createEmptyDictionary();
  return dictionary;
}

function loadSettings(store: StoreLike): PluginSettings {
  const value = store.get(SETTINGS_STORE_KEY, DEFAULT_SETTINGS);
  const nextSettings = normalizeSettings(value);

  if (!nextSettings) {
    console.warn("[OneCommeStudyCommand] Invalid settings data in store. Using default settings in memory.");
    return DEFAULT_SETTINGS;
  }

  return nextSettings;
}

function parseSettingsRequest(value: unknown): PluginSettings | null {
  const body = parseRequestBody(value);
  if (!body || typeof body !== "object") return null;

  const candidate = body as { settings?: unknown };
  return normalizeSettings(candidate.settings);
}

function parseEntryDeleteRequest(value: unknown): { word: string } | null {
  const body = parseRequestBody(value);
  if (!body || typeof body !== "object") return null;

  const candidate = body as { word?: unknown };
  if (typeof candidate.word !== "string") return null;
  const word = normalizeDictionaryWord(candidate.word);
  if (!word) return null;

  return {
    word
  };
}

function parseEntryCreateRequest(value: unknown): { word: string; reading: string } | null {
  const body = parseRequestBody(value);
  if (!body || typeof body !== "object") return null;

  const candidate = body as { word?: unknown; reading?: unknown };
  if (typeof candidate.word !== "string" || typeof candidate.reading !== "string") return null;

  const word = normalizeDictionaryWord(candidate.word);
  const reading = candidate.reading.trim();
  if (!word || !reading) return null;

  return { word, reading };
}

function parsePriorityUpdateRequest(value: unknown): { word: string; priority: number } | null {
  const body = parseRequestBody(value);
  if (!body || typeof body !== "object") return null;

  const candidate = body as { word?: unknown; priority?: unknown };
  if (typeof candidate.word !== "string") return null;
  if (!Number.isSafeInteger(candidate.priority) || (candidate.priority as number) < 1) return null;

  const word = normalizeDictionaryWord(candidate.word);
  if (!word) return null;
  return { word, priority: candidate.priority as number };
}

function getPutRequestType(
  value: unknown
): "settings" | "createEntry" | "updatePriority" | "importStudyDictionary" | "invalid" {
  const body = parseRequestBody(value);
  if (!body || typeof body !== "object" || Array.isArray(body)) return "invalid";

  const candidate = body as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (keysEqual(keys, ["settings"])) return "settings";
  if (keysEqual(keys, ["reading", "word"])) return "createEntry";
  if (keysEqual(keys, ["priority", "word"])) return "updatePriority";
  if (keysEqual(keys, ["contentBase64", "fileName"])) return "importStudyDictionary";
  if (
    Object.prototype.hasOwnProperty.call(candidate, "contentBase64") ||
    Object.prototype.hasOwnProperty.call(candidate, "fileName")
  ) {
    return "importStudyDictionary";
  }
  return "invalid";
}

function keysEqual(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseRequestBody(value: unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function validateStringBodySize(value: unknown): PluginResponseLike | null {
  if (typeof value !== "string") return null;
  if (
    value.length <= MAX_STUDY_DICTIONARY_BODY_LENGTH &&
    Buffer.byteLength(value, "utf8") <= MAX_STUDY_DICTIONARY_BODY_LENGTH
  ) {
    return null;
  }

  return {
    code: 400,
    response: studyDictionaryImportFailure("BODY_TOO_LARGE").error
  };
}

function importStudyDictionaryEntries(value: unknown): PluginResponseLike {
  const body = parseRequestBody(value);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      code: 400,
      response: studyDictionaryImportFailure("INVALID_BODY").error
    };
  }

  const candidate = body as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (!keysEqual(keys, ["contentBase64", "fileName"])) {
    return {
      code: 400,
      response: studyDictionaryImportFailure("INVALID_BODY").error
    };
  }
  if (candidate.fileName !== STUDY_DICTIONARY_FILE_NAME) {
    return {
      code: 400,
      response: studyDictionaryImportFailure("INVALID_FILE_NAME").error
    };
  }
  if (typeof candidate.contentBase64 !== "string") {
    return {
      code: 400,
      response: studyDictionaryImportFailure("INVALID_BODY").error
    };
  }

  const imported = importStudyDictionary(candidate.contentBase64, ensureDictionary());
  if (!imported.ok) return { code: 400, response: imported.error };

  try {
    repository?.save(imported.dictionary);
  } catch {
    return {
      code: 500,
      response: { message: "Failed to save study dictionary" }
    };
  }
  dictionary = imported.dictionary;

  return {
    code: 200,
    response: {
      settings,
      dictionary,
      importResult: imported.importResult
    }
  };
}

function normalizeSettings(value: unknown): PluginSettings | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<PluginSettings>;
  if (
    candidate.educationCommandEnabled !== undefined &&
    typeof candidate.educationCommandEnabled !== "boolean"
  ) {
    return null;
  }
  if (
    candidate.forgetCommandEnabled !== undefined &&
    typeof candidate.forgetCommandEnabled !== "boolean"
  ) {
    return null;
  }

  return {
    educationCommandEnabled:
      candidate.educationCommandEnabled ?? DEFAULT_SETTINGS.educationCommandEnabled,
    forgetCommandEnabled:
      candidate.forgetCommandEnabled ?? DEFAULT_SETTINGS.forgetCommandEnabled
  };
}

function isCommandEnabled(commandType: string): boolean {
  if (commandType === "teach") return settings.educationCommandEnabled;
  if (commandType === "forget") return settings.forgetCommandEnabled;
  return true;
}

function createDictionaryEntry(value: unknown): PluginResponseLike {
  const request = parseEntryCreateRequest(value);
  if (!request) {
    return {
      code: 400,
      response: {
        message: "Invalid entry create"
      }
    };
  }

  const currentDictionary = ensureDictionary();
  if (
    currentDictionary.entries.some(
      (entry) => normalizeDictionaryWord(entry.word) === request.word
    )
  ) {
    return {
      code: 409,
      response: {
        message: "Entry already exists"
      }
    };
  }

  const handled = handleEducationCommand(currentDictionary, {
    type: "teach",
    word: request.word,
    reading: request.reading
  });
  dictionary = handled.dictionary;
  repository?.save(dictionary);

  return {
    code: 200,
    response: {
      settings,
      dictionary
    }
  };
}

function updateDictionaryEntryPriority(value: unknown): PluginResponseLike {
  const request = parsePriorityUpdateRequest(value);
  if (!request) {
    return {
      code: 400,
      response: { message: "Invalid priority update" }
    };
  }

  const currentDictionary = ensureDictionary();
  const index = currentDictionary.entries.findIndex(
    (entry) => normalizeDictionaryWord(entry.word) === request.word
  );
  if (index < 0) {
    return {
      code: 404,
      response: { message: "Entry not found" }
    };
  }

  if (currentDictionary.entries[index].priority === request.priority) {
    return {
      code: 200,
      response: { settings, dictionary: currentDictionary }
    };
  }

  const entries = [...currentDictionary.entries];
  entries[index] = {
    ...entries[index],
    priority: request.priority,
    updatedAt: new Date().toISOString()
  };
  dictionary = { ...currentDictionary, entries };
  repository?.save(dictionary);

  return {
    code: 200,
    response: { settings, dictionary }
  };
}

function deleteDictionaryEntry(value: unknown): PluginResponseLike {
  const request = parseEntryDeleteRequest(value);
  if (!request) {
    return {
      code: 400,
      response: {
        message: "Invalid entry delete"
      }
    };
  }

  const currentDictionary = ensureDictionary();
  const entries = currentDictionary.entries.filter(
    (entry) => normalizeDictionaryWord(entry.word) !== request.word
  );
  if (entries.length === currentDictionary.entries.length) {
    return {
      code: 404,
      response: {
        message: "Entry not found"
      }
    };
  }

  dictionary = {
    ...currentDictionary,
    entries
  };
  repository?.save(dictionary);

  return {
    code: 200,
    response: {
      settings,
      dictionary
    }
  };
}

function getCommentText(comment: CommentLike): string {
  const candidates = [
    comment.comment,
    comment.text,
    comment.data?.comment,
    comment.data?.text
  ];

  const text = candidates.find((candidate) => typeof candidate === "string");
  return text ?? "";
}

function getEducationCommandInput(comment: CommentLike): {
  text: string;
  source: "data.speechText" | "comment";
} {
  const speechText = comment.data?.speechText;
  if (speechText && parseEducationCommand(speechText)) {
    return { text: speechText, source: "data.speechText" };
  }

  return { text: getCommentText(comment), source: "comment" };
}

function logPrereleaseCommandDiagnostic(
  comment: CommentLike,
  commandInput: { text: string; source: "data.speechText" | "comment" },
  command: ReturnType<typeof parseEducationCommand>,
  currentDictionary: DictionaryFile
): void {
  if (!IS_PRERELEASE || !command) return;
  if (command.type !== "teach" && command.type !== "forget") return;

  console.info("[OneCommeStudyCommand] prerelease command diagnostic", {
    commandType: command.type,
    inputs: {
      dataComment: comment.data?.comment,
      dataSpeechText: comment.data?.speechText
    },
    selectedSource: commandInput.source,
    selectedText: commandInput.text,
    parsedWord: command.word,
    normalizedWord: normalizeDictionaryWord(command.word),
    dictionaryWords:
      command.type === "forget"
        ? currentDictionary.entries.map((entry) => normalizeDictionaryWord(entry.word))
        : undefined
  });
}

function getUserName(userData: UserDataLike): string | undefined {
  if (!userData) return undefined;

  return [userData.name, userData.displayName, userData.userName].find(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}

function setFeedbackText(comment: CommentLike, speechText: string): CommentLike {
  if (!comment.data) {
    comment.data = {};
  }

  comment.data.speechText = speechText;

  return comment;
}

export = plugin;
