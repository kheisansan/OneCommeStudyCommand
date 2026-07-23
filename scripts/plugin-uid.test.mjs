import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const managementScript = await readFile(
  new URL("../static/script.js", import.meta.url),
  "utf8"
);

test("management screen uses the owned-domain plugin API URL", () => {
  assert.match(
    managementScript,
    /const PLUGIN_UID = "games\.tang-chao\.study-command";/
  );
  assert.match(
    managementScript,
    /const API_URL = `http:\/\/localhost:11180\/api\/plugins\/\$\{PLUGIN_UID\}`;/
  );
  assert.doesNotMatch(managementScript, /com\.onecomme\.study-command/);
});
