# Direct private program submissions

Generate a Magni program JSON file using the schema at
`https://magni.tylergould.ing/api/program-imports/schema` and example at
`https://magni.tylergould.ing/api/program-imports/example`. These two resources are
public and contain no account information. See [program files](program-files.md)
for the human-readable contract.

In **Programs → Import JSON → Direct upload**, create an import credential.
Give it a recognizable name and expiration (1–90 days, default 30). The secret is
shown once. Only its SHA-256 hash is stored; credential lists contain metadata,
expiration, revocation and last-use dates. Revoke it from the same screen when no
longer needed. At most ten active credentials per user are allowed.

The credential permits only `POST /api/program-imports`, creating a private draft
in the owner's account. It cannot read drafts/history, start a program, edit an
active program, create credentials or publish catalog defaults. Do not put the
credential in a program JSON file, URL, committed script or prompt example.

## Request

```http
POST /api/program-imports
Authorization: Bearer <import credential>
Content-Type: application/json
```

```json
{
  "requestKey": "5b026c4b-6f22-41c9-b11e-99e572dc8431",
  "file": { "format": "magni.program", "schemaVersion": 1, "program": {} }
}
```

Replace `file` with the complete program object, not the incomplete skeleton
above. JSON text is also accepted as `file`. Use a fresh UUID for each intended
new draft. If a response is lost, retry **the same request key and same file**.
JSON formatting and key order do not change the payload identity. A changed
program needs a new key; reusing a key with changed content returns 409.

New imports return 201; successful retries return 200:

```json
{
  "draftId": "a generated UUID",
  "revision": 1,
  "reviewUrl": "/programs/editor/a-generated-uuid",
  "replayed": false
}
```

Resolve the relative review URL against the Magni host. The person signs in to
review, edit, choose the schedule and start. Uploading creates no run, calendar
workout, set log or active prescription. A retry returns the same draft and its
current revision; it never overwrites subsequent human edits. A deleted draft
returns 410 and is not resurrected. Start a fresh intentional import with a new
key if another copy is wanted.

Failures are `{ "error": "Actionable explanation", "code": "stable_code",
"issues": [{ "path": "weeks.0.days.0.exercises.0.sets.0.repMin", "message": "…" }] }`.
`issues` is present for program-field errors. Statuses: 400 malformed/unsupported
input, 401 missing/expired/revoked credential, 403 foreign-origin browser write,
409 conflicting retry key, 410 deleted draft, 413 excessive request bytes, 429
quota. Valid programs are limited to 2 MB; the enclosing request is limited to
2,050,000 bytes. Submit the file as an object to avoid escaped-string overhead.
New imports are limited to 100 per rolling 24 hours per user; retries remain
available at that quota. Production also limits attempts to 60 per minute per
client address. Responses containing account data use `Cache-Control: no-store`.

## Browser credential operations

These endpoints accept the signed-in browser session only, never the import
credential. Mutations retain same-origin protection.

- `GET /api/program-import-tokens` → `{tokens:[{id,name,createdAt,expiresAt,revokedAt,lastUsedAt}]}`.
- `POST /api/program-import-tokens` with `{name,expiresInDays?}` → 201 `{token:<metadata>,secret}`. Save the secret when shown; it cannot be fetched again.
- `DELETE /api/program-import-tokens/{id}` → 204. Only the owner may revoke it; repeated revocation is safe.

Timestamps are ISO strings; `revokedAt` and `lastUsedAt` may be null. Cookie-authenticated
`POST /api/program-imports` uses the same payload and result as direct submission.

## Persistence and rollback

Schema 7 adds `program_import_tokens` and `program_import_requests` beside the
existing owned drafts. It does not rewrite programs or workout history. Imports,
scoped IDs and request receipts commit in one transaction. Credentials are
rechecked inside that transaction, so revoking while an upload is being read
prevents the write. Standard database backups include credentials and receipts.

The previous application rejects a schema-7 database intentionally. Rolling back
to the prior image requires restoring its schema-6 backup; do not decrement
`user_version` on a live upgraded database. A rollback discards post-backup
imports and credentials just as it discards any other post-backup writes. The
release procedure rehearses upgrade and full backup restoration on disposable data.
