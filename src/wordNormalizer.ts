export function normalizeDictionaryWord(value: string): string {
  return normalizeForDictionaryMatch(value.trim());
}

export function normalizeForDictionaryMatch(value: string): string {
  return normalizeWhitespace(value.normalize("NFKC")).toLowerCase();
}

export function normalizeSpeechText(value: string): string {
  return normalizeWhitespace(value.normalize("NFKC"));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ");
}
