# Contoso modelling standards: detail

Loaded only when the agent needs more than the rules table in `SKILL.md`.

## Keys

- **Naming.** `<Entity>ID`: `CustomerID`, `ProductID`, `StoreID`. Both sides of a relationship use
  the same name. Strip `Key`, `Id`, `_id` or `_key` from the end and add `ID`; keep the stem as it is
  (`GeoKey` becomes `GeoID`, not `GeographyID`). A better stem is a separate rename the user asks for.
- **Visibility.** Hidden in every table, fact or dimension. If someone genuinely needs a business
  identifier on a report (an order number, say), that's an attribute: keep it visible, but don't
  name it like a surrogate key.
- **Summarisation.** `none`. Never `sum`, `count` or `average`.
- **Data type.** Leave it alone. Changing a key's type can break the relationship or refresh.
- **Date keys.** `Sales[Date]` → `Date[Date]` is exempt: it's a real date, people filter on it, and
  Copilot needs it.

## Why hidden keys matter for Copilot and data agents

A visible `CustomerKey` competes with `Customer` when someone asks for "sales by customer". Hiding
keys removes a wrong answer from every question, and keeps field lists short for report authors.

## What this skill does not cover

Table names, descriptions, measure formatting and folders are left to `semantic-model-authoring`
and to review. Add rules here, or to `standards.json` if a script can check them, as the team
agrees them.
