import { spawnSync } from "node:child_process";

const STABLE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const UPDATE_TYPES = new Set(["major", "minor", "patch"]);

export function parseStableTag(tag) {
  const match = STABLE_TAG_PATTERN.exec(tag);
  if (!match) return null;

  const version = match.slice(1).map(Number);
  if (!version.every(Number.isSafeInteger)) return null;

  return { major: version[0], minor: version[1], patch: version[2], tag };
}

export function compareVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export function findLatestStableTag(tags) {
  const versions = tags.map(parseStableTag).filter(Boolean);
  if (versions.length === 0) {
    throw new Error("No reachable stable tag found. Create a vX.Y.Z tag first.");
  }
  return versions.reduce((latest, candidate) =>
    compareVersions(candidate, latest) > 0 ? candidate : latest
  );
}

export function incrementVersion(base, updateType) {
  if (!UPDATE_TYPES.has(updateType)) {
    throw new Error("Release type must be one of: major, minor, patch.");
  }

  const next = { major: base.major, minor: base.minor, patch: base.patch };
  if (updateType === "major") {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
  } else if (updateType === "minor") {
    next.minor += 1;
    next.patch = 0;
  } else {
    next.patch += 1;
  }

  if (![next.major, next.minor, next.patch].every(Number.isSafeInteger)) {
    throw new Error("The next version exceeds JavaScript's safe integer range.");
  }
  return `${next.major}.${next.minor}.${next.patch}`;
}

export function formatUtcTimestamp(date) {
  return date.toISOString().replace(/[-:T.Z]/g, "");
}

export function resolveReleaseVersion({ mode, updateType, base, head, dirty, now }) {
  const stableVersion = incrementVersion(base, updateType);
  if (mode === "prod") return stableVersion;
  if (mode !== "dev") throw new Error("Release mode must be dev or prod.");
  if (!/^[0-9a-f]{7}$/i.test(head)) throw new Error("A 7-character Git HEAD is required.");

  return `${stableVersion}-beta.${formatUtcTimestamp(now)}.${head}${dirty ? ".dirty" : ""}`;
}

export function readGitReleaseState(projectRoot) {
  if (runGit(projectRoot, ["rev-parse", "--is-shallow-repository"]) === "true") {
    throw new Error("Shallow Git history is not supported. Fetch complete history and tags.");
  }

  const tags = runGit(projectRoot, ["tag", "--merged", "HEAD", "--list"])
    .split("\n")
    .filter(Boolean);
  const base = findLatestStableTag(tags);
  const head = runGit(projectRoot, ["rev-parse", "--short=7", "HEAD"]);
  const status = runGit(projectRoot, ["status", "--porcelain", "--untracked-files=all", "--", "."]);
  const commitsSinceTag = Number(runGit(projectRoot, ["rev-list", "--count", `${base.tag}..HEAD`]));

  return { base, head, dirty: status.length > 0, status, commitsSinceTag };
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    const detail = result.stderr?.trim();
    throw new Error(`Git command failed: git ${args.join(" ")}${detail ? ` (${detail})` : ""}`);
  }
  return result.stdout.trim();
}
