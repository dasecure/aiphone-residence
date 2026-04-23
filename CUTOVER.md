# Cutover Guide — Aiphone Residence Frontend to Platform API

This repo is currently running two parallel stacks:

| Stack | Entry points | Backend |
|---|---|---|
| **v1 (live)** | `book/bbq.html`, `book/gym.html`, `book/pool.html`, `book/tennis.html`, `book/ktv.html`, `book/visitor.html` | Supabase edge function `/functions/v1/aiphone-book` |
| **v2 (test)** | `book/bbq-new.html` | `https://api.dasecure.com/v1/passes` (publishable-key auth) |

v1 continues serving real residents; v2 validates the new dasecure Platform API end-to-end.

## When to cut over

**Blocker:** signing-service is not yet deployed to production, so `walletUrls.apple` and `walletUrls.google` are always `null`. Users lose "Add to Apple Wallet" / "Save to Google Wallet" until this is resolved.

**Cutover plan:**

1. Deploy signing-service to Fly (parked; all four Dockerfile bugs we hit for the API apply — use the same patterns documented in `services/api/Dockerfile`).
2. Extend the API's `POST /v1/passes` to call signing-service when the template's provider is `apple`/`google` and fill `walletUrls` from the response.
3. Validate on `bbq-new.html`: wallet buttons now light up.
4. Then cut over `bbq.html` → `gym.html` → rest.

## Per-page cutover recipe

Each page is ~6 lines of change. For each `book/<facility>.html`:

```diff
- <script src="../book.js"></script>
+ <script src="../book-new.js"></script>

  <script>
-   var FACILITY = 'bbq';      // used by old edge function
+   var TEMPLATE_ID = '6ec806c6-...';  // from dasecure_core.pass_templates
    // DEMO_VALUES, getPayload(), validate(), setSuccess() stay the same
  </script>
```

The `TEMPLATE_ID` values for each facility (test mode, Aiphone Main Tower):

| Facility | Template ID |
|---|---|
| BBQ Pit | `6ec806c6-7907-4a60-b712-9a0e2f547342` |
| Gym | `ef11a667-f500-433a-b554-9c009b74479a` |
| Swimming Pool | `4cd2fcfc-5511-4568-978a-a791c962f360` |
| Tennis Court | `3191b9fe-672c-4a84-babb-3444c17361ec` |
| KTV Room | `29119d11-52ff-4f3f-b9a1-02ea9c02c1e0` |
| Visitor Pass | `f56e5942-6037-4959-b46d-c178f382e47f` |

Query the DB at any time for the live set:

```sql
SELECT id, name, pass_type
FROM dasecure_core.pass_templates
WHERE project_id = '05187b39-2180-49ed-843b-09e7a4efb458'
  AND livemode = false
  AND archived = false
ORDER BY pass_type, name;
```

## Publishable key management

Keys live in `dasecure_core.publishable_keys`. Current test key(s):

```sql
SELECT prefix, name, scopes, last_used_at, use_count, revoked_at
FROM dasecure_core.publishable_keys_public
WHERE vertical_id = 'aiphone-residence';
```

### Rotating a key

```sql
-- 1. Revoke the old key
UPDATE dasecure_core.publishable_keys
SET revoked_at = now(), revoked_reason = 'rotation'
WHERE prefix = 'pk_test_XXXXXXXX';

-- 2. Generate a new one (use the Node one-liner below)
-- 3. Update the ?pk= value on every v2 page
```

### Generating a new key (Node one-liner)

```bash
node -e "
const crypto = require('crypto');
const secret = crypto.randomBytes(24).toString('hex');
const prefix = 'pk_test_' + secret.slice(0, 8);
const fullKey = prefix + secret.slice(8);
const hash = crypto.createHash('sha256').update(fullKey).digest('hex');
console.log('Key:  ' + fullKey);
console.log('Hash: ' + hash);
console.log('Prefix: ' + prefix);
"
```

Then INSERT:

```sql
INSERT INTO dasecure_core.publishable_keys
  (prefix, hash, name, livemode, vertical_id, org_id, project_id, scopes)
VALUES
  ('<prefix>', '<hash>',
   'Aiphone Residence — booking forms (test)',
   false,
   'aiphone-residence',
   '44248004-cde6-458d-ba8d-3ffe875c7fae',
   '05187b39-2180-49ed-843b-09e7a4efb458',
   ARRAY['passes.create']);
```

## Live-mode cutover (post signing-service)

Once signing-service is live and we're ready for real residents:

1. Mint a `pk_live_*` key (same SQL, set `livemode = true` and prefix starts with `pk_live_`).
2. Update each v2 page to hardcode the key (remove `?pk=` dependency, use the pattern in `book/bbq-v2.html`).
3. Flip each old `book/<facility>.html` to point at the v2 version.
4. Keep the old files around as `book/<facility>-legacy.html` for one release cycle, then delete.

## Scope reference

| Scope | Grants | Needed for |
|---|---|---|
| `passes.create` | `POST /v1/passes` | All booking forms |
| `passes.read` | `GET /v1/passes/:id` | Admin dashboards, resident self-service |
| `passes.revoke` | `POST /v1/passes/:id/revoke` | Admin panel only |
| `scans.create` | `POST /v1/scans` | Security gate scanners (future) |
| `*` | Everything | User JWTs only; never pk_ keys |

Publishable keys should have the narrowest scope needed. For booking forms: `['passes.create']` is sufficient.

## Troubleshooting

**403 "missing required scope: passes.create"**
The key was created without the scope. Update:

```sql
UPDATE dasecure_core.publishable_keys
SET scopes = ARRAY['passes.create']
WHERE prefix = 'pk_test_XXXXXXXX';
```

**401 "invalid or revoked publishable key"**
Either the key doesn't exist, or `revoked_at` is set. Check:

```sql
SELECT prefix, name, revoked_at, revoked_reason
FROM dasecure_core.publishable_keys
WHERE prefix = 'pk_test_XXXXXXXX';
```

**403 "template does not belong to authenticated project"**
The `TEMPLATE_ID` in the HTML is from a different project than the key's `project_id`. Check the template's project:

```sql
SELECT t.id, t.name, p.name AS project_name
FROM dasecure_core.pass_templates t
JOIN dasecure_core.projects p ON p.id = t.project_id
WHERE t.id = '<template-id>';
```

**CORS error in devtools**
The origin isn't in `services/api/src/app.ts` `allowedProdOrigins()`. Add it and redeploy.
