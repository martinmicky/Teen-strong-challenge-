# Script logic

This document explains how [`Scripts/Script.js`](./Scripts/Script.js) loads,
transforms, renders, and cycles through the competition results.

## 0. External libraries

The page loads two browser libraries from jsDelivr before the application
script:

- **Papa Parse** parses Google Sheets CSV responses, including quoted cells,
  commas, and line breaks.
- **Lodash** provides common collection operations such as filtering, finding
  columns, dropping rows, and descending ordering.

The remaining functions are application-specific: they connect the sheet
columns to the competition model, build views, render the split tables, and
control the presentation timing.

## 1. Configuration

The `CONFIG` object controls the data source and presentation timing:

- `SHEET_ID` identifies the Google Sheet.
- `TAB` is the preferred sheet name.
- `SWITCH_SECONDS` is the total time assigned to a view.
- `REFRESH_SECONDS` controls how often the sheet is fetched again.
- `DISCIPLINE_PAGE_SIZE` limits each discipline page to 10 rows.
- `AUTO_SCROLL_DELAY_SECONDS` pauses at the top before scrolling.
- `AUTO_SCROLL_END_DELAY_SECONDS` pauses at the bottom before changing page.

The discipline definitions contain the display name, the key used in parsed
data, and the unit shown in the performance column.

## 2. Loading data

`load()` always requests the configured `TAB` sheet. It does not fall back to
the spreadsheet's default sheet or to `gid=0`, because those fallbacks could
load a different table and display unrelated results.

Each successful response is parsed as CSV by Papa Parse through the small
`parseCSV()` adapter. Papa Parse handles quoted cells, escaped quotes, commas
inside cells, and line breaks inside quoted cells.

If Google redirects the request to a login page or returns HTML instead of
CSV, `fetchRows()` reports a concise access error for the configured sheet.
This is a permissions issue, not something client-side JavaScript can bypass:
the sheet must be shared for viewing or the application must use an
authenticated data source.

If a response contains a recognizable header with `Body celkem`, the
column-based parser is used. It finds columns by their normalized names, so
the sheet can be reordered without breaking the display.

If no header is found, `parseFixed()` uses the known fixed column positions of
the `Zadávání` sheet. This keeps the display compatible with exports that do
not include the expected header row.

Every person is normalized to this shape:

```js
{
  name: "Competitor name",
  school: "School name",
  total: 123,
  disciplines: {
    "bench press": {
      performance: 10,
      points: 25
    }
  }
}
```

Missing or non-numeric values become `0`. Empty people with no name and no
total score are removed.

## 3. Ranking and views

`rankRows()` sorts a new filtered list in descending order and assigns the
same rank to equal scores. The original `people` array is not reordered.

`VIEWS` defines the screens shown by the application:

- **Celkové pořadí** ranks competitors by total points.
- Each discipline ranks competitors by that discipline's performance.
- **Družstva** groups competitors by school and adds their total points.

Every view returns:

- `head`: the table headings.
- `rows`: display-ready cell values.
- `paginated: true` for discipline views.

## 4. Discipline pagination

When a discipline is rendered, its complete ranked result is split into pages
of 10 rows using `DISCIPLINE_PAGE_SIZE`.

The current page is stored in `currentPage`. A new view starts at page zero.
Other views are not paginated.

## 5. Static and scrolling table sections

Each rendered page is split into two table elements:

1. The header and first five data rows are placed in `.table-static`.
2. Remaining rows are placed in `.table-scroll`.

The CSS makes only `.table-scroll` scrollable and hides its scrollbar. The
header and first five rows therefore remain visible while the rest moves.

`renderColgroup()` calculates a width for each column from the longest header
or cell value. The same generated `<colgroup>` is inserted into both tables,
which keeps corresponding columns aligned while still giving each column an
appropriate width.

## 6. Auto-scrolling

`startAutoScroll()` targets only `.table-scroll`:

1. Cancel any previous animation and pending start timer.
2. Reset the scroll position to the top.
3. Wait for `AUTO_SCROLL_DELAY_SECONDS`.
4. Animate `scrollTop` to the bottom with `requestAnimationFrame()`.

Auto-scrolling is skipped when there is no overflow or when the user has
enabled `prefers-reduced-motion`.

## 7. View and page timing

`show()` controls the presentation cycle. For a discipline with multiple
pages, the discipline's total `SWITCH_SECONDS` is divided equally between
those pages.

Each discipline page is timed as:

```text
top delay + scroll duration + bottom delay = page duration
```

This means the page remains at the bottom for one second before changing, but
the overall discipline rotation still follows the configured timing.

When the final page finishes, `show()` advances to the next view. Manual tab
selection also resets the selected view to its first page.

## 8. Refreshing

`refreshAll()` reloads the sheet, updates the status text, records any loading
error, and re-renders the current view. A background interval calls it every
`REFRESH_SECONDS`.

The presentation timer is managed separately by `show()`, so refreshing data
does not intentionally change the configured view rotation.

## 9. Startup

`init()` creates one navigation button per view, connects button clicks to
`show()`, loads the first data set, starts the first view, and schedules
periodic refreshes.
