import { createFileRoute } from "@tanstack/react-router";
import { EmailGate } from "@/components/game/EmailGate";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="relative min-h-dvh overflow-y-auto bg-table p-6">
      <img
        src="/game/start.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 size-full object-cover object-center"
      />
      <div className="pointer-events-none absolute inset-0 bg-table/50" />
      <div className="relative z-10 mx-auto w-full max-w-sm py-6">
        <EmailGate title="Войти за стол" />
      </div>
    </main>
  );
}
