# Import review

The import routes below use the existing household session and mutation-origin checks. They are relative to `/api/v1/households/:householdId/imports`.

| Method and route | Behavior |
| --- | --- |
| `POST /preview` | Recognize and save a draft, or return the existing draft for the same source in the household. |
| `GET /` | List saved drafts for the household. |
| `GET /:draftId` | Read a draft and its current review details. |
| `POST /:draftId/confirm` | Post a new transaction or attach receipt items to an existing posted expense. |

Submit a bank message as `{"sourceType":"sms","text":"..."}`. Submit an image as `{"sourceType":"screenshot","mimeType":"image/png","base64":"..."}` or use `sourceType: "receipt"`. The same size and format limits apply as in the [recognition API](recognition.md). Repeated image bytes are treated as the same source even when selected under another image type. The application stores a hash of the source and the validated structured fields. It processes full SMS text and image bytes only during the request.

The list returns the 50 most recent draft summaries in `drafts`. Preview and detail return `id`, `status`, `sourceType`, `createdAt`, `draft`, `reviewFlags`, `categoryDecision`, `suggestedAccountId`, `possibleDuplicates`, and `transactionId`. The account suggestion requires an active account with a unique match on explicit bank, last four card digits, and currency. Set the optional `bankName` and `cardLastFour` together in the account form. Users can select or create an account in the absence of a unique match. Matches from other sources are advisory, so similar purchases can be posted as separate transactions.

To post a transaction, submit the normal posting body under `transaction`, along with any edited receipt lines and the settlement acknowledgement.

```json
{
  "mode": "post",
  "transaction": {"type": "expense", "transactionDate": "2026-11-01", "accountId": "…", "categoryId": "…", "amountMinor": "12345", "currency": "RSD"},
  "items": [{"name":"Bread","quantity":"1","unitPriceMinor":"250","amountMinor":"250"}],
  "settlementConfirmed": false
}
```

For a receipt that belongs to an existing expense, send `{"mode":"attach","transactionId":"…","items":[...]}`. Attaching adds the source link and receipt lines while the existing posting supplies the debit. Transfers use the transfer posting body with both selected accounts and amounts and any linked fee. Refunds use the refund posting body with the original purchase ID. A declined source cannot be confirmed. Pending or unknown settlement must be acknowledged explicitly for posting.

The server rechecks active access and financial eligibility during confirmation. The posting or attachment, draft link, lines and confirmation fingerprint commit in a single D1 batch. A successful confirmation returns `{"transactionId":"…"}`. Retrying the same confirmation returns the recorded result. A different confirmation for the same confirmed draft returns `409 IMPORT_CONFLICT`. The existing manual posting screen is available when recognition fails. [D1 batch behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
