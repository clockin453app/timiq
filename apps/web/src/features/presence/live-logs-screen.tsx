"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  Badge,
  Button,
  PageHeader,
  Sheet,
  SheetBody,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui";
import {
  listLiveLogs,
  type LiveLogSessionItem,
  type LiveLogsResponse,
  type LiveLogsStatusFilter,
  type PresenceStatus,
} from "./api";

const PAGE_SIZE = 50;

function statusLabel(status: PresenceStatus): string {
  if (status === "online") return "Online";
  if (status === "idle") return "Idle";
  if (status === "recent") return "Recently active";
  return "Offline";
}

function statusTone(status: PresenceStatus): "success" | "warning" | "default" {
  if (status === "online") return "success";
  if (status === "idle") return "warning";
  return "default";
}

function roleLabel(role: string): string {
  if (role === "administrator") return "Administrator";
  if (role === "admin") return "Company Admin";
  if (role === "employee") return "Employee";
  return role;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }
  return date.toLocaleString();
}

function userLabel(item: LiveLogSessionItem): string {
  return item.user_display?.trim() || item.user_email;
}

function SummaryCard(props: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">{props.label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--color-text)]">{props.value}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{props.hint}</p>
    </div>
  );
}

export function LiveLogsScreen() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LiveLogsStatusFilter>("recent");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<LiveLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const filterRef = useRef({ search, status });
  filterRef.current = { search, status };

  const load = useCallback(async (nextOffset: number) => {
    const filters = filterRef.current;
    setLoading(true);
    setError("");
    try {
      const response = await listLiveLogs({
        search: filters.search.trim() || undefined,
        status: filters.status,
        limit: PAGE_SIZE,
        offset: nextOffset,
      });
      setData(response);
      setOffset(nextOffset);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Could not load live logs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(0);
    const interval = window.setInterval(() => {
      void load(offset);
    }, 45_000);
    return () => window.clearInterval(interval);
  }, [load, offset]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(0);
  }

  const canPrevious = offset > 0;
  const canNext = data ? offset + data.items.length < data.total : false;

  return (
    <Sheet>
      <PageHeader
        title="Live logs"
        description="Live app usage for administrators."
        action={
          <Button disabled={loading} onClick={() => void load(offset)} size="sm" variant="secondary">
            Refresh
          </Button>
        }
      />
      <SheetBody className="space-y-4">
        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Online now"
            value={data?.summary.online_now ?? 0}
            hint="Heartbeat within 2 minutes"
          />
          <SummaryCard label="Idle" value={data?.summary.idle ?? 0} hint="Seen within 10 minutes" />
          <SummaryCard
            label="Recent sessions"
            value={data?.summary.recent_sessions ?? 0}
            hint="Seen within 30 minutes"
          />
          <SummaryCard
            label="Seen today"
            value={data?.summary.seen_today ?? 0}
            hint="Unique users with activity today"
          />
        </div>

        <form
          className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
          onSubmit={submit}
        >
          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Search</span>
            <input
              className="w-full rounded border border-[var(--color-border-dark)] bg-white px-2 py-1.5 text-sm"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, company, or page"
              value={search}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Status</span>
            <select
              className="w-full rounded border border-[var(--color-border-dark)] bg-white px-2 py-1.5 text-sm"
              onChange={(event) => setStatus(event.target.value as LiveLogsStatusFilter)}
              value={status}
            >
              <option value="recent">Online, idle, and recent</option>
              <option value="online">Online only</option>
              <option value="idle">Idle only</option>
              <option value="all">All sessions</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button className="w-full sm:w-auto" disabled={loading} size="sm" type="submit" variant="primary">
              Apply
            </Button>
          </div>
        </form>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3 text-xs text-[var(--color-text-muted)]">
          Presence heartbeat is enabled. Last refreshed from server at{" "}
          {data ? formatDateTime(data.server_time_utc) : "not loaded yet"}. The browser sends a safe route-only heartbeat
          about every {data?.heartbeat_interval_seconds ?? 60} seconds.
        </div>

        {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading live logs…</p> : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Current page</TableHead>
              <TableHead>Device / browser</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>First seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                </TableCell>
                <TableCell>
                  <div className="font-semibold">{userLabel(item)}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{item.user_email}</div>
                </TableCell>
                <TableCell>{roleLabel(item.role)}</TableCell>
                <TableCell>{item.company_name ?? "No company"}</TableCell>
                <TableCell className="font-mono text-xs">{item.current_path ?? "Not recorded"}</TableCell>
                <TableCell>
                  <div>{item.user_agent_summary ?? "Not recorded"}</div>
                  {item.ip_address_masked ? (
                    <div className="text-xs text-[var(--color-text-muted)]">IP {item.ip_address_masked}</div>
                  ) : null}
                </TableCell>
                <TableCell>{formatDateTime(item.last_seen_at)}</TableCell>
                <TableCell>{formatDateTime(item.first_seen_at)}</TableCell>
              </TableRow>
            ))}
            {!loading && data?.items.length === 0 ? (
              <TableRow>
                <TableCell className="text-center text-[var(--color-text-muted)]" colSpan={8}>
                  No live sessions match these filters.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--color-text-muted)]">
          <span>
            Showing {data?.items.length ?? 0} of {data?.total ?? 0}
          </span>
          <div className="flex gap-2">
            <Button disabled={!canPrevious || loading} onClick={() => void load(Math.max(0, offset - PAGE_SIZE))} size="sm" variant="secondary">
              Previous
            </Button>
            <Button disabled={!canNext || loading} onClick={() => void load(offset + PAGE_SIZE)} size="sm" variant="secondary">
              Next
            </Button>
          </div>
        </div>
      </SheetBody>
    </Sheet>
  );
}
