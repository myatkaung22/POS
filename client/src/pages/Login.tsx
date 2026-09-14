import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { BrandMark } from "../components/BrandMark";
import { toast } from "../components/Toast";

const pins = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "OK"];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"pin" | "email">("pin");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("admin@gardentable.local");
  const [password, setPassword] = useState("admin123");
  const [busy, setBusy] = useState(false);

  async function submitPin(next = pin) {
    if (next.length < 4) return;
    setBusy(true);
    try {
      await login({ pin: next });
      navigate("/");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Login failed", "err");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  async function submitEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login({ email, password });
      navigate("/");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Login failed", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh bg-black lg:grid-cols-2">
      <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,#e1060022,transparent_40%)]" />
        <div className="relative">
          <img src="/logo.png" alt="4 Corner" className="h-16 w-auto object-contain" />
          <div className="mt-3 text-xs font-semibold tracking-[0.28em] text-white/40 uppercase">OmniMind POS</div>
        </div>
        <div className="relative">
          <div className="display text-5xl leading-tight text-white">4 Corner Bar & Restaurant</div>
          <p className="mt-4 max-w-md text-white/60">
            Tables, takeaway, delivery, kitchen slips, and guest QR — live across the floor.
          </p>
        </div>
        <div className="relative text-sm text-white/40">Demo PINs · Admin 1234 · Cashier 2222 · Kitchen 3333 · Waiter 4444 · Manager 5555</div>
      </div>
      <div className="flex items-center justify-center bg-ink-950 p-4 sm:p-6">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-ink-900 p-5 sm:p-8">
          <div className="mb-6 lg:hidden">
            <BrandMark size={48} stacked />
          </div>
          <div className="mb-6 flex gap-2">
            {(["pin", "email"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full px-4 py-1.5 text-sm capitalize ${mode === m ? "bg-gold-500 text-ink-950" : "bg-white/5"}`}
              >
                {m === "pin" ? "Staff PIN" : "Email"}
              </button>
            ))}
          </div>
          {mode === "pin" ? (
            <>
              <div className="display mb-4 text-center text-3xl tracking-[0.4em]">{pin.padEnd(4, "•").slice(0, 6)}</div>
              <div className="grid grid-cols-3 gap-2">
                {pins.map((key) => (
                  <button
                    key={key}
                    disabled={busy}
                    onClick={() => {
                      if (key === "C") setPin("");
                      else if (key === "OK") void submitPin();
                      else {
                        const next = (pin + key).slice(0, 6);
                        setPin(next);
                        if (next.length === 4) void submitPin(next);
                      }
                    }}
                    className="h-16 rounded-2xl bg-ink-800 text-lg hover:bg-ink-700"
                  >
                    {key}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form onSubmit={submitEmail} className="space-y-3">
              <input
                className="w-full rounded-2xl border border-white/10 bg-ink-800 px-4 py-3"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
              />
              <input
                type="password"
                className="w-full rounded-2xl border border-white/10 bg-ink-800 px-4 py-3"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
              />
              <button disabled={busy} className="w-full rounded-2xl bg-gold-500 py-3 font-medium text-ink-950">
                Sign in
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
