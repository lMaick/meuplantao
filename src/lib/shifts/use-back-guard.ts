import { useEffect, useRef } from "react";

const GUARD_KEY = "__meuplantaoBackGuard";

type GuardState = Record<string, unknown> | null;

function hasGuard(state: GuardState): boolean {
  return Boolean(state && state[GUARD_KEY]);
}

/**
 * Enquanto `active`, mantém uma entrada sentinela no topo do histórico para que
 * o botão/gesto de voltar caia nela em vez de sair da página. Ao voltar,
 * chama `onBack` (para mostrar a confirmação) e recoloca a sentinela.
 * Ao desativar ou desmontar, remove a sentinela (history.back) somente se ela
 * ainda estiver no topo, sem desfazer uma navegação que já aconteceu.
 */
export function useBackGuard(active: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active) return;

    const push = () => {
      const current = (window.history.state ?? {}) as Record<string, unknown>;
      window.history.pushState({ ...current, [GUARD_KEY]: true }, "");
    };

    push();

    const onPopState = (event: PopStateEvent) => {
      // Chegou na própria sentinela (ex.: avanço): nada a fazer.
      if (hasGuard(event.state as GuardState)) return;
      // A sentinela foi consumida pelo "voltar": recoloca e pede a confirmação.
      push();
      onBackRef.current();
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      if (hasGuard(window.history.state as GuardState)) window.history.back();
    };
  }, [active]);
}
