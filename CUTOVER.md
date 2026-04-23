# Cutover Guide — Aiphone Residence Frontend to Platform API

This repo is currently running two parallel stacks:

| Stack | Entry points | Backend |
|---|---|---|
| **v1 (live)** | `book/bbq.html`, `book/gym.html`, `book/pool.html`, `book/tennis.html`, `book/ktv.html`, `book/visitor.html` | Supabase edge function `/functions/v1/aiphone-book` |
| **v2 (test)** | `book/bbq-new.html`, `book/gym-new.html`, `book/pool-new.html`, `book/tennis-new.html`, `book/ktv-new.html`, `book/visitor-new.html` | `https://api.dasecure.com/v1/passes` (publishable-key auth) |

v1 continues serving real residents; v2 validates the new dasecure Platform API end-to-end.

## Status (as of Phase F)

✅ **Phase E done** — `api.dasecure.com` now calls `dasecure-signing-service.fly.dev` for Apple templates and returns `walletUrls.apple` = 1-hour signed `.pkpass` URL from Supabase Storage. See `core-platform/docs/sessions/PHASE_E_NOTES.md` for the full plumbing story.

✅ **Phase F done** — all 6 `-new.html` forms are on the new API. Each v2 form shows:

- Badge "NEW API" on the strip to distinguish from v1
- Banner at top of form confirming preview mode
- On success: `.pkpass` preview download button (labelled "Download .pkpass preview") until PKCS#7 wrapping lands
- Footer link back to the v1 version for A/B comparison

⏳ **PKCS#7 wrapping pending** — the `.pkpass` file downloads cleanly but won't import into Apple Wallet until the raw RSA signature from KMS is wrapped in a PKCS#7 SignedData envelope with our Pass Type ID cert + WWDR intermediate. `walletMeta.apple.importable` returns `false` with `reason: 'pkcs7_wrapping_pending'` to surface this honestly.

⏳ **Apple Developer account enrolment** — prereq for a real Pass Type ID cert. 24–48h Apple approval once we enrol.

⏳ **Google Wallet** — parallel path, simpler (JWT claim signing, no PKCS#7). `/v1/sign/google` on signing-service already exists and returns signed JWTs. API integration is a next-session task.

## When to flip v1 → v2 in production

Three blockers remain before flipping each `book/<facility>.html` to point at its `-new.html` equivalent for real residents:

1. **PKCS#7 wrapping** — so wallet buttons actually add the pass to Apple Wallet.
2. **Google Wallet path wired in the API** — for Android parity.
3. **Real `team_id` / `pass_type_id` / `cert_fingerprint`** in `dasecure_core.wallet_credentials` (today these are `PENDING_*` placeholders in the seed row `c2086818` for Main Tower — fine today, must be real before flipping).

Once those are in:

- Mint a `pk_live_*` key (same SQL as below, but `livemode = true` and prefix starts with `pk_live_`).
- Flip each old `book/<facility>.html` to delegate to the `-new.html` version (or hardcode the key + remove `?pk=` dependency).
- Keep the old files around as `book/<facility>-legacy.html` for one release cycle, then delete.

## Per-page cutover recipe

Each `-new.html` already follows this pattern:

```diff
- <script src="../book.js"></script>
+ <script src="../book-new.js"></script>

  <script>
-   var FACILITY = 'bbq';      // old edge function
+   var TEMPLATE_ID = '6ec806c6-...';  // from dasecure_core.pass_templates
    // DEMO_VALUES, getPayload(), validate(), setSuccess() stay the same
  </script>
```

### Template IDs (test mode, Main Tower project)

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

### Per-page hooks in `book-new.js`

Most pages just need `TEMPLATE_ID`, `getPayload()`, `validate()`, `setSuccess()`. Optional per-page overrides:

- **`getPassType()`** — override the default `'facility_booking'`. Visitor pages return `'visitor'`.
- **`getHolderName()`** — override `holder_name` from payload. Visitor pages return the visitor's name (not the host's) so the pass is correctly attributed to the guest.

### Wallet button rendering (post-Phase-E)

`book-new.js` `showSuccess()` reads `data.walletMeta.apple.importable`:

| URL | `importable` | Button shows |
|---|---|---|
| present | `true` | "Add to Apple Wallet" (normal) |
| present | `false` | "Download .pkpass preview" with title= explaining PKCS#7 gap |
| absent | — | "Apple Wallet (coming soon)" greyed out |

Google Wallet: live once API integration lands, greyed until then.

## Smoke test (post Phase E + Phase F)

Pick any `-new.html` page, append `?pk=pk_test_...&demo`, and submit. Expected:

- Success view with QR + pass code
- "Download .pkpass preview" button populated with a signed Supabase URL
- Fly log line: `{"event":"wallet_artifact_signed","passCode":"PASS-...","kmsKeyRef":"alias/dasecure-aiphone-main-tower-apple","pkcs7Wrapped":false}`
- `walletUrls.landing` working on the "View pass landing page →" link

Download the `.pkpass`, verify with `unzip -l`:

```
pass.json
manifest.json
signature
icon.png
icon@2x.png
strip.png
```

AirDrop to iPhone → Apple Wallet should refuse import with a cert/signature error. This is expected until PKCS#7 wrapping is added.

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

**`walletUrls.apple` is null despite Apple template**
Check Fly logs for a structured `wallet_*` event on the `api` service. Most likely causes:

- `wallet_credential_missing` — no `wallet_credentials` row for `(project, provider=apple, scope=project, status=active)`. Seed one pointing at the project's KMS alias.
- `wallet_signing_failed` with `code: 'access_denied'` — signing-service's IAM role doesn't have `kms:Sign` on the key.
- `wallet_signing_failed` with `code: 'key_not_found'` — alias doesn't exist in `ap-southeast-1` or `kmsKeyRef` is wrong in the credential row.
- `wallet_artifact_upload_failed` — `pass-artifacts` bucket missing or service-role key can't write to it.

**CORS error in devtools**
The origin isn't in `services/api/src/app.ts` `allowedProdOrigins()`. Add it and redeploy.
