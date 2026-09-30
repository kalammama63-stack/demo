/* Связь с расписанием: Google-скрипт (CONFIG.api) или демо-режим в браузере. */
const API = (() => {
  const C = CONFIG;
  const KEY = "manikur-demo-db";

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || { bookings: [], closed: [] }; }
    catch (e) { return { bookings: [], closed: [] }; }
  };
  const save = d => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} };
  const isTaken = (d, date, time) =>
    d.closed.some(c => c.date === date && (!c.time || c.time === time)) ||
    d.bookings.some(b => b.status !== "cancelled" && b.date === date && b.time === time);
  const badPin = p => p.pin !== C.demoPin ? { ok: false, error: "pin" } : null;

  const demo = {
    availability() {
      const d = load();
      return { ok: true, busy: d.bookings.filter(b => b.status !== "cancelled").map(b => ({ date: b.date, time: b.time })), closed: d.closed };
    },
    book(p) {
      const d = load();
      if (isTaken(d, p.date, p.time)) return { ok: false, error: "taken" };
      const b = { id: Date.now().toString(36), created: new Date().toISOString(), date: p.date, time: p.time,
        service: p.service, name: p.name, phone: p.phone, shade: p.shade || "", status: "active" };
      d.bookings.push(b); save(d);
      return { ok: true, booking: b };
    },
    admin(p) {
      const d = load();
      return badPin(p) || { ok: true, bookings: d.bookings, closed: d.closed };
    },
    toggle(p) {
      if (badPin(p)) return badPin(p);
      const d = load(), t = p.time || "";
      const i = d.closed.findIndex(c => c.date === p.date && (c.time || "") === t);
      if (i >= 0) d.closed.splice(i, 1); else d.closed.push({ date: p.date, time: t });
      save(d);
      return { ok: true, closed: d.closed };
    },
    cancel(p) {
      if (badPin(p)) return badPin(p);
      const d = load(), b = d.bookings.find(x => x.id === p.id);
      if (!b) return { ok: false, error: "notfound" };
      b.status = "cancelled"; save(d);
      return { ok: true };
    }
  };

  async function call(action, params = {}) {
    if (!C.api) {
      await new Promise(r => setTimeout(r, 300));
      return demo[action](params);
    }
    const r = await fetch(C.api + "?" + new URLSearchParams({ action, ...params }));
    if (!r.ok) throw new Error("network");
    return r.json();
  }

  return { call, isDemo: !C.api };
})();

/* Даты: ключ дня — "2026-10-02" по местному времени. */
const Dates = {
  days: ["вс", "пн", "вт", "ср", "чт", "пт", "сб"],
  months: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); },
  parse(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); },
  human(s) { const d = this.parse(s); return this.days[d.getDay()] + ", " + d.getDate() + " " + this.months[d.getMonth()]; },
  // время уже прошло (или до него меньше часа) — сегодня записаться нельзя
  isPast(date, time) {
    const [h, m] = time.split(":").map(Number), d = this.parse(date);
    d.setHours(h, m, 0, 0);
    return d.getTime() - Date.now() < 60 * 60 * 1000;
  }
};
