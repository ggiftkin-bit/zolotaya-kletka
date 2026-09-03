import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";

export function TableSplash({ text = "Открываю стол…" }: { text?: string }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-table p-6">
      <img
        src="/game/start.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 size-full object-cover object-center"
      />
      <div className="pointer-events-none absolute inset-0 bg-table/45" />
      <div className="relative z-10 max-w-sm text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-panel/80">Золотая Клетка</p>
        <h1 className="mt-2 font-display text-4xl leading-none text-panel">Стол</h1>
        <p className="mt-4 text-sm text-panel/80">{text}</p>
      </div>
    </div>
  );
}

export function TableEnter() {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-table p-6">
      <img
        src="/game/start.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 size-full object-cover object-center"
      />
      <div className="pointer-events-none absolute inset-0 bg-table/50" />
      <div className="relative z-10 w-full max-w-sm space-y-4 rounded-[28px] border border-border bg-panel p-6 shadow-panel">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Золотая Клетка</p>
        <h1 className="font-display text-3xl leading-none text-foreground">Одна поляна</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Войди — фишка будет твоя. Клетка общая: срубил лес, пни останутся в книге.
        </p>
        {authEnabled ? (
          GROK_PROVIDERS.map((p) => (
            <button
              key={p.providerId}
              type="button"
              onClick={() => signIn(p.providerId, { callbackURL: "/" })}
              className="h-12 w-full cursor-pointer rounded-[12px] border border-border bg-raised px-4 text-base text-foreground hover:bg-panel"
            >
              Войти через {p.label}
            </button>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Вход выключен.</p>
        )}
      </div>
    </div>
  );
}
