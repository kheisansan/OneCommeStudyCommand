import { createHash } from "node:crypto";

export function formatSha256Checksum(contents, fileName) {
  if (!fileName || /[\r\n]/.test(fileName)) {
    throw new Error("Checksum file name must be a non-empty single line.");
  }
  const digest = createHash("sha256").update(contents).digest("hex");
  return `${digest}  ${fileName}\n`;
}
