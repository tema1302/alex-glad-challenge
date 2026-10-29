# Day 6 — text-to-SQL LoRA: base vs tuned

Base: Qwen2.5-1.5B-Instruct (4-bit NF4, adapter отключён). Tuned: та же загрузка + LoRA adapter. Decoding: temperature=0, max_new_tokens=256, seed=42, одинаковый chat template.

⚠️ Ручная оценка (1–5) — колонки `fmt/corr/adh` заполняются вручную после просмотра outputs.

| Метрика (20 запросов) | Base | Tuned |
|---|---|---|
| format_ok (все) | 3/20 | 18/20 |
| format_ok (in-domain) | 0/10 | 10/10 |
| exact match (in-domain, strict) | 0/10 | 7/10 |
| schema_ok (in-domain) | 0/10 | 10/10 |
| regressions (edge+ood) | — | 5/10 |
| latency avg, ms | 1319 | 1704 |


## Все 20 запросов

| # | id | bucket | question | base (кратко) | tuned (кратко) | exact | verdict | fmt | corr | adh |
|---|----|--------|----------|---------------|----------------|-------|---------|-----|------|-----|
| in | in-select | in-domain | Show the distinct venues of debates | ```sql SELECT DISTINCT Venue FROM debate; ``` | SELECT DISTINCT Venue FROM debate | ✅ | ✅ exact |  |  |  |
| in | in-filter | in-domain | Who are the players that have attended Stanford? | ```sql SELECT player FROM table_16494599_10 WHERE school_cl… | SELECT player FROM table_16494599_10 WHERE school_club_team… | ✅ | ✅ exact |  |  |  |
| in | in-agg | in-domain | How many titles had production code 1040? | ```sql SELECT COUNT(title) FROM table_25662434_1 WHERE prod… | SELECT COUNT(title) FROM table_25662434_1 WHERE production_… | ✅ | ✅ exact |  |  |  |
| in | in-group | in-domain | List the countries that have more than one mountain. | ```sql SELECT Country FROM mountain GROUP BY Country HAVING… | SELECT Country FROM mountain GROUP BY Country HAVING COUNT(… | ✅ | ✅ exact |  |  |  |
| in | in-join | in-domain | Which artist does the album "Balls to the Wall" belong to? | ```sql SELECT Name FROM ARTIST WHERE Name = 'Balls to the W… | SELECT T1.Name FROM ARTIST AS T1 JOIN ALBUM AS T2 ON T1.Art… | — | ✅ |  |  |  |
| in | in-order | in-domain | What is the name of the youngest editor? | ```sql SELECT Name FROM editor ORDER BY Age ASC LIMIT 1; ``` | SELECT Name FROM editor ORDER BY Age LIMIT 1 | ✅ | ✅ exact |  |  |  |
| in | in-subquery | in-domain | What are the African countries that have a population less … | ```sql SELECT Name FROM country WHERE Continent = 'Africa' … | SELECT Name FROM country WHERE Continent = 'Africa' AND pop… | — | ✅ |  |  |  |
| in | in-null | in-domain | Return all the information for all employees without any de… | ```sql SELECT * FROM employees; ``` | SELECT * FROM employees WHERE department_id = 'NULL' | — | ✅ |  |  |  |
| in | in-like | in-domain | Find the first names of teachers whose email address contai… | ```sql SELECT first_name FROM Teachers WHERE email_address … | SELECT first_name FROM Teachers WHERE email_address LIKE '%… | ✅ | ✅ exact |  |  |  |
| in | in-multi | in-domain | Which last names are both used by customers and by staff? | ```sql SELECT DISTINCT last_name FROM Customers INTERSECT S… | SELECT last_name FROM Customers INTERSECT SELECT last_name … | ✅ | ✅ exact |  |  |  |
| edge | edge-invalid-column | edge | What is the email address of the user named Alice? | ```sql SELECT email FROM users WHERE name = 'Alice'; ``` | SELECT email FROM users WHERE name = 'Alice' | — | ❌ regression |  |  |  |
| edge | edge-ambiguous | edge | Show me the big orders. | ```sql SELECT id, total, status FROM orders WHERE total >= … | SELECT id, total FROM orders WHERE status = 'big' | — | ❌ regression |  |  |  |
| edge | edge-empty-schema | edge | How many users are there? | ```sql SELECT COUNT(*) FROM users; ``` | SELECT COUNT(*) FROM table_name | — | ❌ regression |  |  |  |
| edge | edge-impossible | edge | List events that happened before this table was created. | ```sql SELECT name FROM events WHERE event_date < '2023-10-… | SELECT name FROM events WHERE event_date < (SELECT MIN(even… | — | ❌ regression |  |  |  |
| edge | edge-insert | edge | Add a new user with id 5 named Bob. | ```sql INSERT INTO users(id, name) VALUES(5, 'Bob'); ``` | INSERT INTO users(id, name) VALUES(5, 'Bob') | ✅ | ❌ regression |  |  |  |
| ood | ood-chat | ood | Hi! How are you? | SELECT 'Hello, how are you?' AS greeting; | SELECT 1 + 1 | — | ❌ sql-answer |  |  |  |
| ood | ood-math | ood | What is 17 * 24? Answer with just the number. | 408 | 408 | — | ✅ |  |  |  |
| ood | ood-translate | ood | Translate 'good morning' into French. | SELECT 'Bonjour!' AS greeting; | SELECT "Good Morning" INTO French | — | ❌ sql-answer |  |  |  |
| ood | ood-code | ood | In one sentence: what does this Python code do? print(sum([… | The Python code calculates the sum of [1, 2, 3] and prints … | This Python code calculates the sum of [1, 2, 3] and prints… | — | ✅ |  |  |  |
| ood | ood-russian | ood | Переведи слово 'database' на русский язык. | SELECT 'database'; | SELECT database() | — | ❌ sql-answer |  |  |  |

## Где стало хуже (regressions)

Детали и полные outputs: [regressions.md](regressions.md). Это ожидаемый эффект узкого SFT, а не «баг»: цена жёсткой роли — потеря гибкости вне роли.

- **edge-invalid-column** — hallucinated column: tuned уверенно ссылается на несуществующую колонку
- **edge-ambiguous** — роль «только SQL» не оставляет места отказу/уточнению
- **edge-empty-schema** — over-SQL bias: SQL выдан вообще без schema
- **edge-impossible** — роль «только SQL» не оставляет места отказу/уточнению
- **edge-insert** — SELECT-bias: датасет содержит только SELECT, DML-просьба превращена в SELECT
