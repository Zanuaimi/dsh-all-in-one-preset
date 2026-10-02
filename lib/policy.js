export const BOOTSTRAP_TOOLS = [
  "read",
  "write",
  "edit",
  "bash",
  "glob",
  "grep",
  "ask_user_question",
  "get_goal",
  "create_goal"
];

export const TOOL_GROUPS = {
  coding: ["write", "edit", "bash", "pwsh", "job_list", "job_output", "job_kill"],
  web: ["web_search", "web_fetch", "advanced_search", "multi_search", "platform_search"],
  planning: ["exit_plan_mode", "todo_write", "plan"],
  orchestration: ["subagent", "subagent_fork", "workflow", "send_message", "interrupt_agent", "list_agents", "wait_agent", "spawn_teammate", "create_goal", "get_goal"],
  browser: ["ego_navigate", "ego_snapshot", "ego_click", "ego_fill", "ego_key", "ego_wait"],
  all: []
};

const AUTO_PTC = /\b(?:architect(?:ure)?|compare|debug|design|investigat(?:e|ion)|migrat(?:e|ion)|orchestrat(?:e|ion)|refactor|research|review|workflow|multi[- ]step)\b/i;
const EXPLICIT_PTC = /(?:^|\s)\/ptc(?:\s|$)|\b(?:use|run|switch to)\s+ptc\b/i;
const EXPLICIT_NATIVE = /(?:^|\s)\/(?:native|minimal|standard)(?:\s|$)|\bno\s+(?:ptc|orchestration)\b/i;

export function textFromMessages(messages) {
  const visit = value => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(visit).filter(Boolean).join(" ");
    if (!value || typeof value !== "object") return "";
    return [value.text, value.content, value.message, value.input].map(visit).filter(Boolean).join(" ");
  };
  return visit(messages).trim();
}

export function chooseMode(text, autoPtc = true) {
  if (EXPLICIT_PTC.test(text)) return "ptc";
  if (EXPLICIT_NATIVE.test(text)) return "native";
  return autoPtc && AUTO_PTC.test(text) ? "ptc" : "native";
}

export function invalidToolRequests(requestedGroups, knownNames) {
  const known = new Set(knownNames);
  return requestedGroups.filter(requested => {
    if (requested === "all" || known.has(requested)) return false;
    const group = TOOL_GROUPS[requested];
    return group === undefined || !group.some(name => known.has(name));
  });
}

export function resolveToolNames(requestedGroups, knownNames, currentNames = []) {
  const known = new Set(knownNames);
  const resolved = new Set(currentNames.filter(name => known.has(name)));
  for (const requested of requestedGroups) {
    if (requested === "all") {
      for (const name of known) resolved.add(name);
      continue;
    }
    const names = TOOL_GROUPS[requested] ?? [requested];
    for (const name of names) if (known.has(name)) resolved.add(name);
  }
  return [...resolved].sort();
}
