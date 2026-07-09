# Viewing Jolli Memory for the Snake Game repo

This guide walks you through cloning the public `snake-game` repo, putting its
Jolli Memory history in place, installing the tools, and viewing all of the
memories inside VS Code.

Jolli Memory stores its AI-generated commit summaries on a dedicated **git
orphan branch** (`jollimemory/summaries/v3`) that ships with the repo. Nothing
is checked out into your working tree — the branch just needs to exist locally
so the CLI and your IDE plugin (VS Code or JetBrains) can read it.

![How Jolli Memory works: each commit is distilled by git and agent hooks into a structured summary stored on the jollimemory/summaries/v3 orphan branch, which produces a browsable Knowledge Wiki and an interactive Knowledge Graph you can recall and search across branches and machines.](./how-it-works.svg)

---

## Prerequisites

- **Node.js 22+** and npm (the CLI runs on Node). Check with `node -v`.
- **git**
- **VS Code** or a **JetBrains IDE** (e.g. IntelliJ IDEA) — each has a Jolli
  Memory plugin. The screenshots below use VS Code; the JetBrains plugin has the
  same panel, wiki, and graph features.

---

## 1. Clone (or fork) the repo

```bash
git clone https://github.com/jolliai/snake-game.git
cd snake-game
```

> Prefer a fork? Fork `jolliai/snake-game` on GitHub first, then clone your
> fork. A normal `git clone` fetches **all** branches — including the Jolli
> Memory orphan branch — so no extra flags are needed.

## 2. Put the Jolli Memory orphan branch in place

The memory lives on the `jollimemory/summaries/v3` branch. After cloning it
exists as a remote-tracking ref (`origin/jollimemory/summaries/v3`); create a
local branch from it so the tools can read it:

```bash
git branch jollimemory/summaries/v3 origin/jollimemory/summaries/v3
```

**Do not check it out** — leave it as a branch. Your working directory stays on
`main`. Confirm it's there:

```bash
git branch --list 'jollimemory/*'
#   jollimemory/summaries/v3
```

This matches the example setup: the repo keeps `main` (your code) plus the
`jollimemory/summaries/v3` branch (the memory) side by side.

## 3. Install the Jolli CLI

```bash
npm install -g @jolli.ai/cli
```

This installs the `jolli` command. Verify:

```bash
jolli --version
```

## 4. Sign in

Sign in to Jolli so the tools can generate AI summaries (this gives you a Jolli
API Key, so no Anthropic API key is required):

```bash
jolli auth login
```

Follow the browser prompt to authenticate, then confirm:

```bash
jolli auth status
#   Jolli Account:  Signed in
#   Jolli API Key:  Configured
```

## 5. Enable Jolli Memory in the repo

From inside the `snake-game` folder:

```bash
jolli enable
```

This installs the lightweight git + AI-agent hooks and wires up the local
orphan branch. Then confirm everything is connected:

```bash
jolli status
```

You should see something like:

```
  Jolli Account:    Signed in
  Stored memories:  82
  Orphan branch:    jollimemory/summaries/v3
```

If `Stored memories` is `0` or the orphan branch is missing, re-run step 2 and
then `jolli doctor --fix`.

> Quick check from the terminal (optional): `jolli view` lists the commit
> summaries, and `jolli recall` shows recalled context for the current branch.

## 6. Install the VS Code extension

1. Open VS Code.
2. Go to the **Extensions** view (`Cmd+Shift+X`).
3. Search for **"Jolli Memory"** (publisher `jolli`, id
   `jolli.jollimemory-vscode`) and click **Install**.

> **Using IntelliJ or another JetBrains IDE?** Install the **Jolli Memory** plugin
> from **Settings → Plugins → Marketplace** (search "Jolli Memory") instead — it
> provides the same panel, **Build Knowledge Wiki**, and **View Knowledge Graph**
> actions. The JetBrains plugin manages its own git hooks, so if you enable from
> the CLI (step 5) use `jolli enable --integrations-only`.

## 7. View the memories

1. In VS Code, open the `snake-game` folder (**File → Open Folder…**).
2. Click the **Jolli Memory** icon in the Activity Bar (left sidebar).
3. The Jolli Memory panel opens and lists every stored memory for the repo —
   commit summaries with intent, decisions, and affected files. Use the search
   box to filter, and **Load More** to page through older entries.

If the panel is empty, click **Refresh Memories** (or run **Enable Jolli
Memory** from the panel), and make sure the local `jollimemory/summaries/v3`
branch from step 2 is present.

---

## What to do next

Everything's installed and the panel is showing memories — here's the quick tour
of what Jolli Memory actually gives you.

### 1. Look at a memory

In the **Jolli Memory** panel, click any entry in the list. It expands to show
that commit's structured summary — the **intent** (what the change was trying to
do), the **decisions** made along the way, and the **files** it touched. This is
the raw, per-commit memory; the wiki below rolls these up into topics.

### 2. Build the Knowledge Wiki

The wiki distills all those per-commit memories into a set of browsable **topic**
pages — e.g. "Iron Snake Mode", "Per-Mode Leaderboards", "Bot Strategies" — under
a `snake-game · Knowledge Wiki` index.

Building the wiki runs the memories through an LLM, so it needs two things set up
first: **somewhere to write the pages** (a Memory Bank folder) and **a model to
generate them** (your Jolli account, or your own Anthropic key).

**a. Create and set a Memory Bank folder.** This is a local folder where Jolli
writes the wiki plus a Markdown copy of every memory. One folder can hold several
repos — each gets its own subfolder (here, `snake-game/`, with the wiki under
`snake-game/_wiki/`). Create one and point Jolli at it (use an **absolute** path):

```bash
mkdir -p "$HOME/jolli-memory-bank"
jolli configure --set localFolder="$HOME/jolli-memory-bank"
```

> **Prefer the IDE?** Open the **Jolli Memory** panel, click the **Settings**
> (gear) icon, and in the **Memory Bank** section click **Browse…** to pick or
> create the folder — the chosen path shows in the box next to the button. An
> existing Obsidian vault works fine as the location.

**b. Give it a model.** You already did this in step 4: signing in with your Jolli
account powers generation, no API key required — nothing more to do. Prefer to use
your **own Anthropic key**? Create one in the
[Anthropic Console](https://console.anthropic.com/settings/keys), then switch the
provider over to it:

```bash
jolli configure --set apiKey=sk-ant-...      # your Anthropic key
jolli configure --set aiProvider=anthropic   # tell Jolli to use it instead of the Jolli account
```

> **Prefer the IDE?** In the panel's **Settings**, choose a provider: **Sign in to
> Jolli** (uses your Jolli account) or **Use your Anthropic API key** — the latter
> opens a *Configure your Anthropic API key* screen where you paste the key. Either
> way the credential is stored locally only.

> Keys are stored locally as secrets and are never written into the repo. Check
> what's active with `jolli auth status` (Jolli account) or `jolli status` (shows
> *Anthropic Key: Configured*). A shell `ANTHROPIC_API_KEY` env var also works if
> you'd rather not store the key.

**c. Build it.** From the **Build Knowledge Wiki** action in the panel, the Command
Palette (`Cmd+Shift+P` → **Jolli Memory: Build Knowledge Wiki**), or the terminal:

```bash
jolli compile
```

### 3. View the wiki

The wiki is plain Markdown inside your Memory Bank folder, under
`<memory-bank>/snake-game/_wiki/`. Open **`_wiki/_index.md`** for the topic index
and click through to the individual `topic--*.md` pages. In VS Code, `Cmd+Shift+V`
opens a rendered Markdown preview.

![The generated Knowledge Wiki, rendered as Markdown: the _index.md topic index on the left links to individual topic pages like "Per-Mode Leaderboards with Stats" on the right, which capture the overview, key decisions, and affected files for that area of the codebase.](./knowledge-wiki.png)

*The `_index.md` topic index (left) and one topic page (right) — real output for this repo.*

### 4. View the knowledge graph

To see how the topics connect, open the **View Knowledge Graph** action from the
**Jolli Memory** panel — it opens an interactive graph (topics as nodes, related
work linked) right inside VS Code. (This one lives in the panel, not the Command
Palette.)

![Knowledge Graph overview for this repo: category cards (AI & Bot Behavior, Gameplay Features, Testing & CI, Project Documentation, UI & User Experience, Developer Tooling) with a stats sidebar showing 6 categories, 7 topics, 36 units, and the links between them.](./knowledge-graph-overview.png)

*Overview: each card is a category. Click one to drill into its topics and the units inside.*

![Knowledge Graph drilled into the Gameplay Features category: two topic groups ("Top-Down View Toggle" and "Death Overlay & Loss Reason") made of unit cards tagged MECHANISM, DECISION, and FIX, connected by labeled edges such as "caused-by", "extends", and "related-to".](./knowledge-graph-topics.png)

*Drilling into a category reveals its topics, the units inside them, and how they relate.*

Prefer the browser, or want something shareable? Export a self-contained HTML
graph from the terminal. `--export <dir>` is required (it's the only action
today); add `--open` to launch it in your browser afterward:

```bash
jolli graph --export ./graph          # write ./graph/<repo>-graph.html
jolli graph --export ./graph --open   # …and open it in your browser
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Panel/`jolli status` shows 0 memories | Re-run step 2 to create the local orphan branch, then `jolli doctor --fix`. |
| `jolli: command not found` | Re-run `npm install -g @jolli.ai/cli`; make sure your npm global bin is on `PATH`. |
| "Not signed in" | Run `jolli auth login` (verify with `jolli auth status`). |
| **Build Knowledge Wiki** errors or does nothing | Make sure you're signed in (step 4) and a Memory Bank folder is set (`jolli configure --set localFolder=…`), then rebuild. |
| Wiki or graph looks stale after new commits | Re-run **Build Knowledge Wiki** (`jolli compile`) — it regenerates topics from the latest memories. |
| VS Code panel not appearing | Confirm the **Jolli Memory** extension is installed and enabled, then reload the window. |
