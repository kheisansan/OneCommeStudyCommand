/**
 * 教育辞書プラグイン 共有辞書 Google Apps Script
 *
 * セットアップ手順は gas/README.md を参照してください。
 * 1. スプレッドシートの拡張機能 > Apps Script にこのファイルを貼り付ける
 * 2. setupSharedDictionary を一度実行してシートを初期化する
 * 3. ウェブアプリとしてデプロイする (実行ユーザー: 自分 / アクセス: 全員)
 *
 * 入力検査の上限値と正規化ルールは、プラグイン側 (src/sharedDictionary.ts,
 * src/wordNormalizer.ts) と同じ定義にそろえること。
 */

var SHEET_DICTIONARY = "dictionary";
var SHEET_SUBMISSIONS = "submissions";
var SHEET_BLOCKED = "blocked-users";
var SHEET_SETTINGS = "settings";

var DICTIONARY_HEADERS = ["id", "word", "reading", "category", "author", "enabled", "updatedAt"];
var SUBMISSION_HEADERS = [
  "submissionId",
  "type",
  "word",
  "reading",
  "category",
  "authorName",
  "token",
  "status",
  "createdAt",
  "reviewedAt"
];

// SUBMISSION_HEADERS の0始まり列番号
var SUB_ID = 0;
var SUB_TYPE = 1;
var SUB_WORD = 2;
var SUB_READING = 3;
var SUB_CATEGORY = 4;
var SUB_AUTHOR = 5;
var SUB_TOKEN = 6;
var SUB_STATUS = 7;
var SUB_CREATED_AT = 8;
var SUB_REVIEWED_AT = 9;
var BLOCKED_HEADERS = ["token", "note", "blockedAt"];
var SETTINGS_HEADERS = ["key", "value"];

var MAX_WORD_CODE_POINTS = 100;
var MAX_READING_CODE_POINTS = 200;
var MAX_CATEGORY_CODE_POINTS = 50;
var MAX_AUTHOR_CODE_POINTS = 50;
var MAX_SUBMISSION_RECORDS = 50;

var DEFAULT_MAX_SUBMISSIONS_PER_HOUR = 5;
var DEFAULT_MAX_PENDING_TOTAL = 200;

var DICTIONARY_CACHE_KEY = "dictionary-payload";
var DICTIONARY_CACHE_SECONDS = 300;

var FORBIDDEN_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
var TOKEN_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

// ---------------------------------------------------------------------------
// セットアップとメニュー
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("共有辞書管理")
    .addItem("選択行を承認", "approveSelectedSubmissions")
    .addItem("選択行を却下", "rejectSelectedSubmissions")
    .addItem("選択行の投稿者をブロック", "blockSelectedSubmitters")
    .addSeparator()
    .addItem("辞書バージョンを更新 (手動編集の反映)", "bumpDictionaryVersionManually")
    .addItem("シートを初期化", "setupSharedDictionary")
    .addToUi();
}

function setupSharedDictionary() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(spreadsheet, SHEET_DICTIONARY, DICTIONARY_HEADERS);
  var submissions = ensureSheet_(spreadsheet, SHEET_SUBMISSIONS, SUBMISSION_HEADERS);
  ensureSheet_(spreadsheet, SHEET_BLOCKED, BLOCKED_HEADERS);
  var settings = ensureSheet_(spreadsheet, SHEET_SETTINGS, SETTINGS_HEADERS);

  ensureSettingValue_(settings, "dictionaryVersion", 1);
  ensureSettingValue_(settings, "maxSubmissionsPerHour", DEFAULT_MAX_SUBMISSIONS_PER_HOUR);
  ensureSettingValue_(settings, "maxPendingTotal", DEFAULT_MAX_PENDING_TOTAL);

  var statusColumn = SUB_STATUS + 1;
  var statusRange = submissions.getRange(2, statusColumn, submissions.getMaxRows() - 1, 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["pending", "approved", "rejected"], true)
    .setAllowInvalid(false)
    .build();
  statusRange.setDataValidation(rule);

  ensureStatusEditTrigger_();

  SpreadsheetApp.getActiveSpreadsheet().toast("共有辞書のシートを初期化しました", "共有辞書管理");
}

/**
 * submissionsシートのstatusセルを直接 approved / rejected に変えたときに
 * 承認・却下処理を自動実行するためのトリガーを設置する。
 */
function ensureStatusEditTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var index = 0; index < triggers.length; index += 1) {
    if (triggers[index].getHandlerFunction() === "onSubmissionStatusEdit") return;
  }
  ScriptApp.newTrigger("onSubmissionStatusEdit")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
}

function onSubmissionStatusEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_SUBMISSIONS) return;
  if (e.range.getColumn() !== SUB_STATUS + 1 || e.range.getNumColumns() !== 1) return;

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var dictionary = spreadsheet.getSheetByName(SHEET_DICTIONARY);
  if (!dictionary) return;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (error) {
    spreadsheet.toast("処理が混み合っています。もう一度お試しください。", "共有辞書管理");
    return;
  }

  try {
    var approvedCount = 0;
    var reviewedCount = 0;
    for (var row = e.range.getRow(); row <= e.range.getLastRow(); row += 1) {
      if (row <= 1) continue;
      var status = String(sheet.getRange(row, SUB_STATUS + 1).getValue());
      if (status !== "approved" && status !== "rejected") continue;
      var result = processReviewRow_(sheet, dictionary, row, status);
      if (result === "reviewed") {
        reviewedCount += 1;
        if (status === "approved") approvedCount += 1;
      }
    }
    if (approvedCount > 0) {
      bumpDictionaryVersion_();
    }
    if (reviewedCount > 0) {
      spreadsheet.toast("処理しました: " + reviewedCount + "件", "共有辞書管理");
    }
  } finally {
    lock.releaseLock();
  }
}

function ensureSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  var current = headerRange.getValues()[0];
  var needsHeaders = headers.some(function (header, index) {
    return current[index] !== header;
  });
  if (needsHeaders) {
    headerRange.setValues([headers]);
    headerRange.setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureSettingValue_(sheet, key, defaultValue) {
  var values = sheet.getDataRange().getValues();
  for (var row = 1; row < values.length; row += 1) {
    if (values[row][0] === key) return;
  }
  sheet.appendRow([key, defaultValue]);
}

// ---------------------------------------------------------------------------
// Web API
// ---------------------------------------------------------------------------

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "dictionary";
  if (action === "dictionary") {
    return handleGetDictionary_(e);
  }
  if (action === "submissions") {
    return handleGetSubmissions_(e);
  }
  return jsonOutput_({ ok: false, code: "INVALID_ACTION" });
}

function doPost(e) {
  var body = null;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (error) {
    return jsonOutput_({ ok: false, code: "INVALID_BODY" });
  }
  if (!body || body.action !== "submit") {
    return jsonOutput_({ ok: false, code: "INVALID_ACTION" });
  }
  return handleSubmit_(body);
}

function handleGetDictionary_(e) {
  var clientVersion = parseVersionParameter_(e);
  var cache = CacheService.getScriptCache();
  var cached = cache.get(DICTIONARY_CACHE_KEY);
  var payload;
  if (cached) {
    payload = JSON.parse(cached);
  } else {
    payload = buildDictionaryPayload_();
    cache.put(DICTIONARY_CACHE_KEY, JSON.stringify(payload), DICTIONARY_CACHE_SECONDS);
  }

  if (clientVersion !== null && clientVersion === payload.version) {
    return jsonOutput_({ ok: true, version: payload.version, notModified: true });
  }
  return jsonOutput_(payload);
}

function buildDictionaryPayload_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SHEET_DICTIONARY);
  var entries = [];
  if (sheet && sheet.getLastRow() > 1) {
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, DICTIONARY_HEADERS.length).getValues();
    for (var row = 0; row < values.length; row += 1) {
      var record = values[row];
      var enabled = record[5] === true || record[5] === "TRUE" || record[5] === "true";
      if (!enabled) continue;
      var word = normalizeDictionaryWord_(String(record[1]));
      var reading = String(record[2]).trim();
      if (!record[0] || word === "" || reading === "") continue;
      entries.push({
        id: String(record[0]),
        word: word,
        reading: reading,
        category: String(record[3] || ""),
        author: String(record[4] || ""),
        updatedAt: formatTimestamp_(record[6])
      });
    }
  }
  return { ok: true, version: readDictionaryVersion_(), entries: entries };
}

function handleGetSubmissions_(e) {
  var token = e && e.parameter && e.parameter.token;
  if (!token || !TOKEN_PATTERN.test(token)) {
    return jsonOutput_({ ok: false, code: "INVALID_TOKEN" });
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SUBMISSIONS);
  var submissions = [];
  if (sheet && sheet.getLastRow() > 1) {
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, SUBMISSION_HEADERS.length).getValues();
    for (var row = values.length - 1; row >= 0 && submissions.length < MAX_SUBMISSION_RECORDS; row -= 1) {
      var record = values[row];
      if (String(record[SUB_TOKEN]) !== token) continue;
      submissions.push({
        submissionId: String(record[SUB_ID]),
        type: record[SUB_TYPE] === "remove" ? "remove" : "add",
        word: String(record[SUB_WORD]),
        reading: String(record[SUB_READING]),
        category: String(record[SUB_CATEGORY] || ""),
        status: String(record[SUB_STATUS]),
        createdAt: formatTimestamp_(record[SUB_CREATED_AT])
      });
    }
  }
  return jsonOutput_({ ok: true, submissions: submissions });
}

function handleSubmit_(body) {
  var token = typeof body.token === "string" ? body.token : "";
  if (!TOKEN_PATTERN.test(token)) {
    return jsonOutput_({ ok: false, code: "INVALID_TOKEN" });
  }

  var validated = validateSubmission_(body);
  if (validated.code) {
    return jsonOutput_({ ok: false, code: validated.code });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (error) {
    return jsonOutput_({ ok: false, code: "BUSY" });
  }

  try {
    if (isTokenBlocked_(token)) {
      return jsonOutput_({ ok: false, code: "BLOCKED" });
    }
    if (isRateLimited_(token)) {
      return jsonOutput_({ ok: false, code: "RATE_LIMITED" });
    }

    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var submissions = spreadsheet.getSheetByName(SHEET_SUBMISSIONS);
    if (!submissions) {
      return jsonOutput_({ ok: false, code: "NOT_INITIALIZED" });
    }

    var pending = collectPendingSubmissions_(submissions);
    if (pending.count >= readSettingNumber_("maxPendingTotal", DEFAULT_MAX_PENDING_TOTAL)) {
      return jsonOutput_({ ok: false, code: "QUEUE_FULL" });
    }

    var inDictionary = isWordInDictionary_(validated.word);
    if (validated.type === "add") {
      if (pending.addWords[validated.word] || inDictionary) {
        return jsonOutput_({ ok: false, code: "DUPLICATE" });
      }
    } else {
      if (!inDictionary) {
        return jsonOutput_({ ok: false, code: "NOT_FOUND" });
      }
      if (pending.removeWords[validated.word]) {
        return jsonOutput_({ ok: false, code: "DUPLICATE" });
      }
    }

    var submissionId = Utilities.getUuid();
    submissions.appendRow([
      submissionId,
      validated.type,
      validated.word,
      validated.reading,
      validated.category,
      validated.authorName,
      token,
      "pending",
      new Date().toISOString(),
      ""
    ]);
    countSubmission_(token);
    return jsonOutput_({ ok: true, submissionId: submissionId, status: "pending" });
  } finally {
    lock.releaseLock();
  }
}

function validateSubmission_(body) {
  var type = body.type === "remove" ? "remove" : body.type === "add" || body.type === undefined ? "add" : null;
  if (type === null) return { code: "INVALID_BODY" };

  var rawWord = typeof body.word === "string" ? body.word : "";
  var rawReading = typeof body.reading === "string" ? body.reading : "";
  var rawCategory = typeof body.category === "string" ? body.category : "";
  var rawAuthor = typeof body.authorName === "string" ? body.authorName : "";

  if (FORBIDDEN_CHARACTERS.test(rawWord)) return { code: "INVALID_WORD" };
  if (FORBIDDEN_CHARACTERS.test(rawReading)) return { code: "INVALID_READING" };
  if (FORBIDDEN_CHARACTERS.test(rawCategory)) return { code: "INVALID_CATEGORY" };
  if (FORBIDDEN_CHARACTERS.test(rawAuthor)) return { code: "INVALID_AUTHOR" };

  var word = normalizeDictionaryWord_(rawWord);
  var reading = type === "remove" ? "" : rawReading.trim();
  var category = collapseWhitespace_(rawCategory);
  var authorName = collapseWhitespace_(rawAuthor);

  if (word === "" || codePointLength_(word) > MAX_WORD_CODE_POINTS) {
    return { code: "INVALID_WORD" };
  }
  if (type === "add" && (reading === "" || codePointLength_(reading) > MAX_READING_CODE_POINTS)) {
    return { code: "INVALID_READING" };
  }
  if (codePointLength_(category) > MAX_CATEGORY_CODE_POINTS) {
    return { code: "INVALID_CATEGORY" };
  }
  if (codePointLength_(authorName) > MAX_AUTHOR_CODE_POINTS) {
    return { code: "INVALID_AUTHOR" };
  }

  return { type: type, word: word, reading: reading, category: category, authorName: authorName };
}

function collectPendingSubmissions_(submissions) {
  var addWords = {};
  var removeWords = {};
  var count = 0;
  if (submissions.getLastRow() > 1) {
    var values = submissions
      .getRange(2, 1, submissions.getLastRow() - 1, SUBMISSION_HEADERS.length)
      .getValues();
    for (var row = 0; row < values.length; row += 1) {
      if (String(values[row][SUB_STATUS]) !== "pending") continue;
      count += 1;
      var word = normalizeDictionaryWord_(String(values[row][SUB_WORD]));
      if (values[row][SUB_TYPE] === "remove") {
        removeWords[word] = true;
      } else {
        addWords[word] = true;
      }
    }
  }
  return { addWords: addWords, removeWords: removeWords, count: count };
}

function isWordInDictionary_(word) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DICTIONARY);
  if (!sheet || sheet.getLastRow() <= 1) return false;
  var values = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
  for (var row = 0; row < values.length; row += 1) {
    if (normalizeDictionaryWord_(String(values[row][0])) === word) return true;
  }
  return false;
}

function isTokenBlocked_(token) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_BLOCKED);
  if (!sheet || sheet.getLastRow() <= 1) return false;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var row = 0; row < values.length; row += 1) {
    if (String(values[row][0]) === token) return true;
  }
  return false;
}

function isRateLimited_(token) {
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get("rate:" + token) || 0);
  return count >= readSettingNumber_("maxSubmissionsPerHour", DEFAULT_MAX_SUBMISSIONS_PER_HOUR);
}

function countSubmission_(token) {
  var cache = CacheService.getScriptCache();
  var key = "rate:" + token;
  var count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 3600);
}

// ---------------------------------------------------------------------------
// 承認・却下・ブロック (スプレッドシートのメニューから実行)
// ---------------------------------------------------------------------------

function approveSelectedSubmissions() {
  reviewSelectedSubmissions_("approved");
}

function rejectSelectedSubmissions() {
  reviewSelectedSubmissions_("rejected");
}

function reviewSelectedSubmissions_(nextStatus) {
  var ui = SpreadsheetApp.getUi();
  var selection = getSelectedSubmissionRows_(ui);
  if (!selection) return;

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var submissions = selection.sheet;
  var dictionary = spreadsheet.getSheetByName(SHEET_DICTIONARY);
  if (!dictionary) {
    ui.alert("dictionaryシートがありません。「シートを初期化」を実行してください。");
    return;
  }

  var reviewed = 0;
  var skipped = 0;

  for (var index = 0; index < selection.rows.length; index += 1) {
    var result = processReviewRow_(submissions, dictionary, selection.rows[index], nextStatus);
    if (result === "reviewed") {
      reviewed += 1;
    } else {
      skipped += 1;
    }
  }

  if (reviewed > 0 && nextStatus === "approved") {
    bumpDictionaryVersion_();
  }

  var statusLabel = nextStatus === "approved" ? "承認" : "却下";
  ui.alert(statusLabel + ": " + reviewed + "件 / スキップ (処理済み): " + skipped + "件");
}

/**
 * 1件の申請を処理する。処理済み (reviewedAtあり) の行はスキップする。
 * 承認時: type=add は辞書へ追加、type=remove は辞書から該当単語の行を削除する。
 */
function processReviewRow_(submissions, dictionary, rowNumber, nextStatus) {
  var record = submissions
    .getRange(rowNumber, 1, 1, SUBMISSION_HEADERS.length)
    .getValues()[0];
  if (String(record[SUB_REVIEWED_AT] || "") !== "") {
    return "skipped";
  }

  var now = new Date().toISOString();
  var word = normalizeDictionaryWord_(String(record[SUB_WORD]));

  if (nextStatus === "approved") {
    if (record[SUB_TYPE] === "remove") {
      removeDictionaryRows_(dictionary, word);
    } else {
      dictionary.appendRow([
        String(record[SUB_ID]),
        word,
        String(record[SUB_READING]),
        String(record[SUB_CATEGORY] || ""),
        String(record[SUB_AUTHOR] || ""),
        true,
        now
      ]);
    }
  }

  submissions.getRange(rowNumber, SUB_STATUS + 1).setValue(nextStatus);
  submissions.getRange(rowNumber, SUB_REVIEWED_AT + 1).setValue(now);
  return "reviewed";
}

function removeDictionaryRows_(dictionary, word) {
  if (dictionary.getLastRow() <= 1) return 0;
  var values = dictionary.getRange(2, 2, dictionary.getLastRow() - 1, 1).getValues();
  var removed = 0;
  for (var row = values.length - 1; row >= 0; row -= 1) {
    if (normalizeDictionaryWord_(String(values[row][0])) === word) {
      dictionary.deleteRow(row + 2);
      removed += 1;
    }
  }
  return removed;
}

function blockSelectedSubmitters() {
  var ui = SpreadsheetApp.getUi();
  var selection = getSelectedSubmissionRows_(ui);
  if (!selection) return;

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var blocked = spreadsheet.getSheetByName(SHEET_BLOCKED);
  if (!blocked) {
    ui.alert(SHEET_BLOCKED + "シートがありません。「シートを初期化」を実行してください。");
    return;
  }

  var now = new Date().toISOString();
  var added = 0;
  for (var index = 0; index < selection.rows.length; index += 1) {
    var record = selection.sheet
      .getRange(selection.rows[index], 1, 1, SUBMISSION_HEADERS.length)
      .getValues()[0];
    var token = String(record[SUB_TOKEN]);
    if (!token || isTokenBlocked_(token)) continue;
    blocked.appendRow([token, "submission: " + String(record[SUB_ID]), now]);
    added += 1;
  }
  ui.alert("ブロックした投稿者: " + added + "件");
}

function getSelectedSubmissionRows_(ui) {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== SHEET_SUBMISSIONS) {
    ui.alert(SHEET_SUBMISSIONS + "シートで行を選択してから実行してください。");
    return null;
  }

  var rangeList = SpreadsheetApp.getActiveRangeList();
  if (!rangeList) {
    ui.alert("対象の行を選択してから実行してください。");
    return null;
  }

  var rows = {};
  var ranges = rangeList.getRanges();
  for (var index = 0; index < ranges.length; index += 1) {
    var range = ranges[index];
    for (var row = range.getRow(); row <= range.getLastRow(); row += 1) {
      if (row > 1) rows[row] = true;
    }
  }

  var rowNumbers = Object.keys(rows)
    .map(function (value) {
      return Number(value);
    })
    .sort(function (left, right) {
      return left - right;
    });
  if (rowNumbers.length === 0) {
    ui.alert("ヘッダー行以外の行を選択してください。");
    return null;
  }
  return { sheet: sheet, rows: rowNumbers };
}

function bumpDictionaryVersionManually() {
  bumpDictionaryVersion_();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "辞書バージョンを更新しました。プラグイン側の次回取得から反映されます。",
    "共有辞書管理"
  );
}

// ---------------------------------------------------------------------------
// 共通処理
// ---------------------------------------------------------------------------

function bumpDictionaryVersion_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS);
  if (!sheet) return;
  var values = sheet.getDataRange().getValues();
  for (var row = 1; row < values.length; row += 1) {
    if (values[row][0] === "dictionaryVersion") {
      var next = Number(values[row][1] || 0) + 1;
      sheet.getRange(row + 1, 2).setValue(next);
      CacheService.getScriptCache().remove(DICTIONARY_CACHE_KEY);
      return;
    }
  }
  sheet.appendRow(["dictionaryVersion", 1]);
  CacheService.getScriptCache().remove(DICTIONARY_CACHE_KEY);
}

function readDictionaryVersion_() {
  return readSettingNumber_("dictionaryVersion", 1);
}

function readSettingNumber_(key, defaultValue) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS);
  if (!sheet) return defaultValue;
  var values = sheet.getDataRange().getValues();
  for (var row = 1; row < values.length; row += 1) {
    if (values[row][0] === key) {
      var value = Number(values[row][1]);
      return isFinite(value) && value >= 0 ? value : defaultValue;
    }
  }
  return defaultValue;
}

function parseVersionParameter_(e) {
  var raw = e && e.parameter && e.parameter.version;
  if (!raw || !/^[0-9]+$/.test(raw)) return null;
  return Number(raw);
}

/** プラグイン側 normalizeDictionaryWord (src/wordNormalizer.ts) と同じ正規化 */
function normalizeDictionaryWord_(value) {
  return collapseWhitespace_(String(value).normalize("NFKC")).toLowerCase();
}

function collapseWhitespace_(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function codePointLength_(value) {
  var length = 0;
  for (var index = 0; index < value.length; index += 1) {
    var code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      index += 1;
    }
    length += 1;
  }
  return length;
}

function formatTimestamp_(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || "");
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
