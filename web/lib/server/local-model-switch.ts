// Runtime-переключатель локальной LLM «тюненая/базовая» без рестарта (day-10).
// Активная модель — имя Ollama-модели. Дефолт = base из env (LOCAL_LLM_MODEL);
// тюненая = LOCAL_LLM_TUNED_MODEL. Пока tuned не задана или совпадает с base —
// переключатель недоступен (switchable:false), override игнорируется.
// Состояние живёт в памяти процесса: откат = рестарт, либо POST {"model":"base"}.
import 'server-only';

export interface LocalModelState {
  /** Базовая модель из env LOCAL_LLM_MODEL (null если не задана). */
  base: string | null;
  /** Тюненая модель из env LOCAL_LLM_TUNED_MODEL (null если не задана). */
  tuned: string | null;
  /** Фактически используемая сейчас модель. */
  active: string;
  /** Можно ли переключаться (tuned задана и отлична от base). */
  switchable: boolean;
}

let override: string | null = null;

function readModels(): { base: string | null; tuned: string | null } {
  const base = process.env.LOCAL_LLM_MODEL?.trim() || null;
  const tuned = process.env.LOCAL_LLM_TUNED_MODEL?.trim() || null;
  return { base, tuned: tuned && tuned !== base ? tuned : null };
}

export function getLocalModelState(): LocalModelState {
  const { base, tuned } = readModels();
  const switchable = Boolean(base && tuned);
  let active = base ?? tuned ?? '';
  if (override && switchable) {
    active = override === 'base' ? (base as string) : override;
  }
  return { base, tuned, active, switchable };
}

export function setLocalModelOverride(model: string): LocalModelState {
  const { base, tuned } = readModels();
  if (!base || !tuned) {
    throw new RangeError('переключатель недоступен: LOCAL_LLM_TUNED_MODEL не задана');
  }
  if (model !== 'base' && model !== base && model !== tuned) {
    throw new RangeError(
      `неизвестная модель: ожидается "base", "${base}" или "${tuned}"`,
    );
  }
  override = model === 'base' ? base : model;
  return getLocalModelState();
}
