---
name: powerbi-synonyms
description: >-
  Adds synonyms (linguistic schema / LSDL terms) to Power BI semantic model tables, columns
  and measures — the part of model AI-readiness that the Power BI Authoring MCP server
  cannot write and the semantic-model-authoring skill leaves to the user. Works on a PBIP
  project on disk or on a model open in Power BI Desktop. Use when the user asks to add
  synonyms, alternate names, business terms or vocabulary for Copilot, Q&A or a Data Agent,
  or when an AI-readiness audit reports missing synonyms. Not for renaming objects or setting
  descriptions (use semantic-model-authoring), and never via translation captions.
---

# Power BI synonyms

Fabric data agents and Power BI Q&A match a user's words to your model partly through
**synonyms** — alternate terms for tables, columns and measures. Synonyms live in one JSON
document on the `en-US` culture: the model's *linguistic metadata*, also called the LSDL. The
Power BI Authoring MCP server (formerly Modeling MCP) has no tool that reads or writes it: none of
its 21 tool schemas in v1.0.0 mentions linguistic metadata or synonyms. This skill fills that gap
with a small, tested script that reads the document, merges new terms in, writes it back, and
verifies the result.

You never write the linguistic-metadata JSON yourself. You produce a **simple map** of
object → terms; the script owns the internal format.

## When to use which mode

| Situation | Mode | Command |
|---|---|---|
| A PBIP project, **Desktop closed** (or the model not open in it) | PBIP | `node scripts/set-synonyms.js --model <X.SemanticModel> --input map.json` |
| The model is **open in Power BI Desktop** | Live | `node scripts/set-synonyms.js --server localhost:<port> --input map.json --mirror <X.SemanticModel>` |
| A published model over XMLA | Live | `--server "powerbi://api.powerbi.com/v1.0/myorg/<Workspace>" --database "<Model>"` |

Paths are relative to this skill's folder. PBIP mode needs only Node 18+. Live mode also needs
Windows PowerShell and the TOM assemblies — see *Troubleshooting*.

Never edit the PBIP files while the same model is open in Desktop. Desktop won't see the
change, and when you save, Desktop writes its own in-memory copy of the model back to disk,
overwriting yours. Use live mode instead. A live write followed by **Ctrl+S** in Desktop persists
the synonyms (verified in Power BI Desktop, September 2026). Add `--mirror` to put them on disk
immediately as well, so they survive even if Desktop is closed without saving.

To find the Desktop port: `connection_operations` → `ListLocalInstances` on the Power BI
Authoring MCP server returns `Data Source=localhost:<port>`.

## Workflow

1. **Get the exact names.** Use the modeling MCP (`table_operations` → `GetSchema`) or read the
   TMDL. Synonyms bind to names; a typo binds to nothing. The script rejects unknown targets,
   but get them right first.
2. **Draft the map** — see the rules below. Focus on what people actually say: measures and the
   visible columns they filter by. Two to five terms per object is plenty.
3. **Show the map to the user and get approval.** These words change how Copilot answers.
4. **Dry run** with `--dry-run`. Read the report and every warning aloud to the user.
5. **Apply** — the same command without `--dry-run`. It backs up first, writes, then re-reads
   and verifies every term. Exit code 0 means verified.
6. **Tell the user how it persists:**
   - PBIP mode → reopen the `.pbip` in Desktop.
   - Live mode → it's in the running model now; **Ctrl+S** in Desktop to keep it. With
     `--mirror`, the PBIP file on disk is already updated too.
   - Deployed through Git or a deployment pipeline → Microsoft documents that linguistic-schema
     changes need a **model refresh in the service** to take effect (once a day for
     DirectQuery and Direct Lake).

## The map

```json
{
  "Metrics":  { "Revenue": ["turnover", "net sales"], "Avg Order Value": ["AOV", "basket size"] },
  "Customer": { "_table": ["client", "account"], "Segment": ["customer type"] }
}
```

`_table` targets the table itself; every other key is a column or measure in that table.
A full example for a retail model is in `examples/contoso-synonyms.json`.

## Rules for good synonyms

- **Don't reuse another object's name.** `"sales"` on the Revenue measure collides with a
  `Sales` table — Q&A has to guess. The script warns when a term already belongs to another
  object; treat every warning as a question for the user.
- **Business words, not technical ones.** What a sales manager types, not the column's source name.
- **Include abbreviations people use** — `AOV`, `SKU`, `YoY`.
- **No near-duplicates.** Case differences are de-duplicated for you. Beyond that, one clear
  term beats three spellings of it.
- **Don't add synonyms to hidden keys.** Nobody should be querying by them.

## What the script guarantees

- Read → merge → write. Everything it doesn't touch — relationships, visibility, custom
  instructions, every existing term — is preserved exactly. An unchanged file round-trips byte
  for byte, CRLF included.
- New terms are **user-authored**: `{ "term": { "LastModified": "<ISO time>" } }` with **no
  `State` field** — the same shape Power BI Desktop writes when you add a synonym by hand.
- An entity is found by what it is **bound to** (table + property), not by its key.
- A requested term that already exists as a **suggestion** (used at lower priority) or a
  **deleted** entry is promoted to an approved synonym rather than duplicated. An existing
  approved or generated term is left alone.
- Terms are de-duplicated case-insensitively.
- A PBIP without a culture gets `definition/cultures/en-US.tmdl` created and
  `ref cultureInfo en-US` added to `model.tmdl`.
- Backups before every write, in `.synonym-backups/` next to the model (PBIP) or the current
  folder (live).

## Do not

- Write or edit the linguistic-metadata JSON by hand, or ask the model to produce it.
- Use **translation captions** (`ObjectTranslation` / `Caption`) as synonyms. A caption renames
  the field for everyone, and Q&A doesn't use it as an alternate term.
- Give a term a `State` such as `"UserAuthored"`. It isn't a valid value and breaks the
  Q&A setup screen in Desktop.
- Claim the change is saved until the script printed `verified` **and** you told the user how it
  persists.

## Troubleshooting

| Message | Cause | Fix |
|---|---|---|
| `not found in the model` | typo, or the object was renamed | re-read the schema; fix the map |
| `TOM assemblies not found` | live mode needs Microsoft's TOM library | `nuget install Microsoft.AnalysisServices.retail.amd64` and set `PBI_TOM_PATH` to its `lib\net45` folder, or `Install-Module SqlServer -Scope CurrentUser` |
| `hosts N databases; pass -Database` | an XMLA endpoint, not Desktop | add `--database "<Model name>"` |
| `VERIFY FAILED` | the write didn't land | nothing is lost — restore from `.synonym-backups/` if needed and report the output |
| Terms don't show in Desktop after PBIP mode | Desktop had the model open | close without saving, rerun, reopen |

More on the document format: `references/linguistic-metadata.md`.
