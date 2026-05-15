"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type NavDropdownPortalProps = {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
  menuId: string;
};

type MenuPosition = {
  top: number;
  left: number;
  minWidth: number;
  maxHeight: number;
};

function computeMenuPosition(anchor: HTMLElement): MenuPosition {
  const rect = anchor.getBoundingClientRect();
  const minWidth = 220;
  const viewportPad = 8;
  const maxHeight = Math.min(window.innerHeight * 0.7, 420);

  let left = rect.left;
  if (left + minWidth > window.innerWidth - viewportPad) {
    left = window.innerWidth - minWidth - viewportPad;
  }
  left = Math.max(viewportPad, left);

  let top = rect.bottom + 4;
  if (top + maxHeight > window.innerHeight - viewportPad) {
    top = Math.max(viewportPad, rect.top - maxHeight - 4);
  }

  return { top, left, minWidth, maxHeight };
}

export function NavDropdownPortal(props: NavDropdownPortalProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!props.open || !props.anchorRef.current) {
      setPosition(null);
      return;
    }

    const update = () => {
      if (props.anchorRef.current) {
        setPosition(computeMenuPosition(props.anchorRef.current));
      }
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [props.open, props.anchorRef]);

  if (!props.open || !mounted || !position) {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      className="timiq-nav-dropdown-panel rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] py-1 shadow-[0_10px_28px_rgba(15,23,42,0.16)]"
      id={props.menuId}
      role="menu"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        minWidth: position.minWidth,
        maxWidth: "min(20rem, calc(100vw - 1rem))",
        maxHeight: position.maxHeight,
        overflowY: "auto",
        zIndex: 60,
      }}
    >
      {props.children}
    </div>,
    document.body,
  );
}

export function navDropdownMenuContains(node: Node | null): boolean {
  if (!node) {
    return false;
  }
  return Boolean((node as Element).closest?.(".timiq-nav-dropdown-panel"));
}
