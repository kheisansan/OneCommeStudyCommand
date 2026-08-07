const PLUGIN_UID = "games.tang-chao.study-command";
const API_URL = `http://localhost:11180/api/plugins/${PLUGIN_UID}`;
const stateApi = window.ManagementState;
const studyImportApi = window.StudyDictionaryImport;
const sharedApi = window.SharedDictionaryState;

const statusElement = document.getElementById("status");
const reloadButton = document.getElementById("reloadButton");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const educationCommandEnabled = document.getElementById("educationCommandEnabled");
const forgetCommandEnabled = document.getElementById("forgetCommandEnabled");
const sharedEducationCommandEnabled = document.getElementById("sharedEducationCommandEnabled");
const sharedForgetCommandEnabled = document.getElementById("sharedForgetCommandEnabled");
const settingsState = document.getElementById("settingsState");
const addEntryForm = document.getElementById("addEntryForm");
const addEntryButton = document.getElementById("addEntryButton");
const entryWord = document.getElementById("entryWord");
const entryReading = document.getElementById("entryReading");
const entryCount = document.getElementById("entryCount");
const entriesBody = document.getElementById("entriesBody");
const studyDictionaryFile = document.getElementById("studyDictionaryFile");
const importStudyDictionaryButton = document.getElementById("importStudyDictionaryButton");
const importAvailability = document.getElementById("importAvailability");
const importPreview = document.getElementById("importPreview");
const importCompletedResult = document.getElementById("importCompletedResult");
const sharedEndpointUrl = document.getElementById("sharedEndpointUrl");
const saveSharedEndpointButton = document.getElementById("saveSharedEndpointButton");
const sharedDictionaryBody = document.getElementById("sharedDictionaryBody");
const fetchSharedButton = document.getElementById("fetchSharedButton");
const sharedFetchState = document.getElementById("sharedFetchState");
const sharedSelectAll = document.getElementById("sharedSelectAll");
const sharedEntriesBody = document.getElementById("sharedEntriesBody");
const importSharedButton = document.getElementById("importSharedButton");
const sharedSelectionCount = document.getElementById("sharedSelectionCount");
const sharedImportResult = document.getElementById("sharedImportResult");
const sharedSubmitForm = document.getElementById("sharedSubmitForm");
const sharedSubmitWord = document.getElementById("sharedSubmitWord");
const sharedSubmitReading = document.getElementById("sharedSubmitReading");
const sharedSubmitCategory = document.getElementById("sharedSubmitCategory");
const sharedSubmitAuthor = document.getElementById("sharedSubmitAuthor");
const sharedSubmitButton = document.getElementById("sharedSubmitButton");
const refreshSubmissionsButton = document.getElementById("refreshSubmissionsButton");
const sharedSubmissionsBody = document.getElementById("sharedSubmissionsBody");

let state = stateApi.createManagementState();
let sharedState = sharedApi.createSharedDictionaryState();
let savingPriorityWord = null;
let hasDictionaryBaseline = false;
let selectedStudyDictionary = null;
let fileSelectionVersion = 0;
let sharedEndpointDraft = null;

reloadButton.addEventListener("click", loadManagementData);
saveSettingsButton.addEventListener("click", saveSettings);
educationCommandEnabled.addEventListener("change", updateCurrentSettings);
forgetCommandEnabled.addEventListener("change", updateCurrentSettings);
sharedEducationCommandEnabled.addEventListener("change", updateCurrentSettings);
sharedForgetCommandEnabled.addEventListener("change", updateCurrentSettings);
addEntryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addEntry();
});
studyDictionaryFile.addEventListener("change", selectStudyDictionary);
importStudyDictionaryButton.addEventListener("click", confirmAndImportStudyDictionary);
sharedEndpointUrl.addEventListener("input", () => {
  sharedEndpointDraft = sharedEndpointUrl.value;
});
saveSharedEndpointButton.addEventListener("click", saveSharedEndpoint);
fetchSharedButton.addEventListener("click", () => fetchSharedDictionary(true));
sharedSelectAll.addEventListener("change", toggleAllSharedSelection);
importSharedButton.addEventListener("click", confirmAndImportSharedEntries);
sharedSubmitForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitSharedEntry();
});
refreshSubmissionsButton.addEventListener("click", refreshSharedSubmissions);

loadManagementData();

async function loadManagementData() {
  try {
    const data = await requestManagementData({}, "読み込み中");
    if (!data) return;
    applyManagementData(data);
    renderAll();
    setStatus("表示中");
  } catch (error) {
    reportError(error, "読み込みに失敗しました");
    return;
  }

  if (sharedState.settings.endpointUrl && !sharedState.cache) {
    await fetchSharedDictionary(false);
  }
}

async function saveSettings() {
  if (!stateApi.isSettingsDirty(state) || !state.currentSettings) return;

  try {
    const data = await requestManagementData(
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: state.currentSettings })
      },
      "保存中"
    );
    if (!data) return;
    applyManagementData(data, { adoptSettings: true });
    renderAll();
    setStatus("保存しました");
  } catch (error) {
    reportError(error, "保存に失敗しました");
  }
}

async function addEntry() {
  try {
    const response = await requestManagementData(
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: entryWord.value, reading: entryReading.value })
      },
      "追加中"
    );
    if (!response) return;
    applyManagementData(response);
    addEntryForm.reset();
    renderAll();
    setStatus("追加しました");
  } catch (error) {
    if (error.status === 409) {
      setStatus("同じ単語がすでに登録されています");
      return;
    }
    reportError(error, "追加に失敗しました");
  }
}

async function savePriority(word) {
  const key = stateApi.normalizeWord(word);
  const draft = state.priorityDrafts.get(key);
  if (!draft) return;
  const priority = stateApi.parsePriority(draft.value);
  if (priority === null) {
    state = stateApi.setPriorityError(state, word, "1以上の整数を入力してください");
    renderEntries();
    return;
  }

  savingPriorityWord = key;
  updateControls();
  try {
    const data = await requestManagementData(
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, priority })
      },
      "優先度を保存中"
    );
    if (!data) return;
    applyManagementData(data);
    setStatus("優先度を保存しました");
  } catch (error) {
    state = stateApi.setPriorityError(state, word, "保存に失敗しました");
    reportError(error, "優先度の保存に失敗しました");
  } finally {
    savingPriorityWord = null;
    renderAll();
  }
}

async function confirmAndDeleteEntry(word) {
  if (state.requestLocked) return;
  if (!window.confirm(`「${word}」を削除しますか？`)) return;
  if (state.requestLocked) return;

  try {
    const data = await requestManagementData(
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word })
      },
      "削除中"
    );
    if (!data) return;
    applyManagementData(data);
    renderAll();
    setStatus("削除しました");
  } catch (error) {
    reportError(error, "削除に失敗しました");
  }
}

async function selectStudyDictionary() {
  const selectionVersion = ++fileSelectionVersion;
  importCompletedResult.hidden = true;
  const file = studyDictionaryFile.files?.[0];
  if (!file || !hasDictionaryBaseline) {
    selectedStudyDictionary = null;
    renderStudyImport();
    return;
  }

  try {
    setStatus("辞書ファイルを確認中");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (selectionVersion !== fileSelectionVersion) return;
    selectedStudyDictionary = {
      fileName: file.name,
      bytes,
      preview: studyImportApi.preview(file.name, bytes, state.entries)
    };
    renderStudyImport();
    setStatus(selectedStudyDictionary.preview.ok ? "インポート内容を確認してください" : "辞書ファイルにエラーがあります");
  } catch (error) {
    if (selectionVersion !== fileSelectionVersion) return;
    selectedStudyDictionary = null;
    reportError(error, "辞書ファイルを読み込めませんでした");
    renderStudyImport();
  }
}

async function confirmAndImportStudyDictionary() {
  if (state.requestLocked || !selectedStudyDictionary?.preview.ok) return;
  const expected = selectedStudyDictionary.preview;
  if (
    !window.confirm(
      `「${selectedStudyDictionary.fileName}」から${expected.addedCount}件を追加しますか？\n` +
        "追加件数は保存時の辞書によって変わる場合があります。"
    )
  ) {
    return;
  }
  if (state.requestLocked || !selectedStudyDictionary?.preview.ok) return;

  try {
    const contentBase64 = bytesToBase64(selectedStudyDictionary.bytes);
    const upload = studyImportApi.validateUploadPayload(
      selectedStudyDictionary.fileName,
      selectedStudyDictionary.bytes,
      contentBase64
    );
    if (!upload.ok) {
      selectedStudyDictionary.preview = upload;
      renderStudyImport();
      return;
    }

    const data = await requestManagementData(
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: upload.body
      },
      "インポート中"
    );
    if (!data) return;
    if (!isImportResult(data.importResult)) throw new Error("Invalid import response");

    applyManagementData(data);
    const result = data.importResult;
    selectedStudyDictionary = null;
    fileSelectionVersion += 1;
    studyDictionaryFile.value = "";
    renderAll();
    renderCompletedImportResult(result);
    setStatus("インポートしました");
  } catch (error) {
    if (error.payload?.message === "Invalid study dictionary") {
      selectedStudyDictionary.preview = error.payload;
      renderStudyImport();
    }
    reportError(error, "インポートに失敗しました");
  }
}

async function requestManagementData(options, busyStatus) {
  try {
    const result = await stateApi.runLockedRequest(state, async () => {
      setStatus(busyStatus);
      updateControls();
      const response = await fetch(API_URL, options);
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(`API error: ${response.status}`);
        error.status = response.status;
        error.payload = payload?.response ?? payload;
        throw error;
      }
      const data = getManagementData(payload);
      if (!data) throw new Error("Invalid API response");
      return data;
    });
    return result.started ? result.value : null;
  } finally {
    updateControls();
  }
}

function renderAll() {
  renderSettings();
  renderEntries();
  renderStudyImport();
  renderSharedDictionary();
  updateControls();
}

function applyManagementData(data, options) {
  state = stateApi.applyManagementData(state, data, options);
  hasDictionaryBaseline = true;
  if (data.sharedDictionary !== undefined) {
    sharedState = sharedApi.applySharedData(sharedState, data.sharedDictionary, state.entries);
  } else {
    // 辞書だけが変わった場合も取り込み済み判定を更新する
    sharedState = sharedApi.applySharedData(sharedState, sharedState, state.entries);
  }
  if (selectedStudyDictionary) {
    selectedStudyDictionary.preview = studyImportApi.preview(
      selectedStudyDictionary.fileName,
      selectedStudyDictionary.bytes,
      state.entries
    );
  }
}

function renderStudyImport() {
  importAvailability.textContent = hasDictionaryBaseline
    ? "表示中の辞書を基準にした見込みです。保存時に最新の辞書で再判定します。"
    : "現在の辞書を読み込むまで選択できません。";
  importPreview.replaceChildren();
  importPreview.hidden = !selectedStudyDictionary;
  importPreview.classList.toggle(
    "import-result-error",
    Boolean(selectedStudyDictionary && !selectedStudyDictionary.preview.ok)
  );
  if (!selectedStudyDictionary) {
    updateControls();
    return;
  }

  const preview = selectedStudyDictionary.preview;
  const heading = document.createElement("p");
  heading.textContent = selectedStudyDictionary.fileName;
  importPreview.append(heading);

  const summary = document.createElement("ul");
  summary.className = "import-summary";
  const values = preview.ok
    ? [
        ["読込行", preview.sourceRowCount],
        ["追加予定", preview.addedCount],
        ["重複統合", preview.mergedDuplicateCount],
        ["既存スキップ", preview.skippedCount],
        ["エラー", 0]
      ]
    : [
        ["読込行", preview.sourceRowCount ?? "-"],
        ["追加予定", "-"],
        ["重複統合", "-"],
        ["既存スキップ", "-"],
        ["エラー", preview.errorCount]
      ];
  for (const [label, value] of values) {
    const item = document.createElement("li");
    item.textContent = `${label}: ${value}件`;
    summary.append(item);
  }
  importPreview.append(summary);

  if (!preview.ok) {
    const errors = document.createElement("ul");
    errors.className = "import-errors";
    for (const error of preview.errors || []) {
      const item = document.createElement("li");
      item.textContent = formatImportError(error);
      errors.append(item);
    }
    if (preview.truncated) {
      const item = document.createElement("li");
      item.textContent = "エラー詳細は先頭100件まで表示しています。";
      errors.append(item);
    }
    importPreview.append(errors);
  }
  updateControls();
}

function renderCompletedImportResult(result) {
  importCompletedResult.replaceChildren();
  const heading = document.createElement("p");
  heading.textContent = "インポート結果";
  const summary = document.createElement("ul");
  summary.className = "import-summary";
  for (const [label, value] of [
    ["読込行", result.sourceRowCount],
    ["候補", result.candidateCount],
    ["重複統合", result.mergedDuplicateCount],
    ["追加", result.addedCount],
    ["既存スキップ", result.skippedCount]
  ]) {
    const item = document.createElement("li");
    item.textContent = `${label}: ${value}件`;
    summary.append(item);
  }
  importCompletedResult.append(heading, summary);
  importCompletedResult.hidden = false;
}

async function sharedRequest(body, busyStatus) {
  return requestManagementData(
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sharedDictionary: body })
    },
    busyStatus
  );
}

async function saveSharedEndpoint() {
  try {
    const endpointUrl = sharedEndpointUrl.value.trim();
    const data = await sharedRequest(
      { action: "configure", endpointUrl: endpointUrl === "" ? null : endpointUrl },
      "共有辞書の設定を保存中"
    );
    if (!data) return;
    applyManagementData(data);
    sharedEndpointDraft = null;
    renderAll();
    setStatus(endpointUrl === "" ? "共有辞書の設定を解除しました" : "共有辞書の設定を保存しました");
    if (endpointUrl !== "") await fetchSharedDictionary(false);
  } catch (error) {
    reportSharedError(error, "共有辞書の設定に失敗しました");
  }
}

async function fetchSharedDictionary(force) {
  try {
    const data = await sharedRequest({ action: "fetch", force }, "共有辞書を取得中");
    if (!data) return;
    applyManagementData(data);
    renderAll();
    setStatus(data.sharedFetch?.source === "cache" ? "共有辞書を表示中" : "共有辞書を取得しました");
  } catch (error) {
    reportSharedError(error, "共有辞書の取得に失敗しました");
    renderAll();
  }
}

function toggleAllSharedSelection() {
  const importable = sharedApi.importableIds(sharedState.cache, state.entries);
  sharedState = sharedApi.setAllSelected(sharedState, importable, sharedSelectAll.checked);
  renderSharedDictionary();
  updateControls();
}

async function confirmAndImportSharedEntries() {
  if (state.requestLocked || sharedState.selectedIds.size === 0) return;
  const count = sharedState.selectedIds.size;
  if (!window.confirm(`選択した${count}件を教育辞書へ取り込みますか？`)) return;
  if (state.requestLocked || sharedState.selectedIds.size === 0) return;

  try {
    const data = await sharedRequest(
      { action: "import", ids: [...sharedState.selectedIds] },
      "取り込み中"
    );
    if (!data) return;
    applyManagementData(data);
    renderAll();
    renderSharedImportResult(data.sharedImportResult);
    setStatus("共有辞書から取り込みました");
  } catch (error) {
    reportSharedError(error, "取り込みに失敗しました");
  }
}

async function submitSharedEntry() {
  try {
    const data = await sharedRequest(
      {
        action: "submit",
        word: sharedSubmitWord.value,
        reading: sharedSubmitReading.value,
        category: sharedSubmitCategory.value,
        authorName: sharedSubmitAuthor.value
      },
      "投稿中"
    );
    if (!data) return;
    applyManagementData(data);
    sharedSubmitWord.value = "";
    sharedSubmitReading.value = "";
    sharedSubmitCategory.value = "";
    renderAll();
    setStatus("投稿しました。オーナーの承認をお待ちください");
  } catch (error) {
    reportSharedError(error, "投稿に失敗しました");
  }
}

async function refreshSharedSubmissions() {
  try {
    const data = await sharedRequest({ action: "refreshSubmissions" }, "投稿状況を確認中");
    if (!data) return;
    applyManagementData(data);
    renderAll();
    setStatus("投稿状況を更新しました");
  } catch (error) {
    reportSharedError(error, "投稿状況の取得に失敗しました");
  }
}

function renderSharedDictionary() {
  if (sharedEndpointDraft === null) {
    sharedEndpointUrl.value = sharedState.settings.endpointUrl ?? "";
  }
  sharedDictionaryBody.hidden = !sharedState.settings.endpointUrl;
  renderSharedFetchState();
  renderSharedEntries();
  renderSharedSubmissions();
}

function renderSharedFetchState() {
  if (!sharedState.cache) {
    sharedFetchState.textContent = "未取得";
    return;
  }
  const fetchedAt = formatDate(sharedState.cache.fetchedAt);
  sharedFetchState.textContent =
    `${sharedState.cache.entries.length}件 / バージョン${sharedState.cache.version} / 取得: ${fetchedAt}`;
}

function renderSharedEntries() {
  sharedEntriesBody.replaceChildren();

  if (!sharedState.cache || sharedState.cache.entries.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty";
    cell.colSpan = 7;
    cell.textContent = sharedState.cache ? "共有辞書は空です" : "共有辞書を取得していません";
    row.append(cell);
    sharedEntriesBody.append(row);
    updateSharedSelectionSummary();
    return;
  }

  for (const entry of sharedState.cache.entries) {
    const imported = sharedApi.isImported(entry, state.entries);
    const row = document.createElement("tr");

    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.sharedSelect = entry.id;
    checkbox.checked = sharedState.selectedIds.has(entry.id);
    checkbox.disabled = imported || state.requestLocked;
    checkbox.setAttribute("aria-label", `${entry.word}を選択`);
    checkbox.addEventListener("change", () => {
      sharedState = sharedApi.toggleSelected(sharedState, entry.id, checkbox.checked);
      updateSharedSelectionSummary();
      updateControls();
    });
    selectCell.append(checkbox);

    const statusCell = document.createElement("td");
    statusCell.textContent = imported ? "取り込み済み" : "未取り込み";
    if (imported) statusCell.className = "shared-imported";

    row.append(
      selectCell,
      createCell(entry.word),
      createCell(entry.reading),
      createCell(entry.category || "-"),
      createCell(entry.author || "-"),
      createCell(formatDate(entry.updatedAt)),
      statusCell
    );
    sharedEntriesBody.append(row);
  }
  updateSharedSelectionSummary();
}

function updateSharedSelectionSummary() {
  sharedSelectionCount.textContent = `${sharedState.selectedIds.size}件選択中`;
  const importable = sharedApi.importableIds(sharedState.cache, state.entries);
  sharedSelectAll.checked =
    importable.length > 0 && importable.every((id) => sharedState.selectedIds.has(id));
  sharedSelectAll.disabled = importable.length === 0 || state.requestLocked;
  importSharedButton.disabled = state.requestLocked || sharedState.selectedIds.size === 0;
}

function renderSharedSubmissions() {
  sharedSubmissionsBody.replaceChildren();

  if (sharedState.submissions.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty";
    cell.colSpan = 6;
    cell.textContent = "投稿はありません";
    row.append(cell);
    sharedSubmissionsBody.append(row);
    return;
  }

  for (const submission of sharedState.submissions) {
    const row = document.createElement("tr");
    const statusCell = document.createElement("td");
    statusCell.textContent = sharedApi.submissionStatusLabel(submission.status);
    statusCell.className = `shared-status-${submission.status}`;
    row.append(
      createCell(sharedApi.submissionTypeLabel(submission.type)),
      createCell(submission.word),
      createCell(submission.reading || "-"),
      createCell(submission.category || "-"),
      statusCell,
      createCell(formatDate(submission.submittedAt))
    );
    sharedSubmissionsBody.append(row);
  }
}

function renderSharedImportResult(result) {
  sharedImportResult.replaceChildren();
  if (!result) return;
  const heading = document.createElement("p");
  heading.textContent = "取り込み結果";
  const summary = document.createElement("ul");
  summary.className = "import-summary";
  for (const [label, value] of [
    ["追加", result.addedCount],
    ["既存スキップ", result.skippedCount],
    ["対象なし", result.missingCount]
  ]) {
    const item = document.createElement("li");
    item.textContent = `${label}: ${value}件`;
    summary.append(item);
  }
  sharedImportResult.append(heading, summary);
  sharedImportResult.hidden = false;
}

function reportSharedError(error, fallbackMessage) {
  console.error(error);
  const sharedError = error?.payload?.sharedError;
  setStatus(sharedError ? sharedApi.sharedErrorMessage(sharedError) : fallbackMessage);
}

function renderSettings() {
  if (!state.currentSettings) return;
  educationCommandEnabled.checked = state.currentSettings.educationCommandEnabled;
  forgetCommandEnabled.checked = state.currentSettings.forgetCommandEnabled;
  sharedEducationCommandEnabled.checked = state.currentSettings.sharedEducationCommandEnabled;
  sharedForgetCommandEnabled.checked = state.currentSettings.sharedForgetCommandEnabled;
  updateSettingsState();
}

function renderEntries() {
  entryCount.textContent = `${state.entries.length}件`;
  entriesBody.replaceChildren();

  if (state.entries.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty";
    cell.colSpan = 7;
    cell.textContent = "登録はありません";
    row.append(cell);
    entriesBody.append(row);
    return;
  }

  for (const entry of state.entries) {
    const row = document.createElement("tr");
    row.append(
      createCell(entry.word),
      createCell(entry.reading),
      createPriorityCell(entry),
      createCell(entry.createdBy || "-"),
      createCell(formatDate(entry.createdAt)),
      createCell(formatDate(entry.updatedAt)),
      createActionsCell(entry)
    );
    entriesBody.append(row);
  }
}

function createPriorityCell(entry) {
  const key = stateApi.normalizeWord(entry.word);
  const draft = state.priorityDrafts.get(key);
  const cell = document.createElement("td");
  const editor = document.createElement("div");
  editor.className = "priority-editor";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.step = "1";
  input.className = "priority-input";
  input.value = draft?.value ?? String(entry.priority);
  input.dataset.priorityWord = key;
  input.disabled = savingPriorityWord === key;

  const action = document.createElement("div");
  action.className = "priority-action";
  updatePriorityAction(action, entry);

  input.addEventListener("input", () => {
    state = stateApi.setPriorityDraft(state, entry.word, input.value);
    updatePriorityAction(action, entry);
    updateControls();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      savePriority(entry.word);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      state = stateApi.revertPriorityDraft(state, entry.word);
      input.value = String(entry.priority);
      updatePriorityAction(action, entry);
      updateControls();
    }
  });

  editor.append(input, action);
  cell.append(editor);
  return cell;
}

function updatePriorityAction(action, entry) {
  const key = stateApi.normalizeWord(entry.word);
  const draft = state.priorityDrafts.get(key);
  action.replaceChildren();
  if (!draft) return;

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = savingPriorityWord === key ? "保存中…" : "保存";
  saveButton.dataset.prioritySave = key;
  saveButton.disabled = state.requestLocked || savingPriorityWord === key;
  saveButton.addEventListener("click", () => savePriority(entry.word));

  const unsaved = document.createElement("span");
  unsaved.className = "priority-unsaved";
  unsaved.textContent = "未保存";
  action.append(saveButton, unsaved);

  if (draft.error) {
    const error = document.createElement("span");
    error.className = "priority-error";
    error.textContent = draft.error;
    action.append(error);
  }
}

function createCell(value) {
  const cell = document.createElement("td");
  cell.textContent = String(value ?? "");
  return cell;
}

function createActionsCell(entry) {
  const cell = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "row-actions";
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger-button";
  deleteButton.dataset.deleteEntry = stateApi.normalizeWord(entry.word);
  deleteButton.textContent = "削除";
  deleteButton.addEventListener("click", () => confirmAndDeleteEntry(entry.word));
  actions.append(deleteButton);
  cell.append(actions);
  return cell;
}

function updateCurrentSettings() {
  state = stateApi.setCurrentSettings(state, {
    educationCommandEnabled: educationCommandEnabled.checked,
    forgetCommandEnabled: forgetCommandEnabled.checked,
    sharedEducationCommandEnabled: sharedEducationCommandEnabled.checked,
    sharedForgetCommandEnabled: sharedForgetCommandEnabled.checked
  });
  updateSettingsState();
  updateControls();
}

function updateSettingsState() {
  const dirty = stateApi.isSettingsDirty(state);
  settingsState.textContent = dirty ? "未保存" : "保存済み";
  settingsState.classList.toggle("settings-state-dirty", dirty);
  settingsState.classList.toggle("settings-state-saved", !dirty);
  saveSettingsButton.classList.toggle("settings-save-dirty", dirty);
}

function updateControls() {
  const locked = state.requestLocked;
  reloadButton.disabled = locked;
  saveSettingsButton.disabled = locked || !stateApi.isSettingsDirty(state);
  educationCommandEnabled.disabled = locked;
  forgetCommandEnabled.disabled = locked;
  sharedEducationCommandEnabled.disabled = locked;
  sharedForgetCommandEnabled.disabled = locked;
  entryWord.disabled = locked;
  entryReading.disabled = locked;
  addEntryButton.disabled = locked;
  studyDictionaryFile.disabled = locked || !hasDictionaryBaseline;
  importStudyDictionaryButton.disabled =
    locked || !hasDictionaryBaseline || !selectedStudyDictionary?.preview.ok;
  sharedEndpointUrl.disabled = locked;
  saveSharedEndpointButton.disabled = locked;
  fetchSharedButton.disabled = locked || !sharedState.settings.endpointUrl;
  sharedSubmitWord.disabled = locked;
  sharedSubmitReading.disabled = locked;
  sharedSubmitCategory.disabled = locked;
  sharedSubmitAuthor.disabled = locked;
  sharedSubmitButton.disabled = locked;
  refreshSubmissionsButton.disabled = locked;
  importSharedButton.disabled = locked || sharedState.selectedIds.size === 0;
  const importableShared = new Set(sharedApi.importableIds(sharedState.cache, state.entries));
  document.querySelectorAll("[data-shared-select]").forEach((checkbox) => {
    checkbox.disabled = locked || !importableShared.has(checkbox.dataset.sharedSelect);
  });

  document.querySelectorAll("[data-delete-entry]").forEach((button) => {
    button.disabled = locked;
  });
  document.querySelectorAll("[data-priority-save]").forEach((button) => {
    button.textContent =
      button.dataset.prioritySave === savingPriorityWord ? "保存中…" : "保存";
    button.disabled = locked || button.dataset.prioritySave === savingPriorityWord;
  });
  document.querySelectorAll("[data-priority-word]").forEach((input) => {
    input.disabled = input.dataset.priorityWord === savingPriorityWord;
  });
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

function isImportResult(value) {
  return [
    value?.sourceRowCount,
    value?.candidateCount,
    value?.mergedDuplicateCount,
    value?.addedCount,
    value?.skippedCount
  ].every((count) => Number.isSafeInteger(count) && count >= 0);
}

function formatImportError(error) {
  const messages = {
    INVALID_FILE_NAME: "ファイル名は ReplaceStudy.dic にしてください。",
    INVALID_BODY: "送信内容が不正です。",
    BODY_TOO_LARGE: "送信内容が上限を超えています。",
    INVALID_BASE64: "ファイルの送信形式が不正です。",
    BASE64_TOO_LARGE: "ファイルの送信サイズが上限を超えています。",
    FILE_TOO_LARGE: "ファイルサイズが1 MiBを超えています。",
    INVALID_UTF8: "UTF-8として読み込めません。",
    EMPTY_DICTIONARY: "辞書にデータ行がありません。",
    TOO_MANY_ROWS: "データ行が10,000行を超えています。",
    LINE_TOO_LARGE: "1行のサイズが8 KiBを超えています。",
    INVALID_COLUMN_COUNT: "タブ区切り4列ではありません。",
    INVALID_SOURCE_LENGTH: "単語長が正の整数ではありません。",
    INVALID_MATCH_TYPE: "一致指定が N または E ではありません。",
    EMPTY_WORD: "置換前の単語が空です。",
    EMPTY_READING: "置換後の読みが空です。",
    WORD_TOO_LONG: "置換前の単語が1,000文字を超えています。",
    READING_TOO_LONG: "置換後の読みが1,000文字を超えています。",
    CONFLICTING_DUPLICATE: "同じ単語に異なる読みが登録されています。",
    INVALID_BOM: "BOMの位置または個数が不正です。",
    INVALID_LINE_BREAK: "対応していない改行コードが含まれています。"
  };
  const line = error.line === undefined ? "" : `${error.line}行目: `;
  return `${line}${messages[error.code] || `不明なエラー (${error.code})`}`;
}

function getManagementData(payload) {
  const data = payload?.response ?? payload;
  if (!data?.settings || !data?.dictionary || !Array.isArray(data.dictionary.entries)) {
    return null;
  }
  return data;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function setStatus(message) {
  statusElement.textContent = message;
}

function reportError(error, message) {
  console.error(error);
  setStatus(message);
}
