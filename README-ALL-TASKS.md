# All Tasks workspace

Open **All Tasks** from the desktop task icon or mobile menu (`#/all-tasks`). The entry also participates in the existing menu-visibility settings.

## Data and compatibility

- Reads original task records and columns from `hubs/{youtube,tiktok,personal,working}`. It does not copy records or initialize source boards. Task identity includes both source and document ID.
- Manually created tasks are independent records in `hubs/workspace/tasks`. Selecting YouTube or TikTok as a category does not create a platform account or insert a task into that platform's board.
- Edits use partial Firestore updates, retaining source attachments, checklists and other specialized fields.
- Moving a source task uses its original `columnId` when a matching source column exists. If a status is absent, `allTasksStatus` and `allTasksColumnId` preserve a unified-view status without changing the original board structure. A subsequent move to a different original column takes precedence.
- Unrecognized custom source columns appear under Plan, with their original column name shown on the card. Missing priority defaults to Medium (or Urgent for the existing `urgent` tag). Working tasks without a category default to Other.
- Existing schedule/calendar entries, routines and notes are not task-board records and are not imported.
- Listeners run only while All Tasks is open and authenticated; leaving the view or signing out clears them and the loaded task data.

## Dates and filters

Search matches task titles, categories, projects and labels. Category, priority, due-date and status filters combine, and summaries/agendas follow those filters.

Dates use the browser's local calendar day; This Week ends on Sunday. Upcoming groups are non-overlapping: Today, Tomorrow, and remaining days of This Week. Today's Focus shows High/Urgent tasks due today or overdue. Done and Close both count as Completed and are excluded from overdue and upcoming lists.

## Deployment and permissions

Keep the JavaScript and CSS alongside the existing HTML. All Tasks supports opening the HTML directly by double-click (`file:///`), as well as HTTP/HTTPS. No local server, new framework, or browser security override is required. Existing online Firebase/CDN dependencies still require an internet connection; local-file support does not mean offline database support.

All Tasks is loaded on demand using a classic script, exposing a single `window.AllTasks` namespace. Local ES module imports were incompatible with direct file opening. Script loading and initialization failures display an error and retry button inside All Tasks without blocking existing navigation and theme controls. Leaving the view or signing out during loading prevents a late subscription from starting. Asset URLs use a version query and failed-load retries use fresh URLs; no service-worker cache is cleared automatically.

If the site becomes white and buttons stop responding after an older All Tasks deployment, deploy the updated HTML together with both All Tasks assets, then hard-refresh. The older static import could prevent the entire main script (including theme initialization) from running when the new module was unavailable. Browser-console errors are still needed to diagnose unrelated Firebase/CDN/network failures.

The new collection follows the application's existing shared `hubs` storage pattern, not a per-user private namespace. Deployed Firestore rules must authorize the intended users to read/write `hubs/workspace/tasks` and update the additional metadata fields on existing task collections. No rules file is present in this repository, so production permissions have **not** been verified or changed. Permission failures remain visible and retryable; there is no silent local-storage fallback.

## Validation

Requires modern Node.js and installed Chrome or Edge. Set `CHROME_PATH` if the executable is outside the standard Windows install locations. No new npm dependencies are required.

```powershell
node "d:\Pribadi & Freelance\Website\Web management Proyek\smoke-test-all-tasks.cjs"
node "d:\Pribadi & Freelance\Website\Web management Proyek\smoke-test-tiktok.cjs"
```

The All Tasks test loads the actual classic script, reuses the actual navigation code and card-theme helper, and runs desktop/mobile DOM checks over both direct file URLs and a temporary HTTP test server. The server is used only by the automated tests, not required to use the application. No file-access bypass flags are used. Firestore and authentication are mocked. It covers aggregation, IDs, filters, dates, summaries, dialogs, escaping, writes, drag/drop, failure recovery, navigation, theme changes, and listener cleanup. It does not establish that production Firebase rules allow the new collection, nor replace a full signed-in production visual check.

Separate failure-isolation fixtures load a missing script or a script whose factory throws during initialization, over both file and HTTP URLs. They exercise the actual integration and theme-control code, verify that error details and retry URLs work, and check that theme toggling and existing navigation still work without uncaught rejections. These are targeted fixtures, not a full production-page startup test.