/*
 * Run: node --test tests/
 * No dependencies. Fixtures are trimmed from a culture file Power BI Desktop wrote.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { mergeSynonyms, verifySynonyms, toSnake } = require("../scripts/merge-synonyms.js");
const { readCulture, renderCulture, readKnownObjects } = require("../scripts/set-synonyms.js");

const FIXTURE = path.join(__dirname, "fixtures", "desktop-en-US.tmdl");
const CLI = path.join(__dirname, "..", "scripts", "set-synonyms.js");
const NOW = "2026-09-26T10:00:00.000Z";

const fixtureMeta = () => readCulture(fixtureDef()).meta;
function fixtureDef() {
  // readCulture wants a definition/ folder; point it at a temp copy of the fixture.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "syn-fx-"));
  fs.mkdirSync(path.join(d, "cultures"));
  fs.copyFileSync(FIXTURE, path.join(d, "cultures", "en-US.tmdl"));
  return d;
}
const termsOf = (meta, key) => meta.Entities[key].Terms.map((t) => Object.keys(t)[0]);
const bodyOf = (meta, key, word) => {
  const t = meta.Entities[key].Terms.find((x) => Object.keys(x)[0].toLowerCase() === word.toLowerCase());
  return t && t[Object.keys(t)[0]];
};

/* ------------------------------------------------------------ naming */

test("toSnake matches Power BI entity keys", () => {
  assert.equal(toSnake("City"), "city");
  assert.equal(toSnake("City Key"), "city_key");
  assert.equal(toSnake("GrossMargin"), "gross_margin");
  assert.equal(toSnake("WWIInvoiceID"), "wwi_invoice_id");
  assert.equal(toSnake("Margin %"), "margin");
});

/* ------------------------------------------------------------ merge */

test("a model with no metadata gets a fresh document and authored terms", () => {
  const { meta, report } = mergeSynonyms(null, { Metrics: { Revenue: ["turnover"] } }, { now: NOW });
  assert.equal(meta.Version, "4.2.0");
  assert.equal(meta.Language, "en-US");
  const ent = meta.Entities["metrics.revenue"];
  assert.deepEqual(ent.Definition.Binding, { ConceptualEntity: "Metrics", ConceptualProperty: "Revenue" });
  assert.deepEqual(ent.Terms, [{ turnover: { LastModified: NOW } }]);
  assert.ok(report.some((r) => r.action === "added" && r.term === "turnover"));
});

test("authored terms carry LastModified and never a State", () => {
  const { meta } = mergeSynonyms(fixtureMeta(), { City: { _table: ["town centre"] } }, { now: NOW });
  const body = bodyOf(meta, "city", "town centre");
  assert.deepEqual(body, { LastModified: NOW });
  assert.equal("State" in body, false);
});

test("an existing Generated term is left alone, whatever its case", () => {
  const before = fixtureMeta();
  const { meta, report } = mergeSynonyms(before, { City: { _table: ["CITY"] } }, { now: NOW });
  assert.deepEqual(meta.Entities.city, before.Entities.city);
  assert.equal(report.find((r) => r.term)?.action, "skipped");
});

test("a Suggested term that is requested gets promoted to authored", () => {
  const before = fixtureMeta();
  const suggested = before.Entities.city.Terms.map((t) => Object.keys(t)[0])
    .find((w) => bodyOf(before, "city", w).State === "Suggested");
  const { meta, report } = mergeSynonyms(before, { City: { _table: [suggested] } }, { now: NOW });
  const body = bodyOf(meta, "city", suggested);
  assert.equal(body.State, undefined);
  assert.equal(body.Source, undefined);
  assert.equal(body.Weight, undefined);
  assert.equal(body.LastModified, NOW);
  assert.equal(report.find((r) => r.term === suggested).action, "promoted");
  assert.equal(termsOf(meta, "city").length, termsOf(before, "city").length, "no duplicate term added");
});

test("a Deleted term that is requested again is restored", () => {
  const before = { Version: "4.2.0", Language: "en-US", Entities: {
    "sales.channel": { Definition: { Binding: { ConceptualEntity: "Sales", ConceptualProperty: "Channel" } },
      State: "Generated", Terms: [{ route: { State: "Deleted" } }] } } };
  const { meta, report } = mergeSynonyms(before, { Sales: { Channel: ["Route"] } }, { now: NOW });
  assert.deepEqual(meta.Entities["sales.channel"].Terms, [{ route: { LastModified: NOW } }]);
  assert.equal(report[0].action, "restored");
});

test("the entity is found by its Binding, not its key", () => {
  const before = { Version: "4.2.0", Language: "en-US", Entities: {
    legacy_key_from_a_rename: { Definition: { Binding: { ConceptualEntity: "Sales", ConceptualProperty: "Channel" } },
      State: "Generated", Terms: [] } } };
  const { meta } = mergeSynonyms(before, { Sales: { Channel: ["sales channel"] } }, { now: NOW });
  assert.deepEqual(Object.keys(meta.Entities), ["legacy_key_from_a_rename"]);
  assert.deepEqual(termsOf(meta, "legacy_key_from_a_rename"), ["sales channel"]);
});

test("_table targets the table entity, not a column", () => {
  const { meta } = mergeSynonyms(null, { Sales: { _table: ["transactions"] } }, { now: NOW });
  assert.deepEqual(meta.Entities.sales.Definition.Binding, { ConceptualEntity: "Sales" });
});

test("a key collision with a different binding gets a suffixed key", () => {
  const before = { Version: "4.2.0", Language: "en-US", Entities: {
    "sales.channel": { Definition: { Binding: { ConceptualEntity: "Something", ConceptualProperty: "Else" } }, Terms: [] } } };
  const { meta } = mergeSynonyms(before, { Sales: { Channel: ["route"] } }, { now: NOW });
  assert.ok(meta.Entities["sales.channel_2"]);
  assert.equal(meta.Entities["sales.channel"].Terms.length, 0);
});

test("every untouched part of the document is preserved exactly", () => {
  const before = fixtureMeta();
  const { meta } = mergeSynonyms(before, { City: { _table: ["municipal area"] } }, { now: NOW });
  for (const k of ["Version", "Language", "Relationships", "Agents", "CustomInstructions"]) {
    assert.deepEqual(meta[k], before[k], k);
  }
  assert.deepEqual(meta.Entities["city.city_key"], before.Entities["city.city_key"], "Visibility entity untouched");
  assert.deepEqual(meta.Entities["date.date"], before.Entities["date.date"], "authored terms untouched");
});

test("the caller's object is never mutated", () => {
  const before = fixtureMeta();
  const snapshot = JSON.stringify(before);
  mergeSynonyms(before, { City: { _table: ["x1"] } }, { now: NOW });
  assert.equal(JSON.stringify(before), snapshot);
});

test("a term used by another object raises a warning", () => {
  const { warnings } = mergeSynonyms(fixtureMeta(), { Date: { Date: ["city"] } }, { now: NOW });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /also a term for: city/);
});

test("a target that isn't in the model is an error, not a silent binding", () => {
  const known = new Set(["Sales", "Sales\u0000Channel"]);
  const { report } = mergeSynonyms(null, { Sales: { Chanel: ["route"] } }, { now: NOW, knownObjects: known });
  assert.equal(report[0].action, "error");
});

test("empty terms are reported, and whitespace is normalised", () => {
  const { meta, report } = mergeSynonyms(null, { Sales: { _table: ["  ", "  sales   ledger "] } }, { now: NOW });
  assert.equal(report.filter((r) => r.action === "error").length, 1);
  assert.deepEqual(termsOf(meta, "sales"), ["sales ledger"]);
});

test("verifySynonyms finds missing terms and ignores suggestions", () => {
  const meta = fixtureMeta();
  const suggested = termsOf(meta, "city").find((w) => bodyOf(meta, "city", w).State === "Suggested");
  assert.deepEqual(verifySynonyms(meta, { City: { _table: ["city"] } }), []);
  assert.equal(verifySynonyms(meta, { City: { _table: [suggested] } }).length, 1, "a suggestion is not an active synonym");
});

/* ------------------------------------------------------------ TMDL */

test("an unchanged culture file round-trips byte for byte, CRLF included", () => {
  const cur = readCulture(fixtureDef());
  assert.equal(cur.eol, "\r\n");
  assert.equal(renderCulture(cur, cur.meta), fs.readFileSync(FIXTURE, "utf8"));
});

test("after a merge, only the added term changes", () => {
  const cur = readCulture(fixtureDef());
  const { meta } = mergeSynonyms(cur.meta, { City: { _table: ["urban area"] } }, { now: NOW });
  const after = renderCulture(cur, meta);
  assert.ok(after.startsWith("cultureInfo en-US\r\n\r\n\tlinguisticMetadata =\r\n"));
  assert.ok(after.includes('\t\t\t          "urban area": {\r\n\t\t\t            "LastModified": "2026-09-26T10:00:00.000Z"'));
  const reparsed = JSON.parse(JSON.stringify(meta));
  reparsed.Entities.city.Terms.pop();
  assert.deepEqual(reparsed, cur.meta, "remove the one added term and the documents are identical");
});

test("known objects are read from TMDL, including quoted names", () => {
  const def = makePbip();
  const known = readKnownObjects(def);
  assert.ok(known.has("Sales"));
  assert.ok(known.has("Sales\u0000Channel"));
  assert.ok(known.has("Sales\u0000Order ID"));
  assert.ok(known.has("Metrics\u0000Gross Margin"));
  assert.ok(known.has("Metrics\u0000Revenue"));
});

/* ------------------------------------------------------------ CLI end to end */

function makePbip() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "syn-pbip-"));
  const def = path.join(root, "Demo.SemanticModel", "definition");
  fs.mkdirSync(path.join(def, "tables"), { recursive: true });
  fs.writeFileSync(path.join(def, "model.tmdl"),
    "model Model\n\tculture: en-US\n\tsourceQueryCulture: en-US\n\nref table Sales\nref table Metrics\n");
  fs.writeFileSync(path.join(def, "tables", "Sales.tmdl"),
    "table Sales\n\tlineageTag: a\n\n\tcolumn Channel\n\t\tdataType: string\n\n\tcolumn 'Order ID'\n\t\tdataType: int64\n");
  fs.writeFileSync(path.join(def, "tables", "Metrics.tmdl"),
    "table Metrics\n\n\tmeasure Revenue = SUM(Sales[Net])\n\n\tmeasure 'Gross Margin' = [Revenue] - [Cost]\n");
  return def;
}
const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: "utf8" });
const snapshotDir = (d) => fs.readdirSync(d, { recursive: true }).sort()
  .map((f) => { const p = path.join(d, f); return fs.statSync(p).isFile() ? `${f}:${fs.readFileSync(p, "utf8")}` : f; }).join("\n");

test("CLI --dry-run writes nothing", () => {
  const def = makePbip();
  const sm = path.dirname(def);
  const before = snapshotDir(path.dirname(sm));
  const r = run("--model", sm, "--map", JSON.stringify({ Metrics: { Revenue: ["turnover"] } }), "--dry-run");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /--dry-run: nothing written/);
  assert.equal(snapshotDir(path.dirname(sm)), before);
});

test("CLI creates the culture file, references it from model.tmdl, and verifies", () => {
  const def = makePbip();
  const sm = path.dirname(def);
  const map = { Sales: { _table: ["transactions"], Channel: ["sales channel"] }, Metrics: { Revenue: ["turnover", "income"] } };
  const r = run("--model", sm, "--map", JSON.stringify(map));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /verified: every requested term is present/);

  const model = fs.readFileSync(path.join(def, "model.tmdl"), "utf8");
  assert.match(model, /ref table Metrics\n\nref cultureInfo en-US\n/);
  const cur = readCulture(def);
  assert.deepEqual(verifySynonyms(cur.meta, map), []);
  assert.ok(fs.existsSync(path.join(path.dirname(sm), ".synonym-backups")), "model.tmdl was backed up before editing");
});

test("CLI is idempotent: a second run changes nothing", () => {
  const def = makePbip();
  const sm = path.dirname(def);
  const map = JSON.stringify({ Metrics: { Revenue: ["turnover"] } });
  assert.equal(run("--model", sm, "--map", map).status, 0);
  const first = fs.readFileSync(path.join(def, "cultures", "en-US.tmdl"), "utf8");
  const r = run("--model", sm, "--map", map);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /0 added/);
  assert.equal(fs.readFileSync(path.join(def, "cultures", "en-US.tmdl"), "utf8"), first);
});

test("CLI refuses to write when a target doesn't exist", () => {
  const def = makePbip();
  const sm = path.dirname(def);
  const r = run("--model", sm, "--map", JSON.stringify({ Sales: { Chanel: ["route"] } }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not found in the model/);
  assert.equal(fs.existsSync(path.join(def, "cultures")), false);
});

test("tom-io.ps1 finds and loads TOM (connection is expected to fail)", { skip: process.platform !== "win32" }, () => {
  const ps = path.join(__dirname, "..", "scripts", "tom-io.ps1");
  const out = path.join(os.tmpdir(), "syn-tom-probe.json");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps,
    "-Mode", "read", "-Server", "localhost:1", "-OutFile", out], { encoding: "utf8" });
  const last = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  assert.equal(last.ok, false);
  assert.doesNotMatch(last.error, /TOM assemblies not found/, "assemblies should load; only the connection should fail");
});
