"use strict";
// node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { check } = require("../scripts/check-standards.js");

const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "standards.json"), "utf8"));

// Build a tiny PBIP model folder: a fact, two dimensions, a date table, a measure.
function model({ customerKey = "CustomerKey", hidden = false, summarize = "none", extra = "" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stds-"));
  const def = path.join(dir, "definition", "tables");
  fs.mkdirSync(def, { recursive: true });
  const col = (n, t, h, s) => `\tcolumn ${n}\n\t\tdataType: ${t}\n${h ? "\t\tisHidden\n" : ""}\t\tsummarizeBy: ${s}\n\t\tsourceColumn: ${n}\n\n`;
  fs.writeFileSync(path.join(def, "Sales.tmdl"),
    `table Sales\n\n${col(customerKey, "int64", hidden, summarize)}${col("Date", "dateTime", false, "none")}${col("Amount", "double", false, "sum")}`);
  fs.writeFileSync(path.join(def, "Customer.tmdl"),
    `table Customer\n\n${col(customerKey, "int64", hidden, summarize)}${col("Customer", "string", false, "none")}${extra}`);
  fs.writeFileSync(path.join(def, "Date.tmdl"), `table Date\n\n${col("Date", "dateTime", false, "none")}`);
  fs.writeFileSync(path.join(def, "Metrics.tmdl"),
    `table Metrics\n\n\tmeasure Customers = DISTINCTCOUNT ( Sales[${customerKey}] )\n\t\tformatString: 0\n\n\tmeasure 'Total Amount' = SUM ( Sales[Amount] )\n\n`);
  fs.writeFileSync(path.join(dir, "definition", "relationships.tmdl"),
    `relationship r1\n\tfromColumn: Sales.${customerKey}\n\ttoColumn: Customer.${customerKey}\n\nrelationship r2\n\tfromColumn: Sales.Date\n\ttoColumn: Date.Date\n`);
  return dir;
}

test("flags a visible, badly named join key on both sides", () => {
  const r = check(model(), RULES);
  assert.deepStrictEqual(r.keys.map((k) => `${k.table}[${k.column}]`), ["Customer[CustomerKey]", "Sales[CustomerKey]"]);
  for (const k of r.keys) assert.deepStrictEqual(k.issues, ["rename to CustomerID", "hide"]);
  assert.strictEqual(r.violations, 4);
});

test("date keys are exempt", () => {
  const r = check(model(), RULES);
  assert.ok(!r.keys.some((k) => k.column === "Date"));
  const r2 = check(model(), { ...RULES, exemptDateKeys: false });
  assert.ok(r2.keys.some((k) => k.column === "Date"));
});

test("lists DAX that references a column to be renamed", () => {
  const r = check(model(), RULES);
  assert.strictEqual(r.daxRefs.length, 1);
  assert.strictEqual(r.daxRefs[0].owner, "Metrics[Customers]");
});

test("a compliant model passes", () => {
  const r = check(model({ customerKey: "CustomerID", hidden: true }), RULES);
  assert.strictEqual(r.violations, 0);
  assert.strictEqual(r.daxRefs.length, 0);
});

test("summarising keys are flagged", () => {
  const r = check(model({ customerKey: "CustomerID", hidden: true, summarize: "sum" }), RULES);
  assert.ok(r.keys.every((k) => k.issues.includes("summarizeBy sum -> none")));
});

test("a key-named column outside any relationship is still a key", () => {
  const extra = "\tcolumn GeoKey\n\t\tdataType: int64\n\t\tsummarizeBy: sum\n\t\tsourceColumn: GeoKey\n\n";
  const r = check(model({ customerKey: "CustomerID", hidden: true, extra }), RULES);
  const geo = r.keys.find((k) => k.column === "GeoKey");
  assert.ok(geo);
  assert.deepStrictEqual(geo.issues, ["rename to GeoID", "hide", "summarizeBy sum -> none"]);
});

test("ID-named columns outside relationships are listed, not checked", () => {
  const extra = "\tcolumn GeoID\n\t\tdataType: int64\n\t\tisHidden\n\t\tsummarizeBy: none\n\t\tsourceColumn: GeoID\n\n";
  const r = check(model({ customerKey: "CustomerID", hidden: true, extra }), RULES);
  assert.strictEqual(r.violations, 0);
  assert.deepStrictEqual(r.unchecked.map((u) => u.column), ["GeoID"]);
});

test("changing standards.json changes the rules", () => {
  const keyTeam = { ...RULES, keySuffix: "Key", keyNamePattern: "(ID|Id|_id|_key)$" };
  const ok = check(model(), { ...keyTeam, hideKeys: false });
  assert.strictEqual(ok.violations, 0);
  const r = check(model({ customerKey: "CustomerID", hidden: true }), keyTeam);
  assert.ok(r.keys.every((k) => k.issues.includes("rename to CustomerKey")));
});
