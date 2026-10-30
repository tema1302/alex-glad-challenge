# day-07 — tuned vs base (T4, один прогон)

- Base: `Qwen/Qwen2.5-1.5B-Instruct` + adapter `artifacts/adapter`; temperature=0, seed=42
- Дата: 2026-10-30T18:26:43.032765+00:00

| Режим | parse_ok | format_ok | full_match | text | recurring | dow | interval | latency, мс |
|---|---|---|---|---|---|---|---|---|
| tuned | 30/30 | 30/30 | 14/30 | 16/30 | 26/30 | 26/30 | 29/30 | 3374.5 |
| base-prompt | 27/30 | 30/30 | 10/30 | 12/30 | 17/30 | 24/30 | 25/30 | 1983.9 |
| base-none | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 7003.9 |

## По классам gold (full_match)

| Режим | класс | full_match |
|---|---|---|
| tuned | None | 4/11 |
| tuned | daily | 2/6 |
| tuned | hourly | 5/5 |
| tuned | weekly | 3/8 |
| base-prompt | None | 2/11 |
| base-prompt | daily | 1/6 |
| base-prompt | hourly | 4/5 |
| base-prompt | weekly | 3/8 |
| base-none | None | 0/11 |
| base-none | daily | 0/6 |
| base-none | hourly | 0/5 |
| base-none | weekly | 0/8 |
