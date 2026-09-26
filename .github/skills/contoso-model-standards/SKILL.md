---
name: contoso-model-standards
description: >-
  Contoso's house rules for Power BI semantic models: every join key is hidden, named
  <Entity>ID (CustomerID, not CustomerKey) and never summarised. Use together with
  semantic-model-authoring whenever a semantic model, semantic layer, dataset or PBIP is
  created, reviewed, cleaned up, renamed or prepared for Copilot, or when someone asks to
  "apply our standards", "fix the keys" or "check the model against our rules". Where the two
  skills disagree, these rules win for Contoso models.
---

# Contoso model standards

These are **team rules layered on top of Microsoft's `semantic-model-authoring` skill**. That
skill knows how to model well in general; this one records how *we* do it. Keep it short. The
rules themselves live in `standards.json`, so changing a rule means editing one value, not this file.

## The rules (see `standards.json`)

| Rule | Default | Why |
|---|---|---|
| Key columns end in `keySuffix` | `ID` → `CustomerID`, `ProductID` | One naming style across every model |
| Key columns are hidden | `hideKeys: true` | Report authors and Copilot should use the attributes, not surrogate numbers |
| Key columns don't summarise | `keySummarizeBy: none` | A summed key is a nonsense number on a visual |
| Date keys are exempt | `exemptDateKeys: true` | `Sales[Date]` → `Date[Date]` is a real date people filter on |

A **key column** is any column used in a relationship, plus any column *named* like a key
(`keyNamePattern`, e.g. `GeoKey`) even if no relationship uses it yet.

## Workflow

1. **Save first.** If the model is open in Power BI Desktop, ask the user to press **Ctrl+S** so the
   PBIP files on disk match what's open.
2. **Check.** Run, from this skill's folder:
   `node scripts/check-standards.js --model <path to X.SemanticModel>`
   It's read-only. Exit code 1 means there's something to fix. Use `--json` for the full plan.
3. **Show the plan and get approval.** One table: column, what changes, and every DAX expression the
   checker lists under *references a column to be renamed*. Don't change anything before a yes.
4. **Apply through the Power BI Authoring MCP server**, not by editing TMDL files.
   - `connection_operations` → `ListLocalInstances`, then `Connect` to the Desktop instance.
   - `column_operations` → `Rename` for every rename, in one call (the tools take lists).
     Relationships follow the rename automatically.
   - `column_operations` → `Update` with `isHidden: true` and `summarizeBy: None` for every key.
   - For each DAX expression the checker listed, read it back with `measure_operations` → `Get`. If it
     still names the old column, `measure_operations` → `Update` it with the new name.
5. **Verify.** Run a DAX query for every measure you touched (`dax_query_operations` → `Execute`, e.g.
   `EVALUATE ROW("Customers", [Customers])`) and confirm it returns a number, not an error. Then ask
   the user to **Ctrl+S** and run the checker again. Done means exit code 0: *All N key columns comply*.

## Do not

- Edit the `.tmdl` files by hand to rename columns. A rename has to reach relationships, DAX and
  report bindings; the MCP server and Desktop handle that, text edits don't.
- Rename or hide a date key, or anything the checker didn't list.
- Report success before the second checker run comes back clean.

## Changing the rules for your team

Edit `standards.json`. For example, a team that prefers `CustomerKey` sets `"keySuffix": "Key"` and
`"keyNamePattern": "(ID|Id|_id|_key)$"`. The checker, the plan and this workflow all follow. Put new
rules that need judgement, not a script, in `references/standards.md`.
