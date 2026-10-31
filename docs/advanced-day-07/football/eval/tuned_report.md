# Tuned vs base-prompt (day-07 football, один рантайм)

Модель: Qwen/Qwen2.5-0.5B-Instruct + LoRA-адаптер `artifacts/adapter-epoch3`, CPU fp32, temperature=0, seed=42.

| Режим | parse_ok | format_ok | full_match | home | away | home_score | away_score | scorers | competition | venue | latency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| tuned | 30/30 | 30/30 | 11/30 | 30 | 28 | 29 | 29 | 19 | 28 | 24 | 18839 ms |
| base-prompt | 0/30 | 0/30 | 0/30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 23278 ms |
