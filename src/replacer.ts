import type { DictionaryEntry } from "./types";
import {
  normalizeDictionaryWord,
  normalizeForDictionaryMatch,
  normalizeSpeechText
} from "./wordNormalizer";

export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
  return getReplacementEntries(entries).reduce((result, entry) => {
    return result.replace(createWordPattern(entry.word), entry.reading);
  }, normalizeSpeechText(text));
}

export function applyDictionaryWithMaskedFallback(
  processedText: string,
  originalText: string,
  entries: DictionaryEntry[]
): string {
  const normalizedProcessedText = normalizeSpeechText(processedText);
  const normalizedOriginalText = normalizeForDictionaryMatch(originalText);

  return getReplacementEntries(entries).reduce((result, entry) => {
    const word = normalizeDictionaryWord(entry.word);
    const originalCount = countOccurrences(normalizedOriginalText, word);
    const processedCount = countPatternOccurrences(normalizedProcessedText, createWordPattern(word));
    const exactReplaced = result.replace(createWordPattern(word), entry.reading);
    let missingCount = Math.max(0, originalCount - processedCount);
    if (missingCount === 0) return exactReplaced;

    return exactReplaced.replace(createMaskedWordPattern(word), (matched) => {
      if (missingCount === 0 || !matched.includes("*")) return matched;
      missingCount -= 1;
      return entry.reading;
    });
  }, normalizedProcessedText);
}

export function getMatchingDictionaryWords(
  text: string,
  entries: DictionaryEntry[]
): string[] {
  const normalizedText = normalizeForDictionaryMatch(text);
  const matchingWords = getReplacementEntries(entries)
    .map((entry) => normalizeDictionaryWord(entry.word))
    .filter((word) => normalizedText.includes(word));

  return [...new Set(matchingWords)];
}

export function getReplacementEntries(entries: DictionaryEntry[]): DictionaryEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.enabled && normalizeDictionaryWord(entry.word).length > 0)
    .sort((left, right) => {
      const priority = right.entry.priority - left.entry.priority;
      if (priority !== 0) return priority;

      const wordLength =
        Array.from(normalizeDictionaryWord(right.entry.word)).length -
        Array.from(normalizeDictionaryWord(left.entry.word)).length;
      if (wordLength !== 0) return wordLength;

      const updatedAt = left.entry.updatedAt.localeCompare(right.entry.updatedAt);
      if (updatedAt !== 0) return updatedAt;

      return left.index - right.index;
    })
    .map(({ entry }) => entry);
}

function countOccurrences(text: string, word: string): number {
  if (!word) return 0;
  return text.split(word).length - 1;
}

function countPatternOccurrences(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function createWordPattern(word: string): RegExp {
  return new RegExp(escapeRegExp(normalizeDictionaryWord(word)), "giu");
}

function createMaskedWordPattern(word: string): RegExp {
  const pattern = Array.from(word)
    .map((character) => {
      const escaped = escapeRegExp(character);
      return character === "*" ? "\\*" : `(?:${escaped}|\\*)`;
    })
    .join("");

  return new RegExp(pattern, "giu");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
