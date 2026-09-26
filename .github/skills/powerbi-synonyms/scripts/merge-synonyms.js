/*
 * merge-synonyms.js — the one place synonym logic lives.
 *
 * Takes a semantic model's linguistic metadata (the JSON Power BI keeps on the
 * en-US culture) and a simple synonyms map, and returns new metadata with the
 * synonyms added as user-authored terms — plus a report of what it did.
 *
 * Pure: no file or network access. Both the PBIP mode (set-synonyms.js) and
 * the live mode (tom-io.ps1) route through this, so there is one set of rules.
 *
 * Input map (deliberately simple — the agent never writes the internal format):
 *
 *   { "Sales":   { "_table": ["transactions"], "Channel": ["sales channel"] },
 *     "Metrics": { "Revenue": ["turnover", "income"] } }
 *
 * `_table` targets the table itself; every other key is a column or measure.
 */
"use strict";

const TABLE_KEY = "_table";
const FRESH_VERSION = "4.2.0"; // what Power BI Desktop writes today

/** snake_case an object name the way Power BI keys its entities. */
function toSnake(name) {
  return String(name)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function freshMetadata() {
  return { Version: FRESH_VERSION, Language: "en-US", Entities: {} };
}

/** Normalise a requested term: trim, collapse inner whitespace. */
function cleanTerm(t) {
  return typeof t === "string" ? t.trim().replace(/\s+/g, " ") : "";
}

/** The single key of a term object, e.g. {"turnover": {...}} -> "turnover". */
function termWord(termObj) {
  return termObj && typeof termObj === "object" ? Object.keys(termObj)[0] : undefined;
}

/**
 * Find an entity by what it is bound to, not by its key. Keys are generated
 * and can differ from what toSnake() would produce (renames, older models),
 * so the Binding is the only reliable identity.
 */
function findEntityKey(entities, table, prop) {
  const matches = (ce, cp, eq) =>
    eq(ce, table) && (prop == null ? cp == null : cp != null && eq(cp, prop));
  const exact = (a, b) => a === b;
  const ci = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
  for (const eq of [exact, ci]) {
    for (const [key, ent] of Object.entries(entities)) {
      const b = (ent && ent.Definition && ent.Definition.Binding) || {};
      if (matches(b.ConceptualEntity, b.ConceptualProperty, eq)) return key;
    }
  }
  return null;
}

/** A key that isn't already taken by a *different* binding. */
function uniqueKey(entities, base) {
  if (!entities[base]) return base;
  let n = 2;
  while (entities[`${base}_${n}`]) n++;
  return `${base}_${n}`;
}

/** Every entity that already answers to `word`, excluding deleted and merely-suggested terms. */
function activeOwners(entities, word) {
  const w = word.toLowerCase();
  const owners = [];
  for (const [key, ent] of Object.entries(entities)) {
    for (const t of ent.Terms || []) {
      const tw = termWord(t);
      if (!tw || tw.toLowerCase() !== w) continue;
      const state = t[tw] && t[tw].State;
      if (state === "Deleted" || state === "Suggested") continue;
      owners.push(key);
    }
  }
  return owners;
}

/**
 * Merge a synonyms map into linguistic metadata.
 *
 * @param {object|null} meta   existing metadata, or null for a model that has none
 * @param {object}      map    { Table: { _table: [...], Column: [...] } }
 * @param {object}      opts   { now?: ISO string, knownObjects?: Set("Table" | "Table\u0000Object") }
 * @returns {{ meta: object, report: object[], warnings: string[] }}
 */
function mergeSynonyms(meta, map, opts = {}) {
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new Error("synonyms map must be an object: { Table: { _table: [...], Column: [...] } }");
  }
  const now = opts.now || new Date().toISOString();
  const known = opts.knownObjects || null;

  // Never mutate the caller's object; preserve every key we don't touch.
  const out = meta ? JSON.parse(JSON.stringify(meta)) : freshMetadata();
  if (!out.Entities || typeof out.Entities !== "object") out.Entities = {};
  const entities = out.Entities;

  const report = [];
  const warnings = [];

  for (const [table, objects] of Object.entries(map)) {
    if (!objects || typeof objects !== "object" || Array.isArray(objects)) {
      throw new Error(`"${table}" must map to an object of { object: [terms] }`);
    }
    for (const [objName, terms] of Object.entries(objects)) {
      const prop = objName === TABLE_KEY ? null : objName;
      const label = prop ? `${table}[${prop}]` : table;

      if (!Array.isArray(terms)) throw new Error(`${label}: terms must be an array of strings`);

      // Refuse to bind synonyms to something that isn't in the model — a
      // dangling binding is invisible in the UI and silently does nothing.
      if (known) {
        const id = prop ? `${table}\u0000${prop}` : table;
        if (!known.has(id)) {
          report.push({ target: label, term: null, action: "error", detail: "not found in the model" });
          continue;
        }
      }

      let key = findEntityKey(entities, table, prop);
      if (!key) {
        key = uniqueKey(entities, prop ? `${toSnake(table)}.${toSnake(prop)}` : toSnake(table));
        const binding = { ConceptualEntity: table };
        if (prop) binding.ConceptualProperty = prop;
        entities[key] = { Definition: { Binding: binding }, State: "Generated", Terms: [] };
        report.push({ target: label, term: null, action: "entity-created", detail: key });
      }
      const ent = entities[key];
      if (!Array.isArray(ent.Terms)) ent.Terms = [];

      for (const raw of terms) {
        const word = cleanTerm(raw);
        if (!word) {
          report.push({ target: label, term: String(raw), action: "error", detail: "empty term" });
          continue;
        }

        const idx = ent.Terms.findIndex((t) => (termWord(t) || "").toLowerCase() === word.toLowerCase());
        if (idx >= 0) {
          const existingWord = termWord(ent.Terms[idx]);
          const body = ent.Terms[idx][existingWord] || {};
          if (body.State === "Deleted" || body.State === "Suggested") {
            // Deleted: the user removed it once, and is now asking for it back.
            // Suggested: a thesaurus guess Q&A doesn't treat as confirmed.
            // Either way, requesting it means "make this an authored synonym".
            const prior = body.State;
            const promoted = { LastModified: now };
            if (body.Type) promoted.Type = body.Type;
            ent.Terms[idx] = { [existingWord]: promoted };
            report.push({ target: label, term: existingWord, action: prior === "Deleted" ? "restored" : "promoted", detail: `was ${prior}` });
          } else {
            report.push({ target: label, term: existingWord, action: "skipped", detail: body.State ? `already ${body.State}` : "already authored" });
          }
          continue;
        }

        // Same word already active on another object makes Q&A guess. Warn;
        // the author may mean it, but they should decide that knowingly.
        const others = activeOwners(entities, word).filter((k) => k !== key);
        if (others.length) warnings.push(`"${word}" on ${label} is also a term for: ${others.join(", ")}`);

        // User-authored terms carry LastModified and NO State. A State such as
        // "UserAuthored" is not a valid value and breaks the Q&A setup screen.
        ent.Terms.push({ [word]: { LastModified: now } });
        report.push({ target: label, term: word, action: "added", detail: "" });
      }
    }
  }
  return { meta: out, report, warnings };
}

/** Confirm every requested term is now present and active on the right entity. */
function verifySynonyms(meta, map) {
  const missing = [];
  const entities = (meta && meta.Entities) || {};
  for (const [table, objects] of Object.entries(map)) {
    for (const [objName, terms] of Object.entries(objects)) {
      const prop = objName === TABLE_KEY ? null : objName;
      const key = findEntityKey(entities, table, prop);
      const have = new Set();
      for (const t of (key && entities[key].Terms) || []) {
        const w = termWord(t);
        const s = w && t[w] && t[w].State;
        if (w && s !== "Deleted" && s !== "Suggested") have.add(w.toLowerCase());
      }
      for (const raw of terms) {
        const w = cleanTerm(raw);
        if (w && !have.has(w.toLowerCase())) missing.push(`${prop ? `${table}[${prop}]` : table}: ${w}`);
      }
    }
  }
  return missing;
}

module.exports = { mergeSynonyms, verifySynonyms, toSnake, findEntityKey, freshMetadata, TABLE_KEY };
