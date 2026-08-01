"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";

import { Button } from "@/components/ui";
import {
  downloadUploadedRamsPdf,
  fetchUploadedRamsPdfBlob,
  getRams,
  reportRamsReadingPage,
  startRamsReadingProgress,
  type RamsAssessmentDetail,
  type RamsReadingProgress,
} from "@/features/rams/api";

GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

const VISIBLE_RATIO = 0.65;
const DWELL_MS = 800;
const RENDER_WINDOW = 2;

type Props = { assessmentId: string };

function PageSlot({
  pageNumber,
  totalPages,
  pdf,
  scale,
  shouldRender,
  onPresented,
}: {
  pageNumber: number;
  totalPages: number;
  pdf: PDFDocumentProxy;
  scale: number;
  shouldRender: boolean;
  onPresented: (page: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [height, setHeight] = useState(480);
  const [rendering, setRendering] = useState(false);
  const dwellTimer = useRef<number | null>(null);
  const presentedRef = useRef(false);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    presentedRef.current = false;
  }, [pageNumber, pdf]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.intersectionRatio >= VISIBLE_RATIO) {
          if (dwellTimer.current != null) window.clearTimeout(dwellTimer.current);
          dwellTimer.current = window.setTimeout(() => {
            if (!presentedRef.current) {
              presentedRef.current = true;
              onPresented(pageNumber);
            }
          }, DWELL_MS);
        } else if (dwellTimer.current != null) {
          window.clearTimeout(dwellTimer.current);
          dwellTimer.current = null;
        }
      },
      { threshold: [0, VISIBLE_RATIO, 1] },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (dwellTimer.current != null) window.clearTimeout(dwellTimer.current);
    };
  }, [onPresented, pageNumber]);

  useEffect(() => {
    if (!shouldRender) {
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
      }
      return;
    }

    let cancelled = false;
    setRendering(true);
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        setHeight(viewport.height);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
        const task = page.render({ canvasContext: context, viewport, transform });
        renderTaskRef.current = task;
        await task.promise;
      } catch {
        // Cancelled or transient render errors are ignored.
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [pageNumber, pdf, scale, shouldRender]);

  return (
    <div
      aria-label={`Page ${pageNumber} of ${totalPages}`}
      className="mx-auto mb-4 w-full max-w-full overflow-hidden rounded border border-[var(--color-border)] bg-white shadow-sm"
      data-page={pageNumber}
      id={`rams-page-${pageNumber}`}
      ref={containerRef}
      style={{ minHeight: height }}
    >
      {shouldRender ? (
        <canvas className="mx-auto block max-w-full" ref={canvasRef} />
      ) : (
        <div className="flex h-full min-h-[12rem] items-center justify-center text-sm text-[var(--color-text-soft)]">
          {rendering ? "Rendering…" : `Page ${pageNumber}`}
        </div>
      )}
    </div>
  );
}

export function RamsReaderClient({ assessmentId }: Props) {
  const [detail, setDetail] = useState<RamsAssessmentDetail | null>(null);
  const [progress, setProgress] = useState<RamsReadingProgress | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [fitWidth, setFitWidth] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progressWarning, setProgressWarning] = useState("");
  const [jumpValue, setJumpValue] = useState("1");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingPages = useRef<Set<number>>(new Set());
  const flushTimer = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const viewedLocal = useRef<Set<number>>(new Set());

  const cleanupPdf = useCallback(async () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (pdf) {
      try {
        await pdf.destroy();
      } catch {
        // ignore
      }
    }
  }, [pdf]);

  useEffect(() => {
    return () => {
      if (flushTimer.current != null) window.clearTimeout(flushTimer.current);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const row = await getRams(assessmentId);
        if (disposed) return;
        if (row.source_type !== "uploaded_pdf") {
          setError("This RAMS is not an uploaded PDF document.");
          setDetail(row);
          return;
        }
        setDetail(row);
        const blob = await fetchUploadedRamsPdfBlob(assessmentId);
        if (disposed) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        const doc = await getDocument({ url }).promise;
        if (disposed) {
          await doc.destroy();
          URL.revokeObjectURL(url);
          return;
        }
        setPdf(doc);
        const started = await startRamsReadingProgress(assessmentId);
        if (disposed) return;
        const serverPages = started.total_pages;
        if (!serverPages || serverPages < 1) {
          setError("Could not determine the authoritative page count for this RAMS PDF.");
          return;
        }
        if (doc.numPages !== serverPages) {
          setError(
            `PDF page count mismatch (viewer ${doc.numPages}, server ${serverPages}). Retry opening the RAMS.`,
          );
          return;
        }
        setTotalPages(serverPages);
        setProgress(started);
        viewedLocal.current = new Set(started.viewed_pages ?? []);
        setJumpValue("1");
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "Could not open RAMS PDF.");
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [assessmentId]);

  useEffect(() => {
    return () => {
      void cleanupPdf();
    };
  }, [cleanupPdf]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !totalPages) return;
    const measure = () => {
      const width = Math.max(280, el.clientWidth - 24);
      // Approximate A4 width at 72dpi = 595; fit-to-width scale.
      setFitWidth(Math.max(0.5, Math.min(2.5, width / 595)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [totalPages]);

  const effectiveScale = fitWidth * scale;

  const flushPages = useCallback(async () => {
    if (!totalPages || pendingPages.current.size === 0) return;
    const pages = Array.from(pendingPages.current).sort((a, b) => a - b);
    pendingPages.current.clear();
    try {
      let next: RamsReadingProgress | null = null;
      for (const page of pages) {
        next = await reportRamsReadingPage(assessmentId, page);
        // Respect server-side new-page interval (avoid burst rejection).
        await new Promise((r) => window.setTimeout(r, 160));
      }
      if (next) {
        setProgress(next);
        viewedLocal.current = new Set(next.viewed_pages ?? []);
      }
      setProgressWarning("");
    } catch (err) {
      pages.forEach((p) => pendingPages.current.add(p));
      setProgressWarning(err instanceof Error ? err.message : "Could not save reading progress.");
    }
  }, [assessmentId, totalPages]);

  const onPresented = useCallback(
    (page: number) => {
      if (viewedLocal.current.has(page)) return;
      viewedLocal.current.add(page);
      pendingPages.current.add(page);
      setProgress((prev) => {
        if (!prev) return prev;
        const viewed = Array.from(new Set([...(prev.viewed_pages ?? []), page])).sort((a, b) => a - b);
        const firstUnread =
          totalPages > 0
            ? Array.from({ length: totalPages }, (_, i) => i + 1).find((p) => !viewed.includes(p)) ?? null
            : null;
        const complete = totalPages > 0 && viewed.length >= totalPages && firstUnread == null;
        return {
          ...prev,
          viewed_pages: viewed,
          viewed_count: viewed.length,
          highest_page_reached: Math.max(prev.highest_page_reached, page),
          first_unread_page: firstUnread,
          status: complete ? "completed" : "in_progress",
        };
      });
      if (flushTimer.current != null) window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => {
        void flushPages();
      }, 400);
    },
    [flushPages, totalPages],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const nodes = el.querySelectorAll<HTMLElement>("[data-page]");
      let bestPage = currentPage;
      let bestRatio = 0;
      const rootRect = el.getBoundingClientRect();
      nodes.forEach((node) => {
        const page = Number(node.dataset.page);
        const rect = node.getBoundingClientRect();
        const visible = Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top);
        const ratio = visible / Math.max(rect.height, 1);
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestPage = page;
        }
      });
      if (bestPage && bestPage !== currentPage) {
        setCurrentPage(bestPage);
        setJumpValue(String(bestPage));
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [currentPage, totalPages]);

  function scrollToPage(page: number) {
    const target = document.getElementById(`rams-page-${page}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(page);
    setJumpValue(String(page));
  }

  const viewedCount = progress?.viewed_count ?? viewedLocal.current.size;
  const complete = progress?.status === "completed";
  const firstUnread = progress?.first_unread_page ?? null;
  const skippedWarning = Boolean(totalPages && currentPage === totalPages && firstUnread != null && !complete);

  return (
    <div className="fixed inset-0 z-[3200] flex flex-col bg-[var(--color-app-page)] text-[var(--color-text)]">
      <header className="flex shrink-0 flex-col gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">RAMS reader</p>
          <h1 className="truncate text-base font-bold">{detail?.title ?? "Loading…"}</h1>
          {totalPages > 0 ? (
            <p className="text-xs text-[var(--color-text-soft)]" aria-live="polite">
              Page {currentPage} of {totalPages} · {viewedCount} of {totalPages} pages viewed
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-[44px]"
            onClick={() =>
              void downloadUploadedRamsPdf(assessmentId, detail?.uploaded_pdf?.original_filename).catch((err) =>
                setError(err instanceof Error ? err.message : "Download failed."),
              )
            }
            size="sm"
            type="button"
            variant="secondary"
          >
            Download
          </Button>
          <Link
            className="inline-flex min-h-[44px] items-center justify-center rounded border border-[var(--color-border-dark)] px-3 text-sm font-semibold"
            href="/rams"
            onClick={() => {
              try {
                sessionStorage.setItem("timiq_rams_resume", assessmentId);
              } catch {
                // ignore
              }
            }}
          >
            Close / Back to RAMS
          </Link>
        </div>
      </header>

      {totalPages > 0 ? (
        <div className="shrink-0 px-3 py-2">
          <div
            aria-label="Reading progress"
            className="h-2 w-full overflow-hidden rounded bg-[var(--color-border)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={totalPages}
            aria-valuenow={viewedCount}
          >
            <div
              className="h-full bg-[var(--color-primary)] transition-all"
              style={{ width: `${Math.min(100, (viewedCount / totalPages) * 100)}%` }}
            />
          </div>
          {complete ? (
            <p className="mt-1 text-xs font-semibold text-emerald-800">All pages viewed</p>
          ) : skippedWarning ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-900">
              <span>Some pages have not been viewed yet.</span>
              {firstUnread != null ? (
                <Button
                  className="min-h-[44px]"
                  onClick={() => scrollToPage(firstUnread)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Go to first unread page
                </Button>
              ) : null}
            </div>
          ) : null}
          {progressWarning ? <p className="mt-1 text-xs text-amber-900">{progressWarning}</p> : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2" ref={scrollRef}>
        {loading ? <p className="text-sm text-[var(--color-text-soft)]">Loading PDF…</p> : null}
        {error ? (
          <div className="space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
            <p className="font-semibold">Could not load RAMS PDF</p>
            <p>{error}</p>
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-[44px]" onClick={() => window.location.reload()} size="sm" type="button">
                Retry
              </Button>
              <Button
                className="min-h-[44px]"
                onClick={() => void downloadUploadedRamsPdf(assessmentId, detail?.uploaded_pdf?.original_filename)}
                size="sm"
                type="button"
                variant="secondary"
              >
                Download PDF
              </Button>
            </div>
          </div>
        ) : null}
        {pdf && totalPages > 0
          ? Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNumber) => (
              <PageSlot
                key={pageNumber}
                onPresented={onPresented}
                pageNumber={pageNumber}
                pdf={pdf}
                scale={effectiveScale}
                shouldRender={Math.abs(pageNumber - currentPage) <= RENDER_WINDOW}
                totalPages={totalPages}
              />
            ))
          : null}
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button
            aria-label="Previous page"
            className="min-h-[44px] min-w-[44px]"
            disabled={currentPage <= 1}
            onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
            size="sm"
            type="button"
            variant="secondary"
          >
            Previous
          </Button>
          <Button
            aria-label="Next page"
            className="min-h-[44px] min-w-[44px]"
            disabled={currentPage >= totalPages}
            onClick={() => scrollToPage(Math.min(totalPages, currentPage + 1))}
            size="sm"
            type="button"
            variant="secondary"
          >
            Next
          </Button>
          <label className="flex items-center gap-1 text-xs">
            <span className="sr-only">Jump to page</span>
            <input
              aria-label="Jump to page"
              className="h-11 w-16 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              inputMode="numeric"
              onChange={(e) => setJumpValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const n = Number(jumpValue);
                  if (Number.isFinite(n) && n >= 1 && n <= totalPages) scrollToPage(n);
                }
              }}
              value={jumpValue}
            />
            <Button
              className="min-h-[44px]"
              onClick={() => {
                const n = Number(jumpValue);
                if (Number.isFinite(n) && n >= 1 && n <= totalPages) scrollToPage(n);
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              Go
            </Button>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            aria-label="Zoom out"
            className="min-h-[44px]"
            onClick={() => setScale((s) => Math.max(0.7, Number((s - 0.15).toFixed(2))))}
            size="sm"
            type="button"
            variant="secondary"
          >
            Zoom out
          </Button>
          <Button
            aria-label="Zoom in"
            className="min-h-[44px]"
            onClick={() => setScale((s) => Math.min(2.5, Number((s + 0.15).toFixed(2))))}
            size="sm"
            type="button"
            variant="secondary"
          >
            Zoom in
          </Button>
          {complete ? (
            <Link
              className="inline-flex min-h-[44px] items-center justify-center rounded border border-[var(--color-border-dark)] bg-[var(--color-primary)] px-3 text-sm font-semibold text-white"
              href="/rams"
              onClick={() => {
                try {
                  sessionStorage.setItem("timiq_rams_resume", assessmentId);
                } catch {
                  // ignore
                }
              }}
            >
              Return to acknowledgement
            </Link>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
