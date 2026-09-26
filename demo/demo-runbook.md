# Power BI + Fabric MCP — Presenter Runbook (30 min)

Companion to `deck/PowerBI-Fabric-MCP-30min.pptx`.
Session: Microsoft Fabric User Group Pune. Audience: Power BI developers and analysts.

Everything here is public preview. Tool names and parameters can change — don't hard-code them.

---

## Timing

| Min | Slides | Segment |
|---|---|---|
| 0–1 | 1–3 | Title, about me, agenda |
| 1–8 | 4–8 | Agentic development, what MCP is (the four-message protocol), the routing trace, skills vs tools |
| 8–12 | 9–10 | Setup, then reading the toolset |
| 12–15 | 11–12 | Can / can't |
| 15–25 | 13–17 | **Live demo: one PBIP, end to end** |
| 25–30 | 18–22 | Fabric MCP, Skills (×2), how it fits, close |

If you're running late, cut slide 21 (how it fits) and slide 20 (skills install — it's a photo slide anyway) and go straight to the close. Never cut slide 17 (the save gotcha).

---

## Pre-flight (30 min before)

- [ ] Power BI Desktop **open** with the demo `.pbip` loaded
- [ ] `connection_operations` → `ListLocalInstances` returns a port (proves the server sees Desktop)
- [ ] A **second, pristine copy** of the PBIP on disk in case the demo model gets mangled
- [ ] MCP client started with `--readwrite` (you need writes for this demo) but **confirmations on**
- [ ] Zoom level in the agent terminal large enough to read from the back
- [ ] Screenshot of the "after" model in the Model view, as a fallback if the live run stalls
- [ ] Know your fallback: if the MCP won't connect, walk the slides and show the screenshots

**Rehearse the rename step once.** It's the one that takes longest and it's where a live audience notices lag.

---

## Setup (for the slide and for anyone who asks)

**The route to show on stage — the VS Code extension.** No JSON to hand-write.

1. VS Code → Extensions (`Ctrl+Shift+X`) → search `powerbi-modeling-mcp` → **Power BI Authoring MCP Server** → Install.
   (It was called *Power BI Modeling MCP* until 22 Sep 2026; the ID and search term didn't change. v1.0.0 shipped 25 Sep.)
   One-click: <https://aka.ms/powerbi-modeling-mcp-vscode>
2. Copilot Chat → **Agent** mode → **Configure Tools** → confirm the Power BI tools are listed.
3. Open Power BI Desktop with a model loaded, then prompt.

**The trap worth calling out.** Extension-contributed servers register through the extension
API, so they **never appear in `mcp.json`** — and in VS Code 1.138 they don't appear in the
Extensions view's *MCP Servers – Installed* list either (that lists `mcp.json` servers only).
Run **`MCP: List Servers`** from the Command Palette: it shows every server, whatever its source. This machine is a live example: the extension is installed and working, and the user
`mcp.json` lists only the GitHub and `powerbi-remote` servers.

**Prerequisites:** Node.js 18+, `az login` for anything touching Fabric, and for the remote
server the tenant setting *"Users can use the Power BI Model Context Protocol server endpoint (preview)"*.

**If someone asks about npx** — it still exists, and the `powerbi-authoring` plugin registers
this same server with `npx -y @microsoft/powerbi-modeling-mcp@latest --start`. That's why Node
stays a prerequisite even if you installed the extension. You just don't type it yourself.

Flags worth naming out loud (v1.0.0): `--readonly`, `--readwrite` (default), `--require-confirmation` (write prompts are **off** by default now), `--accept-eula`, `--authmode`. `--skipconfirmation` no longer exists. In VS Code, set them in Settings → *Power BI Authoring MCP* → **Args** (default `--start --accept-eula`: read-write, no prompts).

---

## The demo, step by step

### Step 1 — Connect and survey (~1.5 min)

> "Connect to the Power BI Desktop instance that's running."

> "List the tables and show me the schema of each one."

Tools: `connection_operations` → `ListLocalInstances`, `Connect`; `table_operations` → `List`, `GetSchema`.

**Say:** *"Note it reads the real schema first. Never let an agent rename from memory — the model may already be half cleaned."*

If Desktop isn't open you'll get `Found 0 local PowerBI Desktop and Analysis Services instances`. That's the healthy "nothing running" answer, not an error.

### Step 2 — Rename for humans (~2.5 min)

> "Rename the tables and columns to business-friendly names — drop the `dimension_` and `fact_` prefixes, and use spaced Title Case for columns."

Tools: `table_operations` → `Rename`, then `column_operations` → `Rename` — each takes a list, in one transaction (v1.0.0 folded the old `batch_*` tools into these). Tables first, so column operations reference the new table names.

Before → after to call out on screen:
- `dimension_stock_item` → `Product`
- `dimension_city` → `City`
- `SalesTerritory` → `Sales Territory`
- `WWIInvoiceID` → `WWI Invoice ID`

**Say:** *"Renames trigger engine formula fixup, so measure DAX usually follows automatically. Usually. We verify in a minute."*

### Step 3 — Descriptions everywhere (~2 min)

> "Add a one-line description to every table, every visible column, and every measure. Show me the list before you apply it."

Tools: `column_operations` / `measure_operations` / `table_operations` → `Update`, each with a list.

**Say:** *"This is the single biggest lever on Copilot and Data Agent answer quality. It's also the work everyone skips because it's boring."*

Only visible, non-key columns need descriptions. Hidden keys don't.

### Step 4 — Naming standards (~1.5 min)

> "Rename every table and column to our convention: no `dim_`/`fact_` prefixes, spaced Title Case, keys suffixed `Key`. Show me the plan before you apply it."

Tools: `table_operations` / `column_operations` → `Rename` with a list, inside a transaction.

**Say:** *"A naming standard is normally a wiki page nobody reads and a code review nobody enjoys. Here it's one prompt applied to sixty objects, consistently."*

Renames trigger engine **formula fixup**, so measure DAX usually follows automatically. Usually — check one measure afterwards rather than assuming.

**On synonyms, if asked.** The server won't write them. As of v1.0.0, no tool schema mentions
linguistic metadata or synonyms at all, and the official `semantic-model-authoring` skill leaves
them to the user. The manual place is the **Synonyms** box in Desktop's Model view (Properties
pane). Don't script a synonym prompt into the demo; it will fail in front of the room.

### Step 5 — Keys, measures table, relationships (~2.5 min)

> "Hide every key and ID column and set summarizeBy to None so they never sum in a visual."

> "Create a measures table called `Metrics` and move every measure into it."

> "List the relationships and confirm the star schema still points where I expect."

Points to land:
- `summarizeBy: None` is the fix for the classic *sum of CityKey* bug
- **`Measures` is a reserved word** — the engine rejects it. Use `Metrics`
- Relationships bind by **object**, not by name, so renaming a key column doesn't break them — check anyway
- Then name the breadth: hierarchies, calculation groups, perspectives, security roles, partitions, cultures, translations

### Step 6 — Make it durable (~2 min) — **do not cut this**

> "None of this is saved yet."

MCP edits live in Desktop's **memory** only. Close Desktop without saving and every change is gone; the file on disk still has the old model.

Two options:

- **A —** Press `Ctrl+S` in Desktop, in front of the room. Then reopen the `.pbip` to prove it loaded from disk.
- **B —** `database_operations` → `ExportToTmdlFolder` pointed at the `*.SemanticModel` folder. The exporter writes a **flat** layout; a PBIP expects `database.tmdl`, `model.tmdl`, `relationships.tmdl`, `tables/`, `cultures/` under `definition/` — move them. Leave `.platform` and `definition.pbism` at the root.

**Closing line:** *"Never tell anyone the model is updated unless you watched it save."*

---

## Fabric MCP (3 min, slides only)

Can: catalog search, workspaces, items, folders, role assignments, capacities, long-running operation status. Remote endpoint, Entra OAuth, nothing to install.

Can't:
- Creates a lakehouse — won't write your lakehouse tables
- Creates a notebook — won't edit the notebook code
- Advanced Fabric features may have no MCP tool yet
- Deleting a workspace removes everything in it, permanently
- Role commands want object IDs unless you also add the Microsoft Graph MCP server

RBAC is enforced and everything is audit-logged under your identity. The server never bypasses security.

---

## Power BI & Fabric Skills (4 min)

Microsoft's framing is **Power BI Agentic**: *skills say what to do, tools do it.* Not a portal feature — a bundle you install into your coding agent.

```bash
copilot plugin marketplace add microsoft/skills-for-fabric
```

```bash
copilot plugin install powerbi-authoring@fabric-collection
```

The `powerbi-authoring` plugin bundles the skills **and registers the Authoring MCP server for you**.

| Skill | What it does |
|---|---|
| `semantic-model-authoring` | Tables, columns, measures, relationships, field parameters, DAX; metadata discovery with INFO functions; deploy and refresh |
| `powerbi-report-cli` | One report skill with four modes it picks from your request: **planning** (requirements, approval gate), **design** (archetype, charts, layout, colour), **authoring** (PBIR edits, validate, preview in Desktop), **management** (publish, rebind in Fabric) |

**Changed in 0.3.17:** `powerbi-report-planning`, `-design`, `-authoring` and `-management` were
**removed** and merged into `powerbi-report-cli`. If someone asks about the old names — or has them
installed from an older download — that's why they no longer match the repo.

**Only two live plugins:** `fabric-skills` (24 skills + 5 agents — FabricAdmin, FabricDataEngineer,
FabricAppDev, FabricIQ, FabricMigrationEngineer) and `powerbi-authoring` (the two above).
`skills-for-fabric`, `fabric-authoring`, `fabric-consumption` and `fabric-operations` are all marked
**deprecated aliases** as of v0.3.18 — don't repeat them from an older blog post.

**Two more things that moved in 0.3.16–0.3.17:**
- **APM** installs a single skill: `apm install microsoft/skills-for-fabric --skill <name> --target copilot`.
  Add `-g` for user scope; without it, it's this project only.
- **FabricIQ** moved to `https://fabriciq.svc.cloud.microsoft/v1/mcp/fabriciq` with header
  `X-VARIANTS: Fabric.Routing.FabricIQ.V1`. Anyone who registered the old endpoint by hand has to re-register.
Works with GitHub Copilot CLI, VS Code Copilot, Claude Code, Cursor, Codex/Jules, Windsurf.
Open source (MIT): <https://github.com/microsoft/skills-for-fabric> — check the repo, the catalogue moves fast.

---

## Troubleshooting on stage

| Symptom | Cause | Fix |
|---|---|---|
| "Found 0 local instances" | Desktop not open | Open the PBIX/PBIP, retry |
| Connection times out mid-demo | Desktop restarted; port changed | Re-run `ListLocalInstances` + `Connect` |
| Server missing from the client | Config not picked up | Restart the client / refresh MCP servers |
| Rename rejected | `Measures` is reserved | Use `Metrics` |
| Measure broke after rename | Formula fixup didn't catch it | `measure_operations` → `Update` with the corrected expression |
| Writes rejected on a service model | XMLA read-only, or Pro workspace | Capacity admin sets XMLA = Read Write; needs F/P/PPU |
| Agent invents a column name | Skipped the schema read | Make it `GetSchema` first, then validate the DAX |
| Changes vanished | Nobody saved | That's the point of step 6 — say so and move on |

---

## Likely questions

**"Is it production ready?"** — It's preview. Use it on dev models behind a review gate. It already pays for itself on model hygiene.

**"Does it work with Fabric semantic models, not just Desktop?"** — Yes, over XMLA. Needs F/P/PPU capacity, XMLA endpoint set to Read Write, and the tenant XMLA setting on. Note the one-way door: once you write to a model over XMLA you can no longer download it as a `.pbix`.

**"Can it build the report too?"** — Not this server. That's the `powerbi-report-cli` skill (authoring mode) working on PBIR files, plus the Desktop Bridge to reload and screenshot.

**"What about security?"** — The server runs as you. Your Entra identity, your Fabric RBAC, your audit entries. Caveat: RLS is not enforced on the remote Power BI server under service principal auth.

**"Which LLM?"** — Your client's. Quality of output varies with the model you point at it.

---

## Links

- Power BI MCP servers — <https://learn.microsoft.com/power-bi/developer/mcp/mcp-servers-overview>
- Power BI Agentic (skills + tools) — <https://learn.microsoft.com/power-bi/developer/agentic/power-bi-agentic-overview>
- Skills for Fabric — <https://github.com/microsoft/skills-for-fabric>
- Power BI Authoring MCP server (formerly Modeling) — <https://github.com/microsoft/powerbi-modeling-mcp>
- Fabric Core MCP — <https://learn.microsoft.com/rest/api/fabric/articles/mcp-servers/core-remote/overview-core-mcp-server>
- XMLA endpoint + tenant settings — <https://learn.microsoft.com/fabric/enterprise/powerbi/service-premium-connect-tools>
