import { createFileRoute } from "@tanstack/react-router";
import { EmailGate } from "@/components/game/EmailGate";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-table p-6">
      <img
        src="/game/start.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 size-full object-cover object-center"
      />
      <div className="pointer-events-none absolute inset-0 bg-table/50" />
      <EmailGate title="Войти за стол" />
    </main>
  );
}
