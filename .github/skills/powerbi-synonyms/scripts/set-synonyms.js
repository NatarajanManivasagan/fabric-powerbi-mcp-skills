#!/usr/bin/env node
/*
 * set-synonyms.js — add Q&A / Copilot synonyms to a Power BI semantic model.
 *
 * PBIP mode (no dependencies beyond Node):
 *   node set-synonyms.js --model <X.SemanticModel | X.pbip> --input synonyms.json [--dry-run]
 *
 * Live mode (a model open in Power BI Desktop, or an XMLA endpoint):
 *   node set-synonyms.js --server localhost:54321 [--database <name>] --input synonyms.json
 *                        [--mirror <X.SemanticModel>] [--dry-run]
 *
 * Why this exists: the Power BI Authoring MCP server (formerly Modeling MCP)
 * has no tool that reads or writes linguistic metadata, and the official
 * semantic-model skill leaves synonyms to the user. Synonyms live in
 * one JSON document on the en-US culture; this tool reads it, merges in new
 * user-authored terms, writes it back, and verifies the result.
 *
 * Every write is preceded by a backup. --dry-run writes nothing.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { mergeSynonyms, verifySynonyms } = require("./merge-synonyms.js");

/* ---------------------------------------------------------------- args */
function parseArgs(argv) {
  const a = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === "--model") a.model = next();
    else if (k === "--server") a.server = next();
    else if (k === "--database") a.database = next();
    else if (k === "--mirror") a.mirror = next();
    else if (k === "--input") a.input = next();
    else if (k === "--map") a.map = next();
    else if (k === "--backup-dir") a.backupDir = next();
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--help" || k === "-h") a.help = true;
    else throw new Error(`unknown argument: ${k}`);
  }
  return a;
}

const USAGE = `
usage:
  PBIP:  node set-synonyms.js --model <X.SemanticModel|X.pbip> --input synonyms.json [--dry-run]
  Live:  node set-synonyms.js --server localhost:<port> [--database <name>] --input synonyms.json
                              [--mirror <X.SemanticModel>] [--dry-run]
  --map '<json>' may replace --input. --backup-dir overrides where backups go.
`;

/* ------------------------------------------------------------ PBIP I/O */

/** Accept a .SemanticModel folder, its definition/ folder, or a .pbip file. */
function resolveDefinitionDir(p) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) throw new Error(`not found: ${abs}`);
  if (fs.statSync(abs).isFile() && abs.toLowerCase().endsWith(".pbip")) {
    const sm = abs.replace(/\.pbip$/i, ".SemanticModel");
    if (!fs.existsSync(sm)) throw new Error(`no ${path.basename(sm)} next to ${path.basename(abs)}`);
    return path.join(sm, "definition");
  }
  if (path.basename(abs).toLowerCase() === "definition") return abs;
  const def = path.join(abs, "definition");
  if (fs.existsSync(path.join(def, "model.tmdl"))) return def;
  throw new Error(`${abs} is not a TMDL semantic model (no definition/model.tmdl)`);
}

const LM_OPEN = /^\tlinguisticMetadata =\s*$/;
const LM_CLOSE = /^\t\tcontentType: json\s*$/;

/** Read cultures/en-US.tmdl and pull out the linguistic metadata JSON. */
function readCulture(defDir) {
  const file = path.join(defDir, "cultures", "en-US.tmdl");
  if (!fs.existsSync(file)) return { file, exists: false, eol: "\r\n", meta: null };
  const text = fs.readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const open = lines.findIndex((l) => LM_OPEN.test(l));
  if (open < 0) return { file, exists: true, text, eol, lines, meta: null, block: null };
  const close = lines.findIndex((l, i) => i > open && LM_CLOSE.test(l));
  if (close < 0) throw new Error(`${file}: linguisticMetadata block has no 'contentType: json' terminator`);
  const json = lines.slice(open + 1, close).map((l) => l.replace(/^\t\t\t/, "")).join("\n");
  let meta;
  try { meta = JSON.parse(json); } catch (e) { throw new Error(`${file}: linguisticMetadata is not valid JSON (${e.message})`); }
  return { file, exists: true, text, eol, lines, meta, block: { open, close } };
}

/** The block exactly as Power BI Desktop writes it: JSON indented 2, prefixed with three tabs. */
function blockLines(meta) {
  const body = JSON.stringify(meta, null, 2).split("\n").map((l) => "\t\t\t" + l);
  return ["\tlinguisticMetadata =", ...body, "\t\tcontentType: json"];
}

function renderCulture(cur, meta) {
  const eol = cur.eol;
  if (!cur.exists) {
    return ["cultureInfo en-US", "", ...blockLines(meta), "", ""].join(eol);
  }
  const lines = cur.lines.slice();
  if (cur.block) {
    lines.splice(cur.block.open, cur.block.close - cur.block.open + 1, ...blockLines(meta));
  } else {
    const at = lines.findIndex((l) => /^cultureInfo\s/.test(l));
    lines.splice(at + 1, 0, "", ...blockLines(meta));
  }
  return lines.join(eol);
}

/** model.tmdl must reference the culture, or Desktop never loads the file. */
function ensureCultureRef(defDir) {
  const file = path.join(defDir, "model.tmdl");
  const text = fs.readFileSync(file, "utf8");
  if (/^ref cultureInfo en-US\s*$/m.test(text)) return null;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/(\r?\n)+$/, "").split(/\r?\n/);
  let lastRef = -1;
  lines.forEach((l, i) => { if (/^ref table /.test(l)) lastRef = i; });
  const insertAt = lastRef >= 0 ? lastRef + 1 : lines.length;
  lines.splice(insertAt, 0, "", "ref cultureInfo en-US");
  if (!/^\tculture:\s*en-US\s*$/m.test(text)) {
    const m = lines.findIndex((l) => /^model\s/.test(l));
    lines.splice(m + 1, 0, "\tculture: en-US");
  }
  return { file, before: text, after: lines.join(eol) + eol };
}

/** Table / column / measure names, so we never bind to something that doesn't exist. */
function readKnownObjects(defDir) {
  const known = new Set();
  const dir = path.join(defDir, "tables");
  if (!fs.existsSync(dir)) return known;
  const unq = (s) => (s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s);
  const NAME = "('(?:[^']|'')+'|[^\\s=']+)";
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".tmdl"))) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const t = text.match(new RegExp(`^table ${NAME}`, "m"));
    if (!t) continue;
    const table = unq(t[1]);
    known.add(table);
    for (const m of text.matchAll(new RegExp(`^\\t(?:column|measure) ${NAME}`, "gm"))) {
      known.add(`${table}\u0000${unq(m[1])}`);
    }
  }
  return known;
}

/* ------------------------------------------------------------ live I/O */

const TOM_IO = path.join(__dirname, "tom-io.ps1");

function tom(mode, args, extra = []) {
  const ps = [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", TOM_IO,
    "-Mode", mode, "-Server", args.server,
    ...(args.database ? ["-Database", args.database] : []),
    ...extra,
  ];
  const r = spawnSync("powershell.exe", ps, { encoding: "utf8" });
  const out = (r.stdout || "").trim();
  const last = out.split(/\r?\n/).pop() || "";
  let status;
  try { status = JSON.parse(last); } catch { status = null; }
  if (r.status !== 0 || !status || status.ok === false) {
    const why = (status && status.error) || (r.stderr || out || "no output").trim();
    throw new Error(`tom-io ${mode} failed: ${why}`);
  }
  return status;
}

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pbisyn-")), name);
}

/* ------------------------------------------------------------ helpers */

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backup(dir, name, content) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}.${stamp()}`);
  fs.writeFileSync(p, content, "utf8");
  return p;
}

function desktopRunning() {
  if (process.platform !== "win32") return false;
  const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq PBIDesktop.exe", "/NH"], { encoding: "utf8" });
  return /PBIDesktop\.exe/i.test(r.stdout || "");
}

function printReport(report, warnings) {
  const icon = { added: "+", promoted: "^", restored: "^", skipped: "=", "entity-created": "*", error: "!" };
  const rows = report.filter((r) => r.action !== "entity-created");
  const width = Math.max(10, ...rows.map((r) => r.target.length));
  for (const r of report) {
    if (r.action === "entity-created") { console.log(`  *  ${r.target.padEnd(width)}  new entity ${r.detail}`); continue; }
    console.log(`  ${icon[r.action] || "?"}  ${r.target.padEnd(width)}  ${String(r.term ?? "").padEnd(24)} ${r.action}${r.detail ? ` (${r.detail})` : ""}`);
  }
  const n = (a) => report.filter((r) => r.action === a).length;
  console.log(`\n  ${n("added")} added, ${n("promoted") + n("restored")} promoted/restored, ${n("skipped")} already present, ${n("error")} errors`);
  for (const w of warnings) console.log(`  warning: ${w}`);
}

/* ---------------------------------------------------------------- main */

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.model && !args.server) || (!args.input && !args.map)) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 2);
  }
  const map = JSON.parse(args.map || fs.readFileSync(args.input, "utf8"));

  if (args.model) return runPbip(args, map);
  return runLive(args, map);
}

function runPbip(args, map) {
  const defDir = resolveDefinitionDir(args.model);
  const smDir = path.dirname(defDir);
  const backupDir = args.backupDir || path.join(path.dirname(smDir), ".synonym-backups");
  console.log(`\nPBIP mode  ${smDir}`);

  if (!args.dryRun && desktopRunning()) {
    console.log("  warning: Power BI Desktop is running. If this model is open in it, close it first —");
    console.log("           Desktop will not see the file change, and saving from Desktop can overwrite it.");
    console.log("           Or use live mode (--server) with --mirror to update both.\n");
  }

  const cur = readCulture(defDir);
  const known = readKnownObjects(defDir);
  const { meta, report, warnings } = mergeSynonyms(cur.meta, map, { knownObjects: known });
  printReport(report, warnings);

  if (report.some((r) => r.action === "error")) {
    console.log("\n  Nothing written: fix the errors above first.");
    process.exit(1);
  }
  if (args.dryRun) { console.log("\n  --dry-run: nothing written."); return; }

  const cultureText = renderCulture(cur, meta);
  const ref = ensureCultureRef(defDir);

  if (cur.exists) console.log(`\n  backup  ${backup(backupDir, `${path.basename(smDir)}.en-US.tmdl`, cur.text)}`);
  if (ref) console.log(`  backup  ${backup(backupDir, `${path.basename(smDir)}.model.tmdl`, ref.before)}`);

  fs.mkdirSync(path.dirname(cur.file), { recursive: true });
  fs.writeFileSync(cur.file, cultureText, "utf8");
  console.log(`  wrote   ${path.relative(smDir, cur.file)}${cur.exists ? "" : " (new)"}`);
  if (ref) { fs.writeFileSync(ref.file, ref.after, "utf8"); console.log(`  wrote   ${path.relative(smDir, ref.file)} (added ref cultureInfo en-US)`); }

  const missing = verifySynonyms(readCulture(defDir).meta, map);
  if (missing.length) { console.log(`\n  VERIFY FAILED — missing after write:\n    ${missing.join("\n    ")}`); process.exit(1); }
  console.log("  verified: every requested term is present.\n");
  console.log("  Open (or reopen) the .pbip in Power BI Desktop to load the change.");
}

function runLive(args, map) {
  console.log(`\nLive mode  ${args.server}${args.database ? ` / ${args.database}` : ""}`);
  const backupDir = args.backupDir || path.join(process.cwd(), ".synonym-backups");

  const readTo = tmpFile("current.json");
  const r = tom("read", args, ["-OutFile", readTo]);
  const current = r.hasMetadata ? JSON.parse(fs.readFileSync(readTo, "utf8")) : null;
  console.log(`  database ${r.database}${r.hasMetadata ? "" : "  (no linguistic metadata yet)"}`);

  const schemaTo = tmpFile("schema.json");
  tom("schema", args, ["-OutFile", schemaTo]);
  const known = new Set(JSON.parse(fs.readFileSync(schemaTo, "utf8")).map((o) => (o.object ? `${o.table}\u0000${o.object}` : o.table)));

  const { meta, report, warnings } = mergeSynonyms(current, map, { knownObjects: known });
  printReport(report, warnings);
  if (report.some((x) => x.action === "error")) { console.log("\n  Nothing written: fix the errors above first."); process.exit(1); }
  if (args.dryRun) { console.log("\n  --dry-run: nothing written."); return; }

  const writeFrom = tmpFile("new.json");
  fs.writeFileSync(writeFrom, JSON.stringify(meta, null, 2), "utf8");
  const w = tom("write", args, ["-InFile", writeFrom, "-BackupDir", backupDir]);
  if (w.backup) console.log(`\n  backup  ${w.backup}`);
  console.log("  wrote   model culture en-US (SaveChanges)");

  const verifyTo = tmpFile("verify.json");
  tom("read", args, ["-OutFile", verifyTo]);
  const missing = verifySynonyms(JSON.parse(fs.readFileSync(verifyTo, "utf8")), map);
  if (missing.length) { console.log(`\n  VERIFY FAILED — missing after write:\n    ${missing.join("\n    ")}`); process.exit(1); }
  console.log("  verified: every requested term is present in the live model.");

  if (args.mirror) {
    // Keep the PBIP on disk in step with the live model now. Desktop's own
    // save does carry a live write through (observed, Sept 2026), but this
    // way the change is on disk even if Desktop is closed without saving.
    const defDir = resolveDefinitionDir(args.mirror);
    const cur = readCulture(defDir);
    const ref = ensureCultureRef(defDir);
    const smName = path.basename(path.dirname(defDir));
    if (cur.exists) console.log(`  backup  ${backup(backupDir, `${smName}.en-US.tmdl`, cur.text)}`);
    fs.mkdirSync(path.dirname(cur.file), { recursive: true });
    fs.writeFileSync(cur.file, renderCulture(cur, meta), "utf8");
    if (ref) fs.writeFileSync(ref.file, ref.after, "utf8");
    console.log(`  mirror  ${cur.file}`);
  }
  console.log("\n  In Desktop the model is already updated. Save (Ctrl+S) to keep it in the .pbix/.pbip.");
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(`\nerror: ${e.message}\n`); process.exit(1); }
}

module.exports = { resolveDefinitionDir, readCulture, renderCulture, blockLines, ensureCultureRef, readKnownObjects };
