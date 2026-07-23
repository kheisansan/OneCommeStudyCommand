import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findLatestStableTag,
  formatUtcTimestamp,
  incrementVersion,
  parseStableTag,
  readGitReleaseState,
  resolveReleaseVersion
} from "./release-version.mjs";

test("parse only strict stable tags with safe integers", () => {
  assert.deepEqual(parseStableTag("v1.2.3"), { major: 1, minor: 2, patch: 3, tag: "v1.2.3" });
  for (const tag of ["1.2.3", "v01.2.3", "v1.2.3-beta.1", "v1.2", "v9007199254740992.0.0"]) {
    assert.equal(parseStableTag(tag), null);
  }
});

test("choose the semver-highest reachable stable tag", () => {
  assert.equal(findLatestStableTag(["v1.9.9", "v2.0.0", "v1.10.0", "v2.0.0-beta.1"]).tag, "v2.0.0");
  assert.throws(() => findLatestStableTag(["latest", "v1.0.0-beta.1"]), /No reachable stable tag/);
});

test("increment major, minor, and patch versions", () => {
  const base = { major: 1, minor: 2, patch: 3 };
  assert.equal(incrementVersion(base, "major"), "2.0.0");
  assert.equal(incrementVersion(base, "minor"), "1.3.0");
  assert.equal(incrementVersion(base, "patch"), "1.2.4");
  assert.throws(() => incrementVersion(base, "other"), /major, minor, patch/);
  assert.throws(
    () => incrementVersion({ major: Number.MAX_SAFE_INTEGER, minor: 0, patch: 0 }, "major"),
    /safe integer/
  );
});

test("format development and production versions", () => {
  const base = { major: 0, minor: 2, patch: 1 };
  const now = new Date("2026-07-15T13:45:30.123Z");
  assert.equal(formatUtcTimestamp(now), "20260715134530123");
  assert.equal(
    resolveReleaseVersion({ mode: "dev", updateType: "patch", base, head: "d19ffa8", dirty: true, now }),
    "0.2.2-beta.20260715134530123.d19ffa8.dirty"
  );
  assert.equal(
    resolveReleaseVersion({ mode: "prod", updateType: "minor", base, head: "d19ffa8", dirty: false, now }),
    "0.3.0"
  );
});

test("read reachable tags, repository dirtiness, and commits after the base tag", () => {
  const repository = createRepository();
  git(repository, "tag", "v1.2.3");
  commitFile(repository, "next.txt", "next", "next");
  git(repository, "tag", "v9.0.0", "--no-sign", git(repository, "rev-parse", "HEAD~1"));
  writeFileSync(path.join(repository, "dirty.txt"), "dirty");

  const state = readGitReleaseState(repository);
  assert.equal(state.base.tag, "v9.0.0");
  assert.equal(state.commitsSinceTag, 1);
  assert.equal(state.dirty, true);
  assert.match(state.head, /^[0-9a-f]{7}$/);
});

test("reject shallow repositories instead of guessing the release base", () => {
  const source = createRepository();
  git(source, "tag", "v1.0.0");
  commitFile(source, "next.txt", "next", "next");
  const shallow = mkdtempSync(path.join(tmpdir(), "release-version-shallow-"));
  execFileSync("git", ["clone", "--depth", "1", `file://${source}`, shallow], { stdio: "ignore" });

  assert.throws(() => readGitReleaseState(shallow), /Shallow Git history/);
});

function createRepository() {
  const directory = mkdtempSync(path.join(tmpdir(), "release-version-"));
  git(directory, "init");
  git(directory, "config", "user.email", "test@example.com");
  git(directory, "config", "user.name", "Release Test");
  commitFile(directory, "initial.txt", "initial", "initial");
  return directory;
}

function commitFile(directory, fileName, contents, message) {
  writeFileSync(path.join(directory, fileName), contents);
  git(directory, "add", fileName);
  git(directory, "commit", "-m", message);
}

function git(directory, ...args) {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
