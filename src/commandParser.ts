import type { EducationCommand } from "./types";

const TEACH_PREFIX = "教育";
const FORGET_PREFIX = "忘却";
const SEARCH_PREFIX = "教育検索(";
const OPEN_PARENTHESIS = new Set(["(", "（"]);
const CLOSE_PARENTHESIS = new Set([")", "）"]);

export function parseEducationCommand(input: string): EducationCommand | null {
  const text = input.trim();

  if (text === "教育一覧") {
    return { type: "list" };
  }

  const teachBody = getCommandBody(text, TEACH_PREFIX);
  if (teachBody !== null) {
    return parseTeach(teachBody);
  }

  const forgetBody = getCommandBody(text, FORGET_PREFIX);
  if (forgetBody !== null) {
    return parseForget(forgetBody);
  }

  if (text.startsWith(SEARCH_PREFIX) && text.endsWith(")")) {
    return parseSearch(text.slice(SEARCH_PREFIX.length, -1));
  }

  return null;
}

function parseTeach(body: string): EducationCommand {
  const separatorIndex = findFirstSeparator(body);

  if (separatorIndex < 0) {
    return { type: "invalid", message: "教育コマンドには = が必要です" };
  }

  const word = body.slice(0, separatorIndex).trim();
  const reading = body.slice(separatorIndex + 1).trim();

  if (!word) {
    return { type: "invalid", message: "単語が空です" };
  }

  if (!reading) {
    return { type: "invalid", message: "読みが空です" };
  }

  return { type: "teach", word, reading };
}

function getCommandBody(text: string, prefix: string): string | null {
  if (!text.startsWith(prefix)) return null;

  const openParenthesis = text[prefix.length];
  const closeParenthesis = text.at(-1);
  if (!OPEN_PARENTHESIS.has(openParenthesis) || !closeParenthesis) return null;
  if (!CLOSE_PARENTHESIS.has(closeParenthesis)) return null;

  return text.slice(prefix.length + 1, -1);
}

function findFirstSeparator(body: string): number {
  const halfWidthIndex = body.indexOf("=");
  const fullWidthIndex = body.indexOf("＝");

  if (halfWidthIndex < 0) return fullWidthIndex;
  if (fullWidthIndex < 0) return halfWidthIndex;
  return Math.min(halfWidthIndex, fullWidthIndex);
}

function parseForget(body: string): EducationCommand {
  const word = body.trim();

  if (!word) {
    return { type: "invalid", message: "忘却する単語が空です" };
  }

  return { type: "forget", word };
}

function parseSearch(body: string): EducationCommand {
  const query = body.trim();

  if (!query) {
    return { type: "invalid", message: "検索語が空です" };
  }

  return { type: "search", query };
}
