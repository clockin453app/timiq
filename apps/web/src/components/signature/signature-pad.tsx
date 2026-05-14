"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../ui";
import { useT } from "../../lib/i18n";

type SignaturePadProps = {
  /** PNG data URL or null when empty */
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
};

/**
 * Canvas is only mounted after hydration so server HTML matches the first client paint
 * (avoids SSR/client canvas size or empty-pixel mismatches).
 */
export function SignaturePad({ value, onChange, disabled }: SignaturePadProps) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const resizeCanvas = useCallback(() => {
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const ratio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    el.width = Math.max(1, Math.floor(rect.width * ratio));
    el.height = Math.max(1, Math.floor(160 * ratio));
    const ctx = el.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, 160);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    resizeCanvas();
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mounted, resizeCanvas]);

  const pos = (ev: React.MouseEvent | React.TouchEvent) => {
    const el = canvasRef.current;
    if (!el) {
      return { x: 0, y: 0 };
    }
    const r = el.getBoundingClientRect();
    if ("touches" in ev && ev.touches[0]) {
      return { x: ev.touches[0].clientX - r.left, y: ev.touches[0].clientY - r.top };
    }
    const me = ev as React.MouseEvent;
    return { x: me.clientX - r.left, y: me.clientY - r.top };
  };

  const start = (ev: React.MouseEvent | React.TouchEvent) => {
    if (disabled) {
      return;
    }
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) {
      return;
    }
    const { x, y } = pos(ev);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (ev: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current || disabled) {
      return;
    }
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) {
      return;
    }
    const { x, y } = pos(ev);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) {
      return;
    }
    drawing.current = false;
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    try {
      onChange(el.toDataURL("image/png"));
    } catch {
      onChange(null);
    }
  };

  const clear = () => {
    resizeCanvas();
    onChange(null);
  };

  if (!mounted) {
    return (
      <div
        className="h-40 w-full rounded border border-dashed border-[var(--color-border)] bg-[var(--color-cell)]"
        aria-hidden
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[var(--color-text-soft)]">
        {t("signature.draw_label", "Draw signature")}
      </p>
      <canvas
        ref={canvasRef}
        className="h-40 w-full cursor-crosshair touch-none rounded border border-[var(--color-border)] bg-white"
        width={600}
        height={160}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={(e) => {
          e.preventDefault();
          start(e);
        }}
        onTouchMove={(e) => {
          e.preventDefault();
          move(e);
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          end();
        }}
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={clear}>
          {t("signature.clear", "Clear")}
        </Button>
      </div>
      {value ? (
        <p className="text-xs text-[var(--color-text-soft)]">{t("signature.captured", "Signature captured.")}</p>
      ) : (
        <p className="text-xs text-amber-800">{t("signature.required_hint", "Sign in the box above.")}</p>
      )}
    </div>
  );
}
