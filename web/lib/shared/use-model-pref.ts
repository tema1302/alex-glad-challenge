// useModelPrefDefault — применить server-side preference модели (cookie model_pref,
// читается через GET /api/settings) как начальное значение llm-селектора формы.
// (день 28, follow-up P5: раньше modelPref хранился, но не потреблялся формами.)
//
// 'use client': хук для client-страниц (/rag, /chat, /rag/chat). Вызывается один раз
// на mount — не перезаписывает явный выбор пользователя после загрузки. best-effort:
// сбой fetch (сеть/401) молча игнорируется, форма остаётся со своим дефолтом.
// /api/settings НЕ отдаёт ключи — только имена/флаги + modelPref, утечки секрета нет.
'use client';

import { useEffect } from 'react';

export function useModelPrefDefault(setLlm: (v: 'local' | 'cloud') => void): void {
  useEffect(() => {
    let alive = true;
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { modelPref?: 'local' | 'cloud' | null } | null) => {
        if (!alive) return;
        const p = d?.modelPref;
        if (p === 'local' || p === 'cloud') setLlm(p);
      })
      .catch(() => {
        /* preference — best-effort, не рвём UI при сбое */
      });
    return () => {
      alive = false;
    };
  }, [setLlm]);
}
