"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type PageLocationActionContextValue = {
  action: ReactNode;
  setPageLocationAction: (action: ReactNode) => () => void;
};

const PageLocationActionContext = createContext<PageLocationActionContextValue | null>(null);

export function PageLocationActionProvider({ children }: { children: ReactNode }) {
  const nextActionId = useRef(0);
  const [slot, setSlot] = useState<{ id: number; action: ReactNode } | null>(null);

  const setPageLocationAction = useCallback((action: ReactNode) => {
    const id = nextActionId.current + 1;
    nextActionId.current = id;
    setSlot({ id, action });

    return () => {
      setSlot((current) => (current?.id === id ? null : current));
    };
  }, []);

  const value = useMemo(
    () => ({
      action: slot?.action ?? null,
      setPageLocationAction,
    }),
    [setPageLocationAction, slot?.action],
  );

  return <PageLocationActionContext.Provider value={value}>{children}</PageLocationActionContext.Provider>;
}

export function usePageLocationAction() {
  const context = useContext(PageLocationActionContext);
  return context?.setPageLocationAction ?? (() => () => undefined);
}

export function usePageLocationActionContent() {
  return useContext(PageLocationActionContext)?.action ?? null;
}
