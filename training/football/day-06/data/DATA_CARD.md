# Dataset Card: Global Football Knowledge Assistant

## Summary

This is a synthetic instruction-tuning dataset for a football knowledge assistant. It contains 9600 ChatML-style examples generated from 302 source-backed football facts plus derived comparison prompts.

## Intended Use

- Fine-tune a small chat model with LoRA or QLoRA.
- Train the model to answer football definitions, competition questions, club/league questions, rules, tactics, analytics and date-sensitive safety questions.
- Demonstrate responsible behavior for live football topics such as scores, tables, lineups, transfers, injuries and betting odds.

## Data Format

Each training row is JSONL with:

- `example_id`
- `messages`: two turns, `user` then `assistant`
- `category`, `topic`, `subject`
- `source_url`
- `verified_date`
- `current_or_stable`
- `fact_id`

## Splits

- Train: 7680
- Validation: 960
- Test: 960
- Bonus held-out evaluation prompts: 240

## Coverage

The dataset covers FIFA, World Cup context, UEFA and other continental competitions, Premier League, LALIGA, Bundesliga, Serie A, Ligue 1, MLS, selected global leagues, IFAB Laws of the Game, tactical concepts, analytics terms, positions and current-information safety.

## Source Policy

The fact bank uses official or high-authority football sources where possible, including FIFA, IFAB, UEFA, Premier League, LALIGA, Bundesliga, Serie A, Ligue 1, MLS, AFC, CAF, CONMEBOL, CONCACAF and FIFA Training Centre pages. The source URL is retained in every generated example.

## Limitations

- This is a static dataset verified on 2026-04-23.
- It must not be used as a live source for scores, standings, injuries, lineups, transfers, rankings, odds or disciplinary updates.
- Some club and competition membership details can change by season, so the assistant is trained to recommend official verification for current questions.

## Quality Checks

The validator checks JSONL validity, required keys, user/assistant roles, dataset size, split totals, duplicate prompts, source diversity, category coverage and minimum assistant-answer length.

Run:

```bash
python3 scripts/validate_football_dataset.py
```
