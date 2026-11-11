# Deploying the FIXIT AI Google Sheets Gateway

This turns your Google Spreadsheet (the "Data Storage" sheet you already
use) into the app's only database. **No Google Cloud Console is needed** — only
script.google.com, which you already use.

The file to deploy is **`Code.gs`** in this folder.

---

## Why it failed before

The old `Code.gs` called `ContentService.createText(...)`. That function does
not exist — the correct name is `ContentService.createTextOutput(...)`. That
one typo caused every `TypeError: ContentService.createText is not a function`
you saw, in every project you pasted it into. It also wiped worksheets with
`sheet.clear()` and never actually matched the server's protocol.

The rewritten `Code.gs`:

- uses `createTextOutput` everywhere (correct API),
- never clears or deletes existing rows — updates happen in place by Repair ID,
- speaks the exact `{ ok, result }` protocol the Node server expects
  (same as `scripts/fake-gateway.ts`, which the engine is tested against),
- creates monthly tabs automatically (`November 2026`, `… - Parts`,
  `… - Payments`, `… - Activity`) for every month that receives records,
- keeps masters (`Customers`, `Technicians`, `Users`, `Spare Parts`,
  `Suppliers`, `Settings`, …) shared across months,
- stores photos in Google Drive next to the spreadsheet
  (folder "FIXIT AI Images"), and backs up the whole spreadsheet on request,
- blocks duplicates under a script lock and replays `requestId`s, so a retried
  save can never write the same row twice,
- shows IST timestamps as `DD-MM-YYYY HH:mm:ss` (Asia/Kolkata).

## Steps

1. Open **https://script.google.com** (signed in to the Google account that
   owns the spreadsheet) and click **New project**.

2. In the editor, open `Code.gs`, select everything, delete it, and paste the
   **entire contents of `Code.gs` from this folder**.

3. Check the two constants at the top of the file:
   - `SPREADSHEET_ID` — already set to your spreadsheet.
   - `GATEWAY_SECRET` — already set, matching `SHEETS_GATEWAY_SECRET` in
     `.env`. (If you change one, change both. Keep the value out of any
     documentation — it is the write key to your spreadsheet.)

4. *(Optional but recommended)* In the function dropdown at the top of the
   editor, pick **`testGateway`** and press **Run**. Authorise the permissions
   when Google asks, then check the Execution log — you should see your
   spreadsheet name and its worksheets. This proves the code is valid before
   deploying.

5. Click **Deploy → New deployment**.
   - Click the gear icon ⚙ next to "Select type" and choose **Web app**.
   - Description: `FIXIT AI gateway`
   - **Execute as: Me** (your Google account)
   - **Who has access: Anyone**
   - Click **Deploy** and authorise the scopes
     (Spreadsheet + **Google Drive** — Drive is required for repair photos
     and spreadsheet backups).

> **Drive permission (required once).** Photos and backups need the
> `https://www.googleapis.com/auth/drive` scope. If you see
> *"You do not have permission to call DriveApp…"*, the deployment was
> made before that scope was granted. Fix it in two steps:
>
> 1. In the editor, pick `testGateway` in the function dropdown and press
>    **Run** → **Review permissions** → allow (the prompt now includes
>    Google Drive).
> 2. Create a **New deployment** (not just a new version — a plain version
>    update keeps the old permission set). Use the new Web app URL in `.env`.

6. Copy the **Web app URL** — it looks like
   `https://script.google.com/macros/s/AKfycb…/exec`.

7. Put them in `D:\fixit-ai-prototype\.env`:

   ```
   SHEETS_GATEWAY_URL=https://script.google.com/macros/s/AKfycb…/exec
   SHEETS_GATEWAY_SECRET=<the same value as GATEWAY_SECRET in Code.gs>
   ```

8. Restart the app: `npm run dev`. The API console must print:

   ```
   [api] Database: Google Sheets (Apps Script gateway)
   [api] Sheets schema ready: Data Storage spreadsheet · 2026-11
   ```

   and your spreadsheet will now contain all master worksheets plus
   `November 2026`, `November 2026 - Parts`, `November 2026 - Payments`,
   `November 2026 - Activity` with styled headers.

9. **Verify in a browser**: open your deployment URL plus
   `?secret=<your GATEWAY_SECRET>&action=ping` — you must see JSON containing
   `"ok": true` and your tab list.

10. **Run the acceptance test** (all 10 scenarios: month rollover, master
    reuse, update-not-duplicate, image round-trip, retry safety, …):

    ```
    npm run test:sheets
    ```

## Updating the script later

If `Code.gs` changes, use **Deploy → Manage deployments → edit (pencil) →
Version: New version → Deploy**. The URL stays the same, so `.env` needs no
change.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `TypeError: ContentService.createText is not a function` | You deployed the OLD script. Delete it and paste the new `Code.gs` (step 2). |
| Browser shows `{"ok":false,"error":"Unauthorized."}` | The `secret` query parameter does not match `GATEWAY_SECRET` in the file. |
| `SHEETS_UNREACHABLE` in the app | `.env` still has the old/dead URL, or the deployment was deleted. Redo step 5–7. |
| `SPREADSHEET_NOT_FOUND` | The deploying Google account cannot open the spreadsheet. Open the spreadsheet once in that account, or deploy from the owner account. |
| `You do not have permission to call DriveApp…` | The deployment lacks the Google Drive scope. Run `testGateway` in the editor (authorise), then create a NEW deployment — see the Drive permission note above. |
| `GATEWAY_BUSY` | Another write is in flight; the server retries automatically — no action needed. |
| Health page says database not configured | `SHEETS_GATEWAY_URL` or `SHEETS_GATEWAY_SECRET` is empty in `.env`. |
