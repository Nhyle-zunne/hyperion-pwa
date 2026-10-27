# Updating Hyperion question banks

The question banks are stored in the private Supabase Storage bucket named `question-banks`. Do not put updated CSVs or encrypted question assets back in `public/questions` or commit them to this repository.

## Replacement workflow

1. Edit the source CSV and preserve its existing header, column order, and answer conventions. Keep a copy of the editable source file outside the repository.
2. From the repository root, set the local environment variables in PowerShell. Obtain the project URL and **service-role key** from the Supabase project settings. Never paste the service-role key into GitHub, source files, Cloudflare variables, or chat.

   ```powershell
   $env:SUPABASE_URL = "https://evnjoezffghtrzqacwcj.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY = "PASTE_YOUR_SERVICE_ROLE_KEY_LOCALLY"
   ```

3. Run the updater with the raw CSV path and the exact existing private object path. Example for OIC-NW competence C1:

   ```powershell
   node scripts/update-question-bank.mjs ".\updates\oic_nw_c1.csv" "deck/oic_nw_c1.csv.enc"
   ```

   The script checks that the target is one of the 69 supported files, encrypts the CSV in the format expected by the Edge Function, saves a rollback copy to the local `question-bank-backups/` folder, and replaces only that object in private storage. If the update fails before upload, the existing object stays in place.

4. Refresh Hyperion after the 15-second server cache expires. Check the changed competence's question count, several question texts, and answer options before changing other files.
5. If the new questions should also be available offline, download that track's full/free bank again on each device that needs the update. Existing offline packs are local copies and do not update automatically.

Clear the local secrets after the upload:

```powershell
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
Remove-Item Env:SUPABASE_URL
```

Keep `question-bank-backups/` private and out of version control. It contains prior encrypted objects for rollback.

## Existing private object paths

Use the exact path for the existing competence or part you are replacing:

| Track | Private object path pattern | Example |
| --- | --- | --- |
| Deck OIC-NW | `deck/oic_nw_cN.csv.enc` | `deck/oic_nw_c1.csv.enc` |
| Engine OIC-EW | `engine_ew/ew_cN.csv.enc` | `engine_ew/ew_c1.csv.enc` |
| Deck Management | `deck_mgt/dm_cN.csv.enc` | `deck_mgt/dm_c1.csv.enc` |
| Engine Management | `engine_mgt/em_cN.csv.enc` | `engine_mgt/em_c1.csv.enc` |
| GMDSS | `gmdss/c1_partN.csv.enc` or `gmdss/c2_partN.csv.enc` | `gmdss/c1_part1.csv.enc` |

This workflow replaces existing assets only. Adding a new competence or a new GMDSS part also requires updating the Edge Function's supported asset list and competence mapping.

## Important

- The upload uses private Storage; it does not put question files back in the public web directory.
- Online requests use the updated object after the short cache window.
- Previously downloaded offline banks must be downloaded again to include question changes.
- Keep the source CSV private too. The encrypted object is for storage, not a file to edit directly.
