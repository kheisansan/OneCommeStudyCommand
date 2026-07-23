import assert from "node:assert/strict";
import test from "node:test";
import { formatSha256Checksum } from "./release-artifact.mjs";

test("format a SHA-256 checksum using the archive file name", () => {
  assert.equal(
    formatSha256Checksum(Buffer.from("abc"), "plugin.zip"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  plugin.zip\n"
  );
});

test("reject an empty or multiline checksum file name", () => {
  assert.throws(() => formatSha256Checksum(Buffer.from("abc"), ""), /non-empty single line/);
  assert.throws(() => formatSha256Checksum(Buffer.from("abc"), "plugin.zip\nother"), /non-empty single line/);
});
