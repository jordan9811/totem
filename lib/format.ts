/** X-style count formatting: 1,234 → "1.2K"; 18400 → "18.4K"; below 1000 verbatim. */
export function formatCount(n: number): string {
  if (n === 0) return "";
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    const s = k >= 100 ? Math.round(k).toString() : (Math.round(k * 10) / 10).toString();
    return s.replace(/\.0$/, "") + "K";
  }
  const m = n / 1_000_000;
  return (Math.round(m * 10) / 10).toString().replace(/\.0$/, "") + "M";
}

/** Full comma formatting for profile stats: 4242 → "4,242" */
export function formatFull(n: number): string {
  return n.toLocaleString("en-US");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** X-style relative time: 45s, 12m, 6h, then "Aug 15", then "Aug 15, 2024". */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(1, Math.floor((now - ts) / 1000));
  if (diff < 60) return diff + "s";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return mins + "m";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h";
  const d = new Date(ts);
  const nowD = new Date(now);
  const label = MONTHS[d.getMonth()] + " " + d.getDate();
  if (d.getFullYear() !== nowD.getFullYear()) return label + ", " + d.getFullYear();
  return label;
}

/** Permalink timestamp: "2:41 PM · Aug 17, 2026" */
export function permalinkTime(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return h + ":" + m + " " + ampm + " · " + MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}
