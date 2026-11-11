# day-07 — tuned vs base (AMD Radeon RX 7600, ROCm, один прогон)

- Base: `Qwen/Qwen2.5-1.5B-Instruct` + adapter `artifacts-v9/adapter`; temperature=0, seed=42
- Дата: 2026-11-11T16:46:48.565242+00:00

| Режим | parse_ok | format_ok | full_match | text | recurring | dow | interval | latency, мс |
|---|---|---|---|---|---|---|---|---|
| tuned | 30/30 | 30/30 | 18/30 | 19/30 | 28/30 | 27/30 | 30/30 | 3151.9 |
| base-prompt | 27/30 | 30/30 | 10/30 | 12/30 | 17/30 | 24/30 | 25/30 | 1736.7 |
| base-none | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 0/30 | 5864.9 |

## По классам gold (full_match)

| Режим | класс | full_match |
|---|---|---|
| tuned | None | 7/11 |
| tuned | daily | 5/6 |
| tuned | hourly | 3/5 |
| tuned | weekly | 3/8 |
| base-prompt | None | 2/11 |
| base-prompt | daily | 1/6 |
| base-prompt | hourly | 4/5 |
| base-prompt | weekly | 3/8 |
| base-none | None | 0/11 |
| base-none | daily | 0/6 |
| base-none | hourly | 0/5 |
| base-none | weekly | 0/8 |
