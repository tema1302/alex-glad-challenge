# Day 6 — где tuned стал хуже base

Всего регрессий: 5 из 10 edge/OOD-запросов. Каждая — предсказуемое следствие обучения на датасете, состоящем на 100% из SELECT и одной роли «SQL engine».

## edge-invalid-column (edge)

- Вопрос: What is the email address of the user named Alice?
- Schema: `CREATE TABLE users (id INTEGER, name VARCHAR)`
- Причина: **hallucinated column: tuned уверенно ссылается на несуществующую колонку**

**Base output:**

```
```sql
SELECT email FROM users WHERE name = 'Alice';
```
```

**Tuned output:**

```
SELECT email FROM users WHERE name = 'Alice'
```

Метрики: base format_ok=False, tuned format_ok=True, tuned schema_ok=False, latency base/tuned = 1119/1262 ms

---

## edge-ambiguous (edge)

- Вопрос: Show me the big orders.
- Schema: `CREATE TABLE orders (id INTEGER, total INTEGER, status VARCHAR)`
- Причина: **роль «только SQL» не оставляет места отказу/уточнению**

**Base output:**

```
```sql
SELECT id, total, status FROM orders WHERE total >= 1000;
```
```

**Tuned output:**

```
SELECT id, total FROM orders WHERE status = 'big'
```

Метрики: base format_ok=False, tuned format_ok=True, tuned schema_ok=True, latency base/tuned = 1550/1461 ms

---

## edge-empty-schema (edge)

- Вопрос: How many users are there?
- Schema: `(none)`
- Причина: **over-SQL bias: SQL выдан вообще без schema**

**Base output:**

```
```sql
SELECT COUNT(*) FROM users;
```
```

**Tuned output:**

```
SELECT COUNT(*) FROM table_name
```

Метрики: base format_ok=False, tuned format_ok=True, tuned schema_ok=None, latency base/tuned = 818/803 ms

---

## edge-impossible (edge)

- Вопрос: List events that happened before this table was created.
- Schema: `CREATE TABLE events (name VARCHAR, event_date VARCHAR)`
- Причина: **роль «только SQL» не оставляет места отказу/уточнению**

**Base output:**

```
```sql
SELECT name FROM events WHERE event_date < '2023-10-05';
```
```

**Tuned output:**

```
SELECT name FROM events WHERE event_date < (SELECT MIN(event_date) FROM sqlite_master)
```

Метрики: base format_ok=False, tuned format_ok=True, tuned schema_ok=False, latency base/tuned = 1719/2122 ms

---

## edge-insert (edge)

- Вопрос: Add a new user with id 5 named Bob.
- Schema: `CREATE TABLE users (id INTEGER, name VARCHAR)`
- Причина: **SELECT-bias: датасет содержит только SELECT, DML-просьба превращена в SELECT**

**Base output:**

```
```sql
INSERT INTO users(id, name) VALUES(5, 'Bob');
```
```

**Tuned output:**

```
INSERT INTO users(id, name) VALUES(5, 'Bob')
```

Метрики: base format_ok=False, tuned format_ok=True, tuned schema_ok=True, latency base/tuned = 1375/1683 ms

---
