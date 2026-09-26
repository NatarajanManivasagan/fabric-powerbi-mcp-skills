# Source Data — ContosoRetail

Five CSVs holding the same data as `demo/ContosoRetail.pbip`, exported with
**raw, warehouse-style column names** so you can build a fresh file from scratch
and let the MCP clean it up live.

| File | Rows | Grain |
|---|---:|---|
| `fact_sales.csv` | 3,200 | One line per order line, Jan 2024 → Jul 2026 |
| `dim_date.csv` | 1,096 | One row per day, 2024-01-01 → 2026-12-31 |
| `dim_product.csv` | 40 | 5 categories × 10 subcategories |
| `dim_customer.csv` | 60 | 3 segments across 8 countries |
| `dim_geography_region_master.csv` | 8 | Country → region rollup |

UTF-8, comma-separated, CRLF, `yyyy-MM-dd` dates, `.` decimal separator. No
commas inside any value, so no quoting to trip over.

---

## Which demo route to use

**Route A — the shipped PBIP (`demo/ContosoRetail.pbip`).**
Model and 2-page report already built. Use this when you want the finished report
on screen and only need to demo the *cleanup* of one raw table. Follow
`demo/DEMO-GUIDE.md`.

**Route B — these CSVs in a fresh file.**
Everything is raw. Nothing is named properly, nothing is described, no
relationships, no measures. Use this when you want the agent to build the whole
model in front of the room. **Model only — there is no report at the end**, so
budget for that.

You can't do both in 30 minutes. Pick one.

---

## Route B: fresh file walkthrough

### 1. Load

New Power BI Desktop file → **Get data → Text/CSV** → load all five files.
Or: **Get data → Folder** → point at this directory.

Do **not** let Power BI auto-detect relationships if you want the wiring to be
part of the demo — turn it off first in *Options → Current file → Data load*.

### 2. Hand it to the agent

> "Connect to the Power BI Desktop instance that's running and show me the schema
> of every table."

> "This is a raw warehouse extract. Rename the tables and columns to
> business-friendly names — drop the `dim_`/`fact_` prefixes and expand the
> abbreviations. Show me the rename plan before you apply it."

> "Build the star schema: Sales is the fact, everything else is a dimension.
> Create the relationships."

> "Create a `Metrics` table and add these measures: Revenue, Cost, Gross Margin,
> Margin %, Orders, Units Sold, Customers, Avg Order Value, Discount Given,
> Revenue PY, Revenue YoY %. Validate the DAX before you create each one."

> "Hide every key column and set summarizeBy to None."

> "Mark Date as the date table."

> "Add a one-line description to every table, every visible column and every measure."

> "Now audit the model — what's still missing a description, and are any keys
> still visible or summarizing?"

Then `Ctrl+S`, or `database_operations` → `ExportToTmdlFolder`. **Nothing is saved
until you do.**

### 3. Where it should land

If the agent does its job, the model ends up matching the shipped PBIP:

| Raw (CSV) | Cleaned |
|---|---|
| `fact_sales` → `OrdID`, `SaleDt`, `ChnlNm`, `QtySold`, `NetAmt`, `CostAmt`, `DiscAmt` | `Sales` → `OrderID`, `Date`, `Channel`, `Quantity`, `NetAmount`, `CostAmount`, `DiscountAmount` |
| `dim_date` → `FullDt`, `YrNum`, `QtrNm`, `MthNum`, `MthNm`, `MthYrNm`, `MthYrSort` | `Date` → `Date`, `Year`, `Quarter`, `MonthNumber`, `Month`, `MonthYear`, `MonthYearSort` |
| `dim_product` → `ProdKey`, `ProdNm`, `CatNm`, `SubCatNm`, `UnitPrc`, `UnitCst` | `Product` → `ProductKey`, `Product`, `Category`, `Subcategory`, `UnitPrice`, `UnitCost` |
| `dim_customer` → `CustKey`, `CustNm`, `SegNm`, `CityNm`, `CntryNm` | `Customer` → `CustomerKey`, `Customer`, `Segment`, `City`, `Country` |
| `dim_geography_region_master` → `GeoKey`, `CntryNm`, `RgnNm`, `SubRgnNm`, `PopnCnt` | `Geography` → `Geo Key`, `Country`, `Region`, `Sub Region`, `Population` |

**Relationships to build** (all many-to-one, single direction):

```
Sales[ProdKey]  ->  Product[ProdKey]
Sales[CustKey]  ->  Customer[CustKey]
Sales[SaleDt]   ->  Date[FullDt]
Customer[CntryNm] -> Geography[CntryNm]      <- the one everyone forgets
```

Two things to point out on stage:

- `Month` must be sorted by `MonthNumber`, and `MonthYear` by `MonthYearSort`,
  or your charts go alphabetical. A good agent does this unprompted; most don't.
- `Geography` is a country-level rollup, so the relationship goes
  **Geography (one) → Customer (many)** on the country name, not the other way.

---

## Control totals

Load these, build the measures, and you should see exactly:

| Measure | Value |
|---|---|
| Revenue | **$6,232,517** |
| Gross Margin | **$2,114,216** |
| Margin % | **33.9%** |
| Orders | **1,067** |
| Units Sold | **20,784** |
| Customers | **60** |
| Discount Given | **$532,180** |

If your numbers differ, the load or the relationships are wrong — check that
`fact_sales` came in as 3,200 rows and that `NetAmt` typed as a decimal, not text.

> The CSVs and the PBIP agree to within 8 cents on a $6.2M total — Power Query's
> banker's rounding and the export disagree on a handful of rows. Every figure in
> the table above is identical at display precision; the drift is invisible.

## Notes on the data

- Deterministic, not random. Regenerating produces byte-identical files.
- Seasonality is built in: December ×1.55, November ×1.3, January ×0.8,
  June–July ×0.85, plus a 45% upward trend across the period — so the trend line
  has something to show.
- Sales stop at **2026-07-28**; the date table runs to 2026-12-31 on purpose, so
  there is a visible gap at the right edge of any monthly chart. Mention it before
  someone asks.
- `Revenue PY` only returns values from 2025 onward — 2024 has no prior year.
- All 3,200 rows carry an `OrdID` shared by up to 3 lines, which is why
  Orders (1,067) is roughly a third of the row count.
