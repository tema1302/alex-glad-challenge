// Suspense-fallback для роут-сегментов (server components читают БД — нужен индикатор).
export default function Loading() {
  return (
    <div className="flex items-center gap-2 text-neutral-500">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span>Загрузка…</span>
    </div>
  );
}
