import { createFileRoute } from "@tanstack/react-router";
import { GameApp } from "@/components/game/GameApp";
import { TableEnter, TableSplash } from "@/components/game/TableSplash";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <TableSplash text="Открываю стол…" />;
  if (!user) return <TableEnter />;
  return <GameApp />;
}
