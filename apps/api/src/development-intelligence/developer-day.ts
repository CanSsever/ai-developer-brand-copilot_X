export interface DeveloperDayWindow {
  readonly date: Date;
  readonly dateString: string;
  readonly end: Date;
  readonly start: Date;
}

function parts(value: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit", month: "2-digit", timeZone, year: "numeric",
    }).formatToParts(value).filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return { day: values.day!, month: values.month!, year: values.year! };
}

function midnightUtc(local: { day: number; month: number; year: number }, timeZone: string) {
  const target = Date.UTC(local.year, local.month - 1, local.day);
  let candidate = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit", hour: "2-digit", hourCycle: "h23", minute: "2-digit",
    month: "2-digit", second: "2-digit", timeZone, year: "numeric",
  });
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const value = Object.fromEntries(formatter.formatToParts(new Date(candidate))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]));
    candidate += target - Date.UTC(value.year!, value.month! - 1, value.day!, value.hour!, value.minute!, value.second!);
  }
  return new Date(candidate);
}

export function developerDayWindow(now: Date, timeZone: string): DeveloperDayWindow {
  const local = parts(now, timeZone);
  const next = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  const dateString = `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
  return {
    date: new Date(`${dateString}T00:00:00.000Z`), dateString,
    start: midnightUtc(local, timeZone),
    end: midnightUtc({ day: next.getUTCDate(), month: next.getUTCMonth() + 1, year: next.getUTCFullYear() }, timeZone),
  };
}
