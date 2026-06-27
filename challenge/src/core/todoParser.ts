// Парсер аргументов для todo-команд (/todo, /remind).
// Флаги с числовым значением (--hourly 2, --weekly 1) корректно
// не попадают в текст задачи.

export interface ParsedTodoArgs {
  text: string;
  args: Record<string, unknown>;
}

export function parseTodoArgs(parts: string[]): ParsedTodoArgs {
  const args: Record<string, unknown> = {};
  const textParts: string[] = [];
  const skip = new Set<number>();

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];

    if (p === '--daily') {
      args.recurring = 'daily';
      skip.add(i);
    } else if (p === '--weekly' && parts[i + 1] && !parts[i + 1].startsWith('--')) {
      args.recurring = 'weekly';
      args.day_of_week = Number(parts[i + 1]);
      skip.add(i);
      skip.add(i + 1);
    } else if (p === '--hourly') {
      args.recurring = 'hourly';
      if (parts[i + 1] && !parts[i + 1].startsWith('--')) {
        args.interval_hours = Number(parts[i + 1]);
        skip.add(i + 1);
      } else {
        args.interval_hours = 1;
      }
      skip.add(i);
    } else if (p === '--server') {
      if (parts[i + 1]) skip.add(i + 1);
      skip.add(i);
    }
  }

  for (let i = 0; i < parts.length; i++) {
    if (!skip.has(i)) textParts.push(parts[i]);
  }

  const text = textParts.join(' ');
  args.text = text;
  return { text, args };
}
