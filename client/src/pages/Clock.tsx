import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { toast } from "../components/Toast";
import { businessDateIso, hourLabel } from "../hours";

type Shift = {
  id: string;
  userId: string;
  clockIn: string;
  clockOut?: string | null;
  note?: string;
  user?: { id: string; name: string; role: string };
};

function duration(clockIn: string, clockOut?: string | null) {
  const end = clockOut ? new Date(clockOut).getTime() : Date.now();
  const ms = Math.max(0, end - new Date(clockIn).getTime());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function ClockPage() {
  const { settings, can } = useAuth();
  const startHour = Number(settings.dayStartHour || 14);
  const endHour = Number(settings.dayEndHour || 2);
  const [date, setDate] = useState(() => businessDateIso(new Date(), startHour, endHour));
  const [open, setOpen] = useState<Shift | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [me, list] = await Promise.all([
      api<{ shift: Shift | null }>("/api/time/me"),
      api<{ shifts: Shift[] }>(`/api/time/shifts?date=${date}`),
    ]);
    setOpen(me.shift);
    setShifts(list.shifts);
  }

  useEffect(() => {
    void load().catch((err) => toast(err instanceof Error ? err.message : "Could not load timesheet", "err"));
  }, [date]);

  async function punch(kind: "in" | "out") {
    setBusy(true);
    try {
      await api(kind === "in" ? "/api/time/clock-in" : "/api/time/clock-out", { method: "POST", body: "{}" });
      toast(kind === "in" ? "Clocked in" : "Clocked out");
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Clock failed", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-[28px] border border-white/8 bg-ink-900 p-5">
        <div className="text-[11px] tracking-[0.16em] text-sage-400 uppercase">Staff time</div>
        <div className="display mt-1 text-3xl">{open ? "On shift" : "Off the clock"}</div>
        <p className="mt-1 text-sm text-cream-100/55">
          Sales day {hourLabel(startHour)} – {hourLabel(endHour)}
          {open ? ` · in since ${new Date(open.clockIn).toLocaleTimeString()}` : ""}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            disabled={busy || Boolean(open)}
            onClick={() => void punch("in")}
            className="flex-1 rounded-2xl bg-gold-500 py-3 font-medium text-ink-950 disabled:opacity-40"
          >
            <Timer size={16} className="mr-1 inline" /> Clock in
          </button>
          <button
            disabled={busy || !open}
            onClick={() => void punch("out")}
            className="flex-1 rounded-2xl bg-white/8 py-3 disabled:opacity-40"
          >
            Clock out
          </button>
        </div>
      </div>

      <div className="rounded-[28px] border border-white/8 bg-ink-900 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] tracking-[0.16em] text-sage-400 uppercase">Timesheet</div>
            <div className="text-sm text-cream-100/55">{can("timesheet") ? "All staff" : "Your punches"}</div>
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-2xl bg-ink-800 px-3 py-2 text-sm"
          />
        </div>
        <div className="mt-4 divide-y divide-white/5">
          {shifts.map((shift) => (
            <div key={shift.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div>
                <div className="font-medium">{shift.user?.name || "You"}</div>
                <div className="text-cream-100/45">
                  {new Date(shift.clockIn).toLocaleTimeString()} – {shift.clockOut ? new Date(shift.clockOut).toLocaleTimeString() : "still in"}
                </div>
              </div>
              <div className="tabular-nums text-gold-400">{duration(shift.clockIn, shift.clockOut)}</div>
            </div>
          ))}
          {!shifts.length && <div className="py-8 text-center text-sm text-cream-100/40">No punches on this sales day.</div>}
        </div>
      </div>
    </div>
  );
}
