# dsh-all-in-one-preset

Static preset that combines Minimal startup, Standard tools, PTC workflow, and ClearAI-style evidence discipline without loading every tool or skill into the first prompt.

## Behavior

- Starts with Minimal file editing (`read`, `write`, `edit`), persistent terminal (`bash`), search, ask-user, and goal controls when installed.
- `all_in_one_load({list:true})` discovers session-available tools and skills without activating them.
- `all_in_one_load({tools:["coding"]})` or `all_in_one_load({skills:["..."]})` activates capabilities for the rest of the agent session.
- `/ptc` forces PTC. Architecture, research, debugging, refactoring, comparison, migration, review, and workflow prompts auto-route to PTC; routine edits stay native.
- If task grows mid-turn, `all_in_one_load({ptc:true})` escalates next step to PTC; next turn resets to fresh routing.
- Unknown, unavailable, or malformed capabilities fail without changing prior active state.
- No marketplace, plugin installation, profile mutation, or preset switching path is exposed.

Pack/install bundle through DSH plugin manager, then select `all-in-one` in agent preset list:

```sh
npm pack
dsh plugin --profile web add ./dsh-all-in-one-preset-0.1.0.tgz
```

## npm release

- Push to `main` with `chore:` or `chore(scope):` commit. GitHub Actions runs test, build, and semantic-release.
- Add repository secret `NPM_TOKEN` with publish permission. Existing `NODE_AUTH_TOKEN` also works as fallback. `GITHUB_TOKEN` is provided by Actions.
- `chore` commits create patch releases; `feat` and `fix` remain available when included in the semantic-release commit range.
