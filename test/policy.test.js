import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chooseMode, invalidToolRequests, resolveToolNames, textFromMessages } from "../lib/policy.js";

const pluginSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

test("uses schemastery default export used by DSH plugins", () => {
  assert.match(pluginSource, /import z from [\"']@deepseek-ai\/schemastery[\"']/);
});

test("registers a valid DSH prompt section", () => {
  assert.match(pluginSource, /systemPrompt\.section\(\{\s*name:/s);
  assert.match(pluginSource, /systemPrompt\.section\(\{[\s\S]*?text:/s);
});

test("injects agent registry before enumerating existing agents", () => {
  assert.match(pluginSource, /export const inject = \["tools", "systemPrompt", "agents"\]/);
});

test("keeps activation state unchanged on invalid requests", () => {
  assert.match(pluginSource, /invalidToolRequests\(requestedTools, state\.knownTools\)/);
  assert.match(pluginSource, /ok: false/);
});

test("declares structured skill output", () => {
  assert.match(pluginSource, /skills:\s*\{[\s\S]*?type: "array"[\s\S]*?type: "object"/);
});

test("uses async scoped skill catalog API", () => {
  assert.match(pluginSource, /await service\.list\(lookup\)/);
  assert.match(pluginSource, /await service\.get\(name, lookup\)/);
});

test("uses DSH tool schema DSL", () => {
  assert.doesNotMatch(pluginSource, /parameters:\s*\{\s*type:/);
  assert.doesNotMatch(pluginSource, /required:\s*\[/);
});

test("supports same-turn PTC escalation and mode persistence", () => {
  assert.match(pluginSource, /ptc: \{ type: "boolean"/);
  assert.match(pluginSource, /forcePtc/);
  assert.match(pluginSource, /turnMode/);
});

test("extracts nested message text", () => {
  assert.equal(textFromMessages([{ role: "user", content: [{ text: "debug this" }] }]), "debug this");
});

test("routes explicit commands before automatic routing", () => {
  assert.equal(chooseMode("/ptc make a tiny edit"), "ptc");
  assert.equal(chooseMode("/native research this"), "native");
  assert.equal(chooseMode("research this"), "ptc");
  assert.equal(chooseMode("research this", false), "native");
});

test("rejects unknown or unavailable tool requests", () => {
  const known = ["read", "write", "bash"];
  assert.deepEqual(invalidToolRequests(["coding", "missing"], known), ["missing"]);
  assert.deepEqual(invalidToolRequests(["web"], known), ["web"]);
  assert.deepEqual(invalidToolRequests(["coding"], known), []);
});

test("resolves only known tools and keeps activation persistent", () => {
  const known = ["read", "write", "edit", "bash", "job_list", "job_output", "job_kill", "web_search"];
  assert.deepEqual(resolveToolNames(["coding"], known, ["read"]), ["bash", "edit", "job_kill", "job_list", "job_output", "read", "write"]);
  assert.deepEqual(resolveToolNames(["missing"], known, ["read"]), ["read"]);
  assert.deepEqual(resolveToolNames(["all"], known), [...known].sort());
});
