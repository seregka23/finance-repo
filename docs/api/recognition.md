# Transaction recognition

`POST /api/v1/households/:householdId/imports/extract` requires an active household member and uses the application's native session and mutation-origin checks. It returns an ephemeral draft for review. The request creates no saved draft or transaction and makes no ledger changes. Saved drafts, account and category suggestions, and posting are separate workflows.

Send one JSON object in one of these shapes.

```json
{"sourceType":"sms","text":"Synthetic notification text"}
```

```json
{"sourceType":"image","mimeType":"image/png","base64":"..."}
```

The route accepts up to 1,500 KiB of JSON. Text is limited to 12,000 UTF‑16 code units and 24,000 UTF‑8 bytes. Images accept canonical base64 and up to 1 MiB of decoded data. Supported media types are `image/jpeg`, `image/png`, and `image/webp`. The server checks that the bytes start with the declared format signature. The provider handles image decoding and readability.

A `200` response contains `draft`, `reviewRequired`, `eligibleForPosting`, and `reviewFlags`. Extracted amounts use exact minor-unit strings. The draft keeps `purchaseAmountMinor` and `purchaseCurrency` separate from `debitAmountMinor` and `debitCurrency`. It also includes date, type, recognition status, merchant or recipient, fee, optional four card digits, account hints, and legible receipt items. Each item has nullable `name`, `quantity`, `unitPriceMinor`, and line-total `amountMinor`. Unknown values are `null`. Supported currencies are RSD, EUR, RUB, and USD.

Every result sets `reviewRequired: true` and `eligibleForPosting: false` and includes `REVIEW_REQUIRED`. Additional flags communicate the reason review is needed.

| Flag | Meaning |
| --- | --- |
| `DECLINED` | Exclude the declined operation from posting. |
| `PENDING_SETTLEMENT` | Confirm settlement before considering posting. |
| `STATUS_UNKNOWN` | Verify the operation status. |
| `MISSING_ESSENTIALS` | Verify missing type, date, amount, or currency. |
| `TRANSFER_DETAILS_REQUIRED` | Verify both sides of the transfer, including the accounts and amounts. |
| `REFUND_LINK_REQUIRED` | Link the refund to the original purchase. |

Account hints are advisory and must be checked against the household's accounts before posting a transfer.

| Status | Meaning |
| --- | --- |
| `400` | Correct the input shape, text length, encoding, or image format. |
| `413` | Reduce the request body size. |
| `422 EXTRACTION_UNREADABLE` | Try clearer input or enter the operation manually. |
| `502 EXTRACTION_UNAVAILABLE` / `EXTRACTION_INVALID_RESPONSE` | Retry or use manual entry. The API returns a sanitized message. |
| `503 EXTRACTION_NOT_CONFIGURED` | The Worker has no server-side `OPENAI_API_KEY`. |

## Provider and privacy

The Worker uses the official `openai` SDK to call the Responses API with `gpt-4.1-mini`, image input and strict Structured Outputs. Requests use `store: false`, have a 30-second timeout, and carry the source text or image without household identity. The client makes one attempt per extraction and the application limits the response body to 64 KiB. The application does not persist the raw source or provider response. The endpoint emits only the validated structured result, with sensitive payment identifiers redacted from text fields. OpenAI's own data controls apply to data sent to the API. See the [model card](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [image guide](https://developers.openai.com/api/docs/guides/images-vision), [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs), and [data controls](https://developers.openai.com/api/docs/guides/your-data).

Set `OPENAI_API_KEY` as a server-side secret for the Worker deployment that needs recognition. `node scripts/verify-access.mjs` exercises the real local HTTP route with a stubbed provider, disposable D1 and synthetic data. A live provider smoke test requires a configured key and should use synthetic input.

## Category suggestions

The extraction response also includes `categoryDecision`. For example, a successful suggestion looks like this.

```json
{"categoryId":"<household-category-id>","provider":"openai","probability":0.91}
```

`categoryId: null` leaves the category for manual selection. When a provider was queried, `provider` identifies it. `probability` is the probability of the selected option when valid, including a low-confidence suggestion or `needs_review`. When the lookup is skipped, all three fields are `null`.

The service offers active categories for the current household and transaction type. The provider sees category names paired with temporary option labels and only the relevant validated merchant, recipient, and receipt item names. The server rechecks the chosen category before returning it. If no eligible options exist, or the category set exceeds the providers' 255-option limit including `needs_review`, the service skips the lookup. Transfers have no category. Refunds take the category from the original purchase during posting. Fee suggestions use expense categories. The manual posting API accepts the user's own eligible category.

| Worker setting | Purpose |
| --- | --- |
| `CATEGORY_DECISION_PROVIDER` | Select `openai` (default) or `gemini`. |
| `CATEGORY_DECISION_OPENAI_MIN_PROBABILITY` | OpenAI threshold from `0` to `1`, inclusive. Defaults to `0.8`. |
| `CATEGORY_DECISION_GEMINI_MIN_PROBABILITY` | Gemini threshold from `0` to `1`, inclusive. Defaults to `0.8`. |
| `OPENAI_API_KEY` | Server-side secret for extraction and OpenAI category decisions. |
| `GEMINI_API_KEY` | Server-side secret for Gemini category decisions. Extraction still uses OpenAI. |

Provider failures and missing or invalid category configuration leave the category open for manual selection. Both decision adapters have a 10-second timeout and a 64 KiB response limit. OpenAI uses the installed `openai` SDK and `POST /v1/decisions` with `gpt-6-luna`. Gemini uses `POST /v1beta/decisions` with `gemini-decision-1` and a Google AI Studio API key. Review the deployment project's model access and data controls before choosing its launch provider. [OpenAI Decisions reference](https://developers.openai.com/api/reference/resources/decisions/methods/create) · [Gemini Decisions reference](https://aistudio.google.com/api-reference/decisions/create-decision)

Run `node scripts/verify-access.mjs` and `node scripts/verify-access.mjs --gemini` for the same synthetic workflow against both adapters. These commands intercept outbound requests and exercise the deployed HTTP entry point with disposable local D1. A live provider spot-check requires the deployment owner's configured secrets.
