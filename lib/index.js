import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { BOOTSTRAP_TOOLS, TOOL_GROUPS, chooseMode, invalidToolRequests, resolveToolNames, textFromMessages } from "./policy.js";

export const name = "all-in-one-control";
export const inject = ["tools", "systemPrompt", "agents"];
export const Config = z.object({
  autoPtc: z.boolean().default(true),
  bootstrapTools: z.array(z.string()).default(BOOTSTRAP_TOOLS)
});

const stateByAgent = new WeakMap();

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ok: { type: "boolean", required: true },
    mode: { type: "string", required: true },
    tools: { type: "array", required: true, items: { type: "string" } },
    skills: {
      type: "array",
      required: true,
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          name: { type: "string", required: true },
          description: { type: "string", required: true },
          source: { type: "string" },
          content: { type: "string" }
        }
      }
    },
    loaded: { type: "array", required: true, items: { type: "string" } },
    message: { type: "string", required: true }
  }
};

function skillService(ctx) {
  return ctx.get("skills");
}

async function skillCandidates(service, lookup) {
  const candidates = service ? await service.list(lookup) : [];
  if (!Array.isArray(candidates) || candidates.some(skill => !skill || typeof skill.name !== "string" || typeof skill.description !== "string" || typeof skill.invocation?.modelInvocable !== "boolean")) {
    throw new Error("malformed skill metadata");
  }
  return candidates;
}

async function skillSummaries(service, lookup) {
  return (await skillCandidates(service, lookup)).filter(skill => skill.invocation.modelInvocable).map(skill => ({
    name: skill.name,
    description: skill.description,
    source: skill.source
  }));
}

async function loadSkills(service, names, lookup) {
  if (names.length === 0) return { skills: [], missing: [] };
  const candidates = await skillCandidates(service, lookup);
  const available = candidates.filter(skill => skill.invocation.modelInvocable);
  const missing = names.filter(name => !available.some(skill => skill.name === name));
  if (missing.length > 0) return { skills: [], missing };
  const loaded = [];
  for (const name of names) {
    lookup.signal?.throwIfAborted();
    const skill = await service.get(name, lookup);
    if (!skill || typeof skill.content !== "string") throw new Error(`malformed skill body: ${name}`);
    loaded.push(skill);
  }
  return { skills: loaded, missing: [] };
}

function applyRestriction(agent, state) {
  state.restriction?.();
  state.restriction = agent.ctx.tools.restrict({ allow: [...state.allowedTools] });
}

async function setMode(agent, state, mode) {
  if (state.mode === mode && state.modeFiber) return;
  if (mode === "ptc" && typeof agent.ctx.tools.get === "function" && !agent.ctx.tools.get("run_code", agent)) {
    mode = "native";
  }
  const old = state.modeFiber;
  state.modeFiber = undefined;
  if (old) await old.dispose();
  state.mode = mode;
  try {
    state.modeFiber = agent.ctx.inject(["tools"], scope => scope.tools.presentAs(mode));
  } catch (error) {
    if (mode === "native") throw error;
    state.mode = "native";
    state.modeFiber = agent.ctx.inject(["tools"], scope => scope.tools.presentAs("native"));
  }
}

function registerControlTools(agent, state, scope, service) {
  scope.tools.register(defineTool({
    name: "all_in_one_load",
    description: "Discover or activate user-installed tools and skills for this session. Activation persists for this agent session. Use tools with group names coding, web, planning, orchestration, browser, or all; use skills with exact skill names.",
    parameters: {
      tools: { type: "array", items: { type: "string" }, description: "Tool names or groups to activate." },
      skills: { type: "array", items: { type: "string" }, description: "Exact skill names to activate." },
      list: { type: "boolean", description: "Only discover available capabilities; do not activate." },
      ptc: { type: "boolean", description: "Escalate the current turn to PTC before its next step." }
    },
    output: { schema: outputSchema },
    async execute(args = {}, exec) {
      const requestedTools = Array.isArray(args.tools) ? args.tools : [];
      const requestedSkills = Array.isArray(args.skills) ? args.skills : [];
      const lookup = {
        cwd: exec?.agent?.session?.header?.cwd,
        signal: exec?.signal,
        scope: exec?.agent
      };
      const failed = message => ({
        ok: false,
        mode: state.mode,
        tools: [...state.allowedTools].sort(),
        skills: [],
        loaded: [...state.loadedSkills].sort(),
        message
      });
      if (args.list) {
        try {
          return {
            ok: true,
            mode: state.mode,
            tools: [...state.knownTools].sort(),
            skills: await skillSummaries(service, lookup),
            loaded: [...state.loadedSkills].sort(),
            message: "Discovery only; nothing activated."
          };
        } catch (error) {
          return failed(`Discovery failed: ${error.message}`);
        }
      }
      const invalid = invalidToolRequests(requestedTools, state.knownTools);
      if (invalid.length > 0) return failed(`Unknown or unavailable tools: ${invalid.join(", ")}`);
      let skillResult;
      try {
        skillResult = await loadSkills(service, requestedSkills, lookup);
      } catch (error) {
        return failed(`Skill activation failed: ${error.message}`);
      }
      if (skillResult.missing.length > 0) return failed(`Unknown or unavailable skills: ${skillResult.missing.join(", ")}`);
      if (args.ptc === true) state.forcePtc = true;
      const nextTools = resolveToolNames(requestedTools, state.knownTools, [...state.allowedTools]);
      state.allowedTools = new Set(nextTools);
      applyRestriction(agent, state);
      const newlyLoaded = [];
      for (const skill of skillResult.skills) {
        if (state.loadedSkills.has(skill.name)) continue;
        state.loadedSkills.add(skill.name);
        newlyLoaded.push(skill);
      }
      return {
        ok: true,
        mode: state.mode,
        tools: [...state.allowedTools].sort(),
        skills: newlyLoaded.length ? newlyLoaded : [],
        loaded: [...state.loadedSkills].sort(),
        message: "Activated capabilities persist for this agent session."
      };
    }
  }));
}

function installAgent(ctx, agent, config) {
  if (stateByAgent.has(agent)) return;
  const toolView = agent.ctx.tools.view(agent);
  const state = {
    mode: "native",
    turn: undefined,
    turnInitialized: false,
    turnMode: "native",
    forcePtc: false,
    knownTools: new Set(toolView.restrictableNames ?? []),
    allowedTools: new Set(),
    loadedSkills: new Set(),
    restriction: undefined,
    modeFiber: undefined,
    fiber: undefined
  };
  const bootstrap = config.bootstrapTools ?? BOOTSTRAP_TOOLS;
  for (const name of bootstrap) if (state.knownTools.has(name)) state.allowedTools.add(name);
  stateByAgent.set(agent, state);
  applyRestriction(agent, state);
  const service = skillService(ctx);
  state.fiber = agent.ctx.inject(["tools", "systemPrompt"], scope => {
    registerControlTools(agent, state, scope, service);
    scope.systemPrompt.section({
      name: "all-in-one:capability-policy",
      order: 700,
      text: `Start with lazy capability discovery. Visible tools are a small bootstrap set; call all_in_one_load({list:true}) to inspect available capabilities, then activate only what the task needs. Activation persists for this agent session. Skill bodies returned by all_in_one_load are active guidance; do not reload them.\n\nUse /ptc or ask for PTC for multi-step orchestration. If a routine task grows into orchestration, call all_in_one_load({ptc:true}) before the next action; this keeps the current turn in PTC. All-In-One automatically routes architecture, research, debugging, refactoring, comparison, migration, review, and workflow prompts to PTC. Keep routine edits native.\n\nFor uncertain or high-impact work, state a testable judgement, name what would refute it, gather evidence, and give a bounded conclusion. Do not add this loop to routine fact answers or trivial edits.`
    });
  });
  void setMode(agent, state, "native");
}

export function apply(ctx, rawConfig = {}) {
  const config = {
    autoPtc: rawConfig.autoPtc ?? true,
    bootstrapTools: rawConfig.bootstrapTools ?? BOOTSTRAP_TOOLS
  };
  const onCreated = ({ agent }) => installAgent(ctx, agent, config);
  const onDisposed = ({ agent }) => {
    const state = stateByAgent.get(agent);
    if (!state) return;
    state.restriction?.();
    state.modeFiber?.dispose();
    state.fiber?.dispose();
    stateByAgent.delete(agent);
  };
  const onPreStep = async ({ agent, messages, turn }, next) => {
    const state = stateByAgent.get(agent);
    if (state) {
      if (!state.turnInitialized || state.turn !== turn) {
        state.turnInitialized = true;
        state.turn = turn;
        state.forcePtc = false;
        state.turnMode = chooseMode(textFromMessages(messages), config.autoPtc);
      }
      await setMode(agent, state, state.forcePtc ? "ptc" : state.turnMode);
    }
    return next();
  };
  ctx.on("agent/created", onCreated);
  ctx.on("agent/disposed", onDisposed);
  ctx.on("agent/pre-step", onPreStep);
  for (const agent of ctx.agents?.list?.() ?? []) installAgent(ctx, agent, config);
  ctx.effect(() => () => {
    for (const agent of ctx.agents?.list?.() ?? []) onDisposed({ agent });
  }, "all-in-one.dispose");
}

export { BOOTSTRAP_TOOLS, TOOL_GROUPS, chooseMode, resolveToolNames, textFromMessages };
