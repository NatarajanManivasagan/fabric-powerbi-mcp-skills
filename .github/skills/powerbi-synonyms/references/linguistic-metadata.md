# Linguistic metadata — the parts that matter for synonyms

What follows is observed from culture files written by Power BI Desktop (document version
`4.2.0`, September 2026). It is not an official schema. Microsoft doesn't publish one, and
the format can change between releases.

## Where it lives

| Place | Path |
|---|---|
| The model (TOM) | `Model.Cultures["en-US"].LinguisticMetadata.Content` — a JSON string, `ContentType = Json` |
| A PBIP on disk | `<X>.SemanticModel/definition/cultures/en-US.tmdl` |
| `model.tmdl` | must contain `ref cultureInfo en-US`, or Desktop never loads the culture file |

In the TMDL file the JSON sits between `linguisticMetadata =` and `contentType: json`,
indented two spaces and prefixed with three tabs:

```
cultureInfo en-US

	linguisticMetadata =
			{
			  "Version": "4.2.0",
			  "Language": "en-US",
			  "Entities": { ... }
			}
		contentType: json
```

## Top level

| Key | Meaning |
|---|---|
| `Version`, `Language` | document version and culture |
| `Entities` | one entry per table, column or measure Q&A knows about — **synonyms live here** |
| `Relationships` | phrasings Power BI generates between entities — leave alone |
| `Agents` | internal bookkeeping — leave alone |
| `CustomInstructions` | the free-text AI instructions, when set — leave alone |

## An entity

```json
"sales.channel": {
  "Definition": { "Binding": { "ConceptualEntity": "Sales", "ConceptualProperty": "Channel" } },
  "State": "Generated",
  "Terms": [
    { "channel":         { "State": "Generated" } },
    { "distribution":    { "Type": "Noun", "State": "Suggested", "Source": { "Agent": "Thesaurus" }, "Weight": 0.7 } },
    { "route to market": { "LastModified": "2026-09-26T10:00:00.000Z" } }
  ]
}
```

- The **key** (`sales.channel`) is snake_case by convention, but it is generated. After a
  rename it may no longer match the object's name. The **`Binding`** is the entity's real
  identity: `ConceptualEntity` is the table, and `ConceptualProperty` is the column or measure
  (omitted for the table itself).
- Entities may also carry `Visibility` (whether Copilot/Q&A sees the object) and `SemanticType`.

## Term states

Each term is a one-key object: `{ "<the word>": { ... } }`.

| Body | What it is | How it's used |
|---|---|---|
| `{ "State": "Generated" }` | derived from the object's own name | a normal term |
| `{}` | seen on some generated entities alongside the generated term | leave alone |
| `{ "LastModified": "..." }` — **no State** | **authored by a person** — Microsoft's UI calls these *approved synonyms* | full priority |
| `{ "State": "Suggested", "Source": {...}, "Weight": n }` | a *suggestion* from the thesaurus, report renames or shared org synonyms | used, but at **lower priority** than approved synonyms and flagged as low confidence |
| `{ "State": "Deleted" }` | a suggestion or term a person removed | not used, and not suggested again |

That is why the script *promotes* a requested term that already exists as a suggestion: the
user is asking for it to be an approved synonym, not a low-confidence guess.

An authored term has **no `State`**. Values like `"UserAuthored"` or `"Authored"` on a term are
not valid. The Q&A setup screen fails to open ("Something went wrong") until they're removed.

## Who reads synonyms

Microsoft's guidance for **Fabric data agents** lists synonyms among the semantic model metadata
the agent uses to interpret questions. **Q&A** uses them directly. In September 2026 Desktop's
Q&A setup screen carried the banner *"Q&A will be retiring in December 2026. Use Prep data for AI
to build natural language experiences."* Microsoft Learn gives February 2027. Either way, the
Q&A setup screen is not a long-term place to manage synonyms. The per-field **Synonyms** box in
Model view reads and writes the same terms this skill does.

## After deployment

Microsoft documents that changes to the linguistic schema (LSDL) arriving through **Git
integration or deployment pipelines** only take effect after the model is **refreshed in the
Power BI service**. That applies to synonyms written by this skill into a PBIP that you then
deploy. For DirectQuery and Direct Lake models, this sync happens only once a day. Source:
*Prepare your data for AI*, considerations and limitations, on Microsoft Learn.

## Why not translation captions?

Cultures also hold **object translations**: a `Caption` per object, per language. Writing a
synonym there looks as if it works, because the write succeeds and reads back. But a caption is
a *display name*: the field shows up renamed in the field list and in visuals. Q&A doesn't
treat it as an alternate term either. Several objects given the same caption also collide. The
place for synonyms is `Entities[...].Terms`.
