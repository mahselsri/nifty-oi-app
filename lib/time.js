// IST helpers (Vercel runs in UTC, so never rely on local time).
export function istNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  const hour = Number(g('hour'));
  const minute = Number(g('minute'));
  const second = Number(g('second'));
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    minutes: hour * 60 + minute, // minutes since IST midnight
    seconds: second,
    weekday: g('weekday'),
    label: `${g('hour')}:${g('minute')}:${g('second')}`,
  };
}

export function isMarketOpen(now) {
  if (now.weekday === 'Sat' || now.weekday === 'Sun') return false;
  return now.minutes >= 9 * 60 + 15 && now.minutes <= 15 * 60 + 30;
}

// Kite access tokens expire around 06:00 IST every day.
export function secondsUntilNext6amIST(now = istNow()) {
  const target = 6 * 60;
  const minsLeft = now.minutes < target ? target - now.minutes : 1440 - now.minutes + target;
  return Math.max(60, minsLeft * 60 - now.seconds);
}
