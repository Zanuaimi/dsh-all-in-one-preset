import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/npm-release.yml", import.meta.url), "utf8");
const releaseConfig = readFileSync(new URL("../.releaserc.json", import.meta.url), "utf8");

test("release workflow supports both npm token secret names", () => {
  assert.match(workflow, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \|\| secrets\.NODE_AUTH_TOKEN \}\}/);
  assert.match(workflow, /NPM_TOKEN: \$\{\{ secrets\.NPM_TOKEN \|\| secrets\.NODE_AUTH_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
});

test("GitHub failure reporting cannot mask release errors with a missing label", () => {
  assert.match(releaseConfig, /"@semantic-release\/github"[\s\S]*"failComment": false/);
});
