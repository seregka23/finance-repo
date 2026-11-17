# Frontend localization

The Angular client has one runtime build with English, Russian and Serbian Latin (`en`, `ru`, `sr`). The language selector is available before and after sign-in. `family-finance-language` in local storage remembers a choice when storage is available. Otherwise the browser language is used for Russian or Serbian, falling back to English. Changing language immediately updates visible messages and the document language and title.

`frontend/src/app/localization.ts` contains the catalogs and the injected localization service. Add a message to both typed catalogs, preserving named placeholders; use `t` with a parameter object for text that contains user data. Do not translate saved names, API values or URLs. API errors are mapped to safe display messages in `session-state.ts` and stored as message keys so a visible error can be translated again after a language change. Unknown errors use a generic message.

Money is formatted from minor-unit strings without floating-point conversion. Date-only movement dates are formatted without a time-zone day shift; invitation timestamps and the dashboard month use the household time zone. Amount entry accepts a dot in English, and a dot or comma in Russian and Serbian. Grouping and mixed separators are rejected.
