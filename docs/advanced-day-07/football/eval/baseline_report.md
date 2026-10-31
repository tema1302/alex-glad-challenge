# Baseline без тюна (day-07 football, eval 30 кейсов)

Модель: Qwen/Qwen2.5-0.5B-Instruct, CPU fp32, temperature=0, seed=42.

| Режим | parse_ok | format_ok | full_match | home | away | home_score | away_score | scorers | competition | venue | latency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| none | 0/30 | 0/30 | 0/30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 20783 ms |
| prompt | 30/30 | 30/30 | 4/30 | 27 | 25 | 26 | 26 | 12 | 28 | 14 | 27341 ms |
