import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readGitReleaseState, resolveReleaseVersion } from "./release-version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const packagePath = path.join(projectRoot, "package.json");
const readmePath = path.join(projectRoot, "README.md");
const licensePath = path.join(projectRoot, "LICENSE");
const srcIndexPath = path.join(projectRoot, "src", "index.ts");
const staticRoot = path.join(projectRoot, "static");
const releaseRoot = path.join(projectRoot, "release");
const pluginDirectoryName = "onecomme-study-command-plugin";

async function main() {
  const [mode, updateType, ...extraArgs] = process.argv.slice(2);
  if (extraArgs.length > 0) throw new Error("Too many release arguments.");

  const gitBefore = readGitReleaseState(projectRoot);
  if (mode === "prod" && gitBefore.dirty) {
    throw new Error("Production release requires a clean project working tree.");
  }
  if (mode === "prod" && gitBefore.commitsSinceTag === 0) {
    throw new Error(`Production release requires commits after ${gitBefore.base.tag}.`);
  }

  const version = resolveReleaseVersion({
    mode,
    updateType,
    base: gitBefore.base,
    head: gitBefore.head,
    dirty: gitBefore.dirty,
    now: new Date()
  });
  const zipFileName = `${pluginDirectoryName}-${version}.zip`;
  const zipFilePath = path.join(releaseRoot, zipFileName);
  const stageRoot = path.join(releaseRoot, `.tmp-${process.pid}`);
  const stagePluginDir = path.join(stageRoot, pluginDirectoryName);
  const finalPluginDir = path.join(releaseRoot, pluginDirectoryName);

  ensureZipCommand();
  await ensureArchiveDoesNotExist(zipFilePath);
  runTests();

  try {
    await rm(stageRoot, { recursive: true, force: true });
    await mkdir(stagePluginDir, { recursive: true });
    await writePluginBundle(stagePluginDir, version);
    await cp(staticRoot, stagePluginDir, { recursive: true });
    await cp(readmePath, path.join(stagePluginDir, "README.md"));
    await cp(licensePath, path.join(stagePluginDir, "LICENSE"));
    await writeReleasePackageJson(stagePluginDir, version);
    await verifyRelease(stagePluginDir, version, mode);
    createZip(stageRoot, zipFilePath);

    await rm(finalPluginDir, { recursive: true, force: true });
    await rename(stagePluginDir, finalPluginDir);
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }

  const gitAfter = readGitReleaseState(projectRoot);
  if (gitAfter.status !== gitBefore.status) {
    throw new Error("Release generation changed the project working tree.");
  }

  console.info(`Created ${path.relative(projectRoot, zipFilePath)}`);
}

function ensureZipCommand() {
  const result = spawnSync("zip", ["-v"], { cwd: projectRoot, stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error("zip command is required to create release archive.");
  }
}

async function ensureArchiveDoesNotExist(zipFilePath) {
  try {
    await readFile(zipFilePath);
    throw new Error(`Release archive already exists: ${path.basename(zipFilePath)}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function runTests() {
  const result = spawnSync("npm", ["test"], { cwd: projectRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Tests failed with status ${result.status}.`);
}

async function writePluginBundle(pluginDir, version) {
  await build({
    entryPoints: [srcIndexPath],
    outfile: path.join(pluginDir, "plugin.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    define: { __PLUGIN_VERSION__: JSON.stringify(version) },
    logLevel: "silent"
  });
}

async function writeReleasePackageJson(pluginDir, version) {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const releasePackageJson = {
    name: packageJson.name,
    version,
    description: packageJson.description,
    main: "plugin.js"
  };
  await writeFile(path.join(pluginDir, "package.json"), `${JSON.stringify(releasePackageJson, null, 2)}\n`);
}

async function verifyRelease(pluginDir, version, mode) {
  const releasePackage = JSON.parse(await readFile(path.join(pluginDir, "package.json"), "utf8"));
  const pluginBundle = await readFile(path.join(pluginDir, "plugin.js"), "utf8");
  const readme = await readFile(path.join(pluginDir, "README.md"), "utf8");
  const license = await readFile(path.join(pluginDir, "LICENSE"), "utf8");
  if (releasePackage.version !== version || !pluginBundle.includes(version)) {
    throw new Error("Release artifact versions do not match.");
  }
  if (mode === "prod" && pluginBundle.includes("0.0.0-dev")) {
    throw new Error("Default development version leaked into production bundle.");
  }
  if (!readme.startsWith("# 教育辞書プラグイン")) {
    throw new Error("Release README is missing or invalid.");
  }
  if (!license.startsWith("MIT License")) {
    throw new Error("Release LICENSE is missing or invalid.");
  }
}

function createZip(stageRoot, zipFilePath) {
  const result = spawnSync("zip", ["-r", zipFilePath, pluginDirectoryName], {
    cwd: stageRoot,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`zip command failed with status ${result.status}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
