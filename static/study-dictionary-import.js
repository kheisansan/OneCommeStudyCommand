(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.StudyDictionaryImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const FILE_NAME = "ReplaceStudy.dic";
  const MAX_FILE_BYTES = 1024 * 1024;
  const MAX_BASE64_LENGTH = 1_398_104;
  const MAX_BODY_LENGTH = 1_400_000;
  const MAX_ROWS = 10_000;
  const MAX_LINE_BYTES = 8 * 1024;
  const MAX_VALUE_CODE_POINTS = 1_000;
  const MAX_ERROR_DETAILS = 100;
  const UTF8_BOM = [0xef, 0xbb, 0xbf];

  function preview(fileName, bytes, existingEntries) {
    if (fileName !== FILE_NAME) return failure("INVALID_FILE_NAME");
    if (!(bytes instanceof Uint8Array)) return failure("INVALID_BODY");
    if (bytes.byteLength > MAX_FILE_BYTES) return failure("FILE_TOO_LARGE");
    if (hasInvalidBom(bytes)) return failure("INVALID_BOM");

    let text;
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
    if (lines.length > MAX_ROWS) return failure("TOO_MANY_ROWS");

    const errors = [];
    const candidates = new Map();
    let mergedDuplicateCount = 0;

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      if (utf8ByteLength(line) > MAX_LINE_BYTES) {
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

      const word = normalizeWord(sourceWord);
      const reading = sourceReading.trim();
      if (sourceWord.length > 0 && word.length === 0) {
        errors.push({ code: "EMPTY_WORD", line: lineNumber });
        valid = false;
      }
      if (sourceReading.length > 0 && reading.length === 0) {
        errors.push({ code: "EMPTY_READING", line: lineNumber });
        valid = false;
      }
      if (Array.from(word).length > MAX_VALUE_CODE_POINTS) {
        errors.push({ code: "WORD_TOO_LONG", line: lineNumber });
        valid = false;
      }
      if (Array.from(reading).length > MAX_VALUE_CODE_POINTS) {
        errors.push({ code: "READING_TOO_LONG", line: lineNumber });
        valid = false;
      }
      if (!valid) return;

      const existing = candidates.get(word);
      if (!existing) {
        candidates.set(word, { word, reading });
      } else if (existing.reading === reading) {
        mergedDuplicateCount += 1;
      } else {
        errors.push({ code: "CONFLICTING_DUPLICATE", line: lineNumber });
      }
    });

    if (errors.length > 0) return failures(errors, lines.length);

    const existingWords = new Set((existingEntries || []).map((entry) => normalizeWord(entry.word)));
    let skippedCount = 0;
    for (const word of candidates.keys()) {
      if (existingWords.has(word)) skippedCount += 1;
    }

    return {
      ok: true,
      sourceRowCount: lines.length,
      candidateCount: candidates.size,
      mergedDuplicateCount,
      addedCount: candidates.size - skippedCount,
      skippedCount
    };
  }

  function validateUploadPayload(fileName, bytes, contentBase64) {
    if (fileName !== FILE_NAME || !(bytes instanceof Uint8Array)) return failure("INVALID_BODY");
    if (bytes.byteLength > MAX_FILE_BYTES) return failure("FILE_TOO_LARGE");
    if (typeof contentBase64 !== "string" || contentBase64.length > MAX_BASE64_LENGTH) {
      return failure("BASE64_TOO_LARGE");
    }

    const body = JSON.stringify({ fileName, contentBase64 });
    if (body.length > MAX_BODY_LENGTH || utf8ByteLength(body) > MAX_BODY_LENGTH) {
      return failure("BODY_TOO_LARGE");
    }
    return { ok: true, body };
  }

  function normalizeWord(value) {
    return String(value ?? "")
      .trim()
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .toLowerCase();
  }

  function hasInvalidBom(bytes) {
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

  function utf8ByteLength(value) {
    return new TextEncoder().encode(value).byteLength;
  }

  function failure(code, line) {
    return failures([{ code, ...(line === undefined ? {} : { line }) }]);
  }

  function failures(errors, sourceRowCount) {
    return {
      ok: false,
      ...(sourceRowCount === undefined ? {} : { sourceRowCount }),
      errorCount: errors.length,
      errors: errors.slice(0, MAX_ERROR_DETAILS),
      truncated: errors.length > MAX_ERROR_DETAILS
    };
  }

  return {
    FILE_NAME,
    MAX_BASE64_LENGTH,
    MAX_BODY_LENGTH,
    MAX_FILE_BYTES,
    preview,
    validateUploadPayload
  };
});
