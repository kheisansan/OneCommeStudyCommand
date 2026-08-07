import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const management = require("../static/management-state.js");

test("preserve unsaved settings for non-settings responses and reloads", () => {
  let state = management.createManagementState();
  state = management.applyManagementData(state, data(settings(true, true), [entry("a", 1)]));
  state = management.setCurrentSettings(state, settings(false, true));

  state = management.applyManagementData(state, data(settings(true, false), [entry("a", 1)]));

  assert.deepEqual(state.baselineSettings, settings(true, false));
  assert.deepEqual(state.currentSettings, settings(false, true));
  assert.equal(management.isSettingsDirty(state), true);
});

test("adopt response settings only after a successful settings save", () => {
  let state = management.createManagementState();
  state = management.applyManagementData(state, data(settings(true, true), []));
  state = management.setCurrentSettings(state, settings(false, true));

  state = management.applyManagementData(state, data(settings(false, true), []), {
    adoptSettings: true
  });

  assert.deepEqual(state.currentSettings, settings(false, true));
  assert.equal(management.isSettingsDirty(state), false);
});

test("preserve priority drafts by normalized word across responses and ordering changes", () => {
  let state = management.createManagementState();
  state = management.applyManagementData(
    state,
    data(settings(true, true), [entry("ＦＦ１４", 4), entry("古狸", 2)])
  );
  state = management.setPriorityDraft(state, "FF14", "10");
  state = management.setPriorityDraft(state, "古狸", "8");
  state = management.setPriorityError(state, "古狸", "保存エラー");

  state = management.applyManagementData(
    state,
    data(settings(true, true), [entry("古狸", 2), entry("ff14", 10)])
  );

  assert.equal(state.priorityDrafts.has("ff14"), false);
  assert.deepEqual(state.priorityDrafts.get("古狸"), {
    value: "8",
    error: "保存エラー"
  });
});

test("preserve edits made while another management response is in flight", () => {
  let state = management.createManagementState();
  state = management.applyManagementData(
    state,
    data(settings(true, true), [entry("a", 1), entry("b", 1)])
  );
  state = management.setPriorityDraft(state, "a", "5");
  state = management.setPriorityDraft(state, "b", "9");

  state = management.applyManagementData(
    state,
    data(settings(true, true), [entry("a", 5), entry("b", 1)])
  );

  assert.equal(state.priorityDrafts.has("a"), false);
  assert.equal(state.priorityDrafts.get("b").value, "9");
});

test("sort entries by the same priority order used for replacement", () => {
  const entries = [
    entry("古", 2, "2026-07-01T00:00:00.000Z"),
    entry("古狸", 2, "2026-07-02T00:00:00.000Z"),
    entry("新", 10, "2026-07-03T00:00:00.000Z"),
    entry("別語", 2, "2026-06-01T00:00:00.000Z")
  ];

  assert.deepEqual(
    management.sortEntries(entries).map(({ word }) => word),
    ["新", "別語", "古狸", "古"]
  );
  assert.deepEqual(entries.map(({ word }) => word), ["古", "古狸", "新", "別語"]);
});

test("move a saved priority row without losing another row draft", () => {
  let state = management.createManagementState();
  state = management.applyManagementData(
    state,
    data(settings(true, true), [entry("a", 1), entry("b", 2)])
  );
  state = management.setPriorityDraft(state, "a", "10");
  state = management.setPriorityDraft(state, "b", "20");

  state = management.applyManagementData(
    state,
    data(settings(true, true), [entry("a", 10), entry("b", 2)])
  );

  assert.deepEqual(state.entries.map(({ word }) => word), ["a", "b"]);
  assert.equal(state.priorityDrafts.has("a"), false);
  assert.equal(state.priorityDrafts.get("b").value, "20");
});

test("discard a priority draft only when its entry disappears or matches the baseline", () => {
  let state = management.createManagementState();
  state = management.applyManagementData(
    state,
    data(settings(true, true), [entry("a", 1), entry("b", 1)])
  );
  state = management.setPriorityDraft(state, "a", "2");
  state = management.setPriorityDraft(state, "b", "3");

  state = management.applyManagementData(state, data(settings(true, true), [entry("a", 2)]));

  assert.equal(state.priorityDrafts.size, 0);
});

test("validate priority without coercing invalid values", () => {
  assert.equal(management.parsePriority("1"), 1);
  assert.equal(management.parsePriority("9007199254740991"), Number.MAX_SAFE_INTEGER);
  for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"]) {
    assert.equal(management.parsePriority(value), null);
  }
});

test("allow only one management request lock at a time and do not queue attempts", () => {
  const state = management.createManagementState();

  assert.equal(management.tryLock(state), true);
  assert.equal(management.tryLock(state), false);
  management.unlock(state);
  assert.equal(management.tryLock(state), true);
});

test("send only one locked request and always release the lock", async () => {
  const state = management.createManagementState();
  let calls = 0;
  let finishFirst;
  const first = management.runLockedRequest(state, async () => {
    calls += 1;
    await new Promise((resolve) => {
      finishFirst = resolve;
    });
    return "done";
  });
  const second = await management.runLockedRequest(state, async () => {
    calls += 1;
  });

  assert.deepEqual(second, { started: false });
  assert.equal(calls, 1);
  finishFirst();
  assert.deepEqual(await first, { started: true, value: "done" });
  assert.equal(state.requestLocked, false);

  await assert.rejects(
    management.runLockedRequest(state, async () => {
      throw new Error("request failed");
    }),
    /request failed/
  );
  assert.equal(state.requestLocked, false);
});

function settings(educationCommandEnabled, forgetCommandEnabled) {
  return {
    educationCommandEnabled,
    forgetCommandEnabled,
    sharedEducationCommandEnabled: false,
    sharedForgetCommandEnabled: false,
    sharedReviewCommandEnabled: false
  };
}

function entry(word, priority, updatedAt = "2026-07-01T00:00:00.000Z") {
  return {
    word,
    reading: "よみ",
    priority,
    enabled: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt
  };
}

function data(currentSettings, entries) {
  return {
    settings: currentSettings,
    dictionary: { version: 2, entries }
  };
}
