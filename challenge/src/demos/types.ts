// Тип демо-модуля. Каждый день челленджа — это реализация Demo.
// Реестр всех демо — в ./registry.ts.

export interface Demo {
  readonly id: string;        // 'day-01', 'day-02', ...
  readonly title: string;     // человекочитаемое название
  readonly run: () => Promise<void>;
}
