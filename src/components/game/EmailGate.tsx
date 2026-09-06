import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { authClient, authEnabled } from "@/lib/auth/client";
import { GAME_VERSION } from "@/game/constants";

function ruAuthError(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes("already") || t.includes("exists")) return "Этот вход уже есть. Войди.";
  if (t.includes("invalid") || t.includes("password") || t.includes("credentials")) return "Почта или пароль не те.";
  if (t.includes("too short") || t.includes("least")) return "Пароль короче 8 знаков.";
  if (t.includes("email")) return "Почта странная.";
  return raw || "Не вышло.";
}

export function EmailGate({ title = "Одна поляна" }: { title?: string }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    if (!authEnabled) return;
    setErr(null);
    setBusy(true);
    try {
      if (mode === "up") {
        const { error } = await authClient.signUp.email({
          email: email.trim(),
          password,
          name: name.trim() || email.trim().split("@")[0] || "Испытатель",
        });
        if (error) throw new Error(error.message || "signup");
      } else {
        const { error } = await authClient.signIn.email({
          email: email.trim(),
          password,
        });
        if (error) throw new Error(error.message || "signin");
      }
      await authClient.getSession();
      await navigate({ to: "/" });
    } catch (e) {
      setErr(ruAuthError(e instanceof Error ? e.message : "ошибка"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative z-10 w-full max-w-sm space-y-4 rounded-[28px] border border-border bg-panel p-6 shadow-panel">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Золотая Клетка · {GAME_VERSION}
      </p>
      <h1 className="font-display text-3xl leading-none text-foreground">{title}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Почта и пароль. С телефона и с стола — одна фишка, одна земля, свой двор.
      </p>
      {!authEnabled ? (
        <p className="text-sm text-muted-foreground">Вход выключен.</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          {mode === "up" && (
            <>
              <label className="block text-xs font-medium text-muted-foreground" htmlFor="gate-name">
                Имя фишки
              </label>
              <input
                id="gate-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-12 w-full rounded-[12px] border border-border bg-raised px-3 text-base text-foreground outline-none ring-ring focus:ring-2"
                autoComplete="nickname"
              />
            </>
          )}
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="gate-email">
            Почта
          </label>
          <input
            id="gate-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 w-full rounded-[12px] border border-border bg-raised px-3 text-base text-foreground outline-none ring-ring focus:ring-2"
            autoComplete="email"
          />
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="gate-pass">
            Пароль
          </label>
          <input
            id="gate-pass"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 w-full rounded-[12px] border border-border bg-raised px-3 text-base text-foreground outline-none ring-ring focus:ring-2"
            autoComplete={mode === "up" ? "new-password" : "current-password"}
          />
          {err && <p className="text-sm text-danger">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="h-12 w-full cursor-pointer rounded-[12px] border border-border bg-accent px-4 text-base text-accent-foreground hover:opacity-95 disabled:opacity-60"
          >
            {busy ? "…" : mode === "up" ? "Завести стол" : "Войти"}
          </button>
          <button
            type="button"
            className="w-full text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setErr(null);
            }}
          >
            {mode === "in" ? "Нет входа — завести новый" : "Уже есть — войти"}
          </button>
        </form>
      )}
    </div>
  );
}
