#!/usr/bin/env node
/*
 * check-standards.js — check a PBIP semantic model's key columns against the house rules.
 *
 *   node check-standards.js --model <X.SemanticModel> [--json] [--rules <standards.json>]
 *
 * A key column is any column used in a relationship, plus any column whose name looks like a
 * surrogate key (keyNamePattern, e.g. GeoKey). Date columns joined to a date table are exempt
 * when exemptDateKeys is true. For each key it checks:
 *   - the name ends with keySuffix       (CustomerKey -> CustomerID)
 *   - it is hidden                       (hideKeys)
 *   - it doesn't summarise               (keySummarizeBy)
 * and lists every DAX expression that references a column it proposes to rename.
 *
 * Read-only. Exit code 0 = compliant, 1 = violations found, 2 = error.
 * The rules live in ../standards.json, so a team changes the rules there, not in this code.
 */
"use strict";
const fs = require("fs");
const path = require("path");

// ---- args -------------------------------------------------------------------------------
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
const unq = (s) => s.trim().replace(/^'(.*)'$/, "$1").replace(/''/g, "'");

// ---- TMDL reading ------------------------------------------------------------------------
function splitRef(ref) {
  // Table.Column where either side may be 'quoted with spaces'
  const m = ref.trim().match(/^('(?:[^']|'')+'|[^.]+)\.('(?:[^']|'')+'|.+)$/);
  if (!m) throw new Error(`can't read relationship column '${ref}'`);
  return { table: unq(m[1]), column: unq(m[2]) };
}

function readModel(modelDir) {
  const def = path.join(modelDir, "definition");
  if (!fs.existsSync(def)) throw new Error(`${modelDir} has no definition/ folder. Pass the .SemanticModel folder.`);
  const tables = new Map();       // name -> { columns: Map(name -> props), exprs: [{ owner, text }] }
  const tdir = path.join(def, "tables");
  for (const f of fs.readdirSync(tdir).filter((n) => n.endsWith(".tmdl"))) {
    const lines = fs.readFileSync(path.join(tdir, f), "utf8").split(/\r?\n/);
    let table = null, col = null, owner = null;
    for (const line of lines) {
      let m;
      if ((m = line.match(/^table\s+(.+?)\s*$/))) { table = { name: unq(m[1]), columns: new Map(), exprs: [] }; tables.set(table.name, table); continue; }
      if (!table) continue;
      if ((m = line.match(/^\t(column|measure)\s+('(?:[^']|'')+'|[^=\s]+)\s*(=\s*(.*))?$/))) {
        const name = unq(m[2]);
        owner = `${table.name}[${name}]`;
        col = null;
        if (m[1] === "column") { col = { name, dataType: "", isHidden: false, summarizeBy: "default", calculated: !!m[3] }; table.columns.set(name, col); }
        if (m[4]) table.exprs.push({ owner, kind: m[1], text: m[4] });
        continue;
      }
      if (/^\t\S/.test(line)) { col = null; owner = null; continue; }      // partition, hierarchy, annotation…
      if (col && (m = line.match(/^\t\t(dataType|summarizeBy):\s*(\S+)/))) col[m[1]] = m[2];
      if (col && /^\t\tisHidden\s*$/.test(line)) col.isHidden = true;
      if (owner && /^\t\t\t|^\t\t```|^\t\t[^:\s]*\(/.test(line)) table.exprs.push({ owner, kind: "expression", text: line.trim() });
    }
  }
  const rels = [];
  const rf = path.join(def, "relationships.tmdl");
  if (fs.existsSync(rf)) {
    let cur = null;
    for (const line of fs.readFileSync(rf, "utf8").split(/\r?\n/)) {
      let m;
      if (/^relationship\s/.test(line)) { cur = {}; rels.push(cur); continue; }
      if (cur && (m = line.match(/^\t(fromColumn|toColumn):\s*(.+)$/))) cur[m[1]] = splitRef(m[2]);
    }
  }
  return { tables, rels };
}

// ---- the check -------------------------------------------------------------------------
function check(modelDir, rules) {
  const { tables, rels } = readModel(modelDir);
  const suffix = rules.keySuffix || "ID";
  const pattern = new RegExp(rules.keyNamePattern || "(Key|Id|_id|_key)$");
  const keys = new Map();          // "T[C]" -> { table, column, why }
  const col = (t, c) => (tables.get(t) || { columns: new Map() }).columns.get(c);

  for (const r of rels) {
    for (const side of [r.fromColumn, r.toColumn]) {
      if (!side) continue;
      const c = col(side.table, side.column);
      if (!c) continue;
      if (rules.exemptDateKeys && /^date(time)?$/i.test(c.dataType)) continue;
      keys.set(`${side.table}[${side.column}]`, { table: side.table, column: side.column, why: "join key" });
    }
  }
  for (const [t, tb] of tables) for (const [c] of tb.columns) {
    const id = `${t}[${c}]`;
    if (!keys.has(id) && pattern.test(c)) keys.set(id, { table: t, column: c, why: "named like a key, not in a relationship" });
  }

  const findings = [];
  const renames = [];
  for (const k of [...keys.values()].sort((a, b) => (a.table + a.column).localeCompare(b.table + b.column))) {
    const c = col(k.table, k.column);
    const issues = [];
    let to = null;
    if (!k.column.endsWith(suffix)) {
      const stem = k.column.replace(pattern, "").replace(/_+$/, "");
      to = stem + suffix;
      issues.push(`rename to ${to}`);
      renames.push({ table: k.table, from: k.column, to });
    }
    if (rules.hideKeys && !c.isHidden) issues.push("hide");
    const want = (rules.keySummarizeBy || "none").toLowerCase();
    if (c.summarizeBy.toLowerCase() !== want) issues.push(`summarizeBy ${c.summarizeBy} -> ${rules.keySummarizeBy}`);
    findings.push({ ...k, hidden: c.isHidden, summarizeBy: c.summarizeBy, issues, renameTo: to });
  }

  // DAX that mentions a column we plan to rename
  const daxRefs = [];
  for (const r of renames) {
    const tq = `(?:'${r.table.replace(/'/g, "''")}'|${r.table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`;
    const re = new RegExp(`${tq}\\s*\\[${r.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`);
    for (const tb of tables.values()) for (const e of tb.exprs) if (re.test(e.text)) daxRefs.push({ owner: e.owner, references: `${r.table}[${r.from}]`, text: e.text });
  }
  // Columns already named like an ID but in no relationship (OrderID, or a key renamed earlier).
  // Not checked: they may be business identifiers people filter by. Listed so none drop out silently.
  const unchecked = [];
  for (const [t, tb] of tables) for (const [c, p] of tb.columns) {
    if (!keys.has(`${t}[${c}]`) && c.endsWith(suffix)) unchecked.push({ table: t, column: c, hidden: p.isHidden, summarizeBy: p.summarizeBy });
  }
  const violations = findings.reduce((n, f) => n + f.issues.length, 0);
  return { model: modelDir, rules, keys: findings, renames, daxRefs, unchecked, violations };
}

// ---- output -------------------------------------------------------------------------------
function print(res) {
  const out = [];
  out.push(`Model standards check  ${res.model}`);
  out.push(`  rules: keys end in "${res.rules.keySuffix}", hidden: ${res.rules.hideKeys}, summarizeBy: ${res.rules.keySummarizeBy}${res.rules.exemptDateKeys ? ", date keys exempt" : ""}`);
  out.push("");
  const w = Math.max(...res.keys.map((k) => `${k.table}[${k.column}]`.length), 10);
  for (const k of res.keys) {
    const id = `${k.table}[${k.column}]`.padEnd(w);
    out.push(`  ${k.issues.length ? "x" : "ok"}  ${id}  ${k.issues.length ? k.issues.join(" · ") : "compliant"}${k.why !== "join key" ? `   (${k.why})` : ""}`);
  }
  if (res.daxRefs.length) {
    out.push("");
    out.push("  DAX that references a column to be renamed. Check it after the rename:");
    for (const d of res.daxRefs) out.push(`    ${d.owner}  ${d.text}`);
  }
  if (res.unchecked.length) {
    out.push("");
    out.push("  Named like an ID but in no relationship, so not checked. Hide them unless people filter by them:");
    for (const u of res.unchecked) out.push(`    ${u.table}[${u.column}]  ${u.hidden ? "hidden" : "visible"}, summarizeBy ${u.summarizeBy}`);
  }
  out.push("");
  out.push(res.violations ? `  ${res.violations} issue(s) on ${res.keys.filter((k) => k.issues.length).length} of ${res.keys.length} key columns.` : `  All ${res.keys.length} key columns comply.`);
  return out.join("\n");
}

if (require.main === module) {
  try {
    const model = arg("--model");
    if (!model) throw new Error("usage: node check-standards.js --model <X.SemanticModel> [--json] [--rules <standards.json>]");
    const rulesPath = arg("--rules") || path.join(__dirname, "..", "standards.json");
    const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
    const res = check(model, rules);
    console.log(process.argv.includes("--json") ? JSON.stringify(res, null, 2) : print(res));
    process.exit(res.violations ? 1 : 0);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }
}

module.exports = { check, readModel, print };
