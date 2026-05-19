"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowDown, CheckCircle2, ExternalLink } from "lucide-react";

import {
  ACTIVATE_CHECKLIST,
  ADMIN_GUIDE_SECTIONS,
  CIS_PAYROLL_POINTS,
  COMMON_PROBLEM_ROWS,
  EMPLOYEE_SETUP_MISTAKES,
  EMPLOYEE_SETUP_STEPS,
  PAYE_NOT_IMPLEMENTED,
  PAYE_PAYROLL_POINTS,
  QUICK_START_STEPS,
  RECALC_MATRIX_ROWS,
  ROLE_GUIDE_ROWS,
  TIME_CLOCKING_POINTS,
  UNSUPPORTED_ITEMS,
  type AdminGuideSectionId,
  type QuickStartStep,
} from "../../features/admin-guide/content";
import {
  AlertBanner,
  Badge,
  Card,
  CardBody,
  PageHeader,
  SectionCard,
  SheetBody,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
import { useI18n } from "../../lib/i18n";

const guideLinkButtonClass = cn(
  "inline-flex h-8 items-center justify-center rounded-[var(--radius-md)] border px-3 text-sm font-semibold",
  uiClasses.transitionColors,
  uiClasses.focusRing,
  "border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text)] hover:bg-[var(--color-btn-default-hover)]",
);

function sectionAnchor(id: AdminGuideSectionId): string {
  return `#${id}`;
}

function GuideLinkButton({
  children,
  className,
  href,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link className={cn(guideLinkButtonClass, className)} href={href}>
      {children}
    </Link>
  );
}

function QuickStartStepCard({ step, isLast }: { step: QuickStartStep; isLast: boolean }) {
  return (
    <StepCardWrapper isLast={isLast}>
      <Card className="h-full min-w-0 border-[var(--color-border-dark)]">
        <CardBody className="flex min-w-0 flex-col gap-2 p-3">
          <div className="flex min-w-0 items-start gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-dark)] bg-[var(--color-table-header)] text-xs font-bold">
              {step.step}
            </span>
            <h3 className="min-w-0 text-sm font-semibold leading-snug">{step.title}</h3>
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">{step.description}</p>
          {step.href ? (
            <GuideLinkButton className="mt-auto w-fit" href={step.href}>
              Open
            </GuideLinkButton>
          ) : null}
        </CardBody>
      </Card>
    </StepCardWrapper>
  );
}

function StepCardWrapper({ children, isLast }: { children: ReactNode; isLast: boolean }) {
  return (
    <div className="relative flex min-w-0 flex-col">
      {children}
      {!isLast ? <StepFlowArrow /> : null}
    </div>
  );
}

function StepFlowArrow() {
  return (
    <div className="flex justify-center py-2 lg:hidden" aria-hidden>
      <ArrowDown className="h-4 w-4 text-[var(--color-text-muted)]" />
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm text-[var(--color-text)]">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Checklist({ items }: { items: { label: string; detail: string }[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label} className="flex min-w-0 gap-2 text-sm">
          <CheckCircle2
            aria-hidden
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]"
          />
          <div className="min-w-0">
            <span className="font-medium">{item.label}</span>
            <span className="text-[var(--color-text-muted)]"> — {item.detail}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RolesTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Role</TableHead>
          <TableHead>Can do</TableHead>
          <TableHead>Should not see</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROLE_GUIDE_ROWS.map((row) => (
          <TableRow key={row.role}>
            <TableCell className="whitespace-nowrap font-medium">{row.role}</TableCell>
            <TableCell>{row.canDo}</TableCell>
            <TableCell>{row.shouldNotSee}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RecalcMatrixTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>State</TableHead>
          <TableHead>What you can do</TableHead>
          <TableHead>What is locked</TableHead>
          <TableHead>Warning</TableHead>
          <TableHead>How to fix</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {RECALC_MATRIX_ROWS.map((row) => (
          <TableRow key={row.state}>
            <TableCell className="whitespace-nowrap font-medium">{row.state}</TableCell>
            <TableCell>{row.actions}</TableCell>
            <TableCell>{row.locked}</TableCell>
            <TableCell>{row.warning}</TableCell>
            <TableCell>{row.fix}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ProblemsTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Symptom</TableHead>
          <TableHead>Likely cause</TableHead>
          <TableHead>Fix</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {COMMON_PROBLEM_ROWS.map((row) => (
          <TableRow key={row.symptom}>
            <TableCell className="font-medium">{row.symptom}</TableCell>
            <TableCell>{row.likelyCause}</TableCell>
            <TableCell>{row.fix}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function AdminGuideClient() {
  const { t } = useI18n();

  return (
    <SheetBody className="min-w-0 max-w-full space-y-6 pb-10">
      <PageHeader
        description="Visual operator manual for platform administrators. Operational guidance only — not tax or legal advice."
        title={t("nav.admin_guide", "Administrator guide")}
      />

      <AlertBanner tone="info">
        This page describes how TimIQ works today. It does not provide HMRC filing, statutory pay,
        pension auto-enrolment, or certified payroll compliance. For searchable help available to
        all roles, use the{" "}
        <Link className="font-medium underline" href="/help">
          Help centre
        </Link>
        .
      </AlertBanner>

      <nav
        aria-label="Guide sections (mobile)"
        className="min-w-0 xl:hidden"
      >
        <p className="timiq-caption mb-2 font-semibold uppercase tracking-wide">Jump to section</p>
        <ul className="flex min-w-0 flex-wrap gap-2">
          {ADMIN_GUIDE_SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                className="inline-block rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-2 py-1 text-xs font-medium hover:bg-[var(--color-header)]"
                href={sectionAnchor(section.id)}
              >
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-col gap-6 xl:flex-row xl:items-start">
        <nav
          aria-label="Guide sections"
          className="hidden shrink-0 xl:block xl:w-52 xl:sticky xl:top-4"
        >
          <p className="timiq-caption mb-2 font-semibold uppercase tracking-wide">On this page</p>
          <ul className="space-y-1 text-sm">
            {ADMIN_GUIDE_SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline"
                  href={sectionAnchor(section.id)}
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          <SectionCard
            className="scroll-mt-4"
            description={ADMIN_GUIDE_SECTIONS[0].summary}
            id="quick-start"
            title={ADMIN_GUIDE_SECTIONS[0].title}
          >
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge tone="info">12 steps</Badge>
              <span className="text-sm text-[var(--color-text-muted)]">
                Follow top to bottom for a new company
              </span>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {QUICK_START_STEPS.map((step, index) => (
                <QuickStartStepCard
                  key={step.step}
                  isLast={index === QUICK_START_STEPS.length - 1}
                  step={step}
                />
              ))}
            </div>
            <AlertBanner className="mt-4" tone="warning">
              CIS weekly payroll and PAYE monthly payroll are separate paths. Set payroll type on the
              employee profile before expecting someone on a report.
            </AlertBanner>
          </SectionCard>

          <SectionCard
            description={ADMIN_GUIDE_SECTIONS[1].summary}
            id="roles"
            title={ADMIN_GUIDE_SECTIONS[1].title}
          >
            <RolesTable />
          </SectionCard>

          <SectionCard
            description={ADMIN_GUIDE_SECTIONS[2].summary}
            id="employee-setup"
            title={ADMIN_GUIDE_SECTIONS[2].title}
          >
            <Checklist items={EMPLOYEE_SETUP_STEPS} />
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle aria-hidden className="h-4 w-4" />
                Common mistakes
              </div>
              <BulletList items={EMPLOYEE_SETUP_MISTAKES} />
            </div>
          </SectionCard>

          <SectionCard
            description={ADMIN_GUIDE_SECTIONS[3].summary}
            id="cis-payroll"
            title={ADMIN_GUIDE_SECTIONS[3].title}
          >
            <AlertBanner className="mb-4" tone="info">
              The Payroll Report includes <strong>CIS subcontractors only</strong>. PAYE employees
              are handled in{" "}
              <Link className="font-medium underline" href="/monthly-paye">
                Monthly PAYE
              </Link>
              .
            </AlertBanner>
            <Checklist items={CIS_PAYROLL_POINTS} />
            <div className="mt-4">
              <GuideLinkButton href="/payroll-report">
                Open Payroll Report
                <ExternalLink aria-hidden className="ml-1 inline h-3.5 w-3.5" />
              </GuideLinkButton>
            </div>
          </SectionCard>

          <SectionCard
            description={ADMIN_GUIDE_SECTIONS[4].summary}
            id="paye-payroll"
            title={ADMIN_GUIDE_SECTIONS[4].title}
          >
            <Checklist items={PAYE_PAYROLL_POINTS} />
            <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-dark)] p-3">
              <p className="mb-2 text-sm font-semibold">Not implemented in TimIQ</p>
              <BulletList items={PAYE_NOT_IMPLEMENTED} />
            </div>
            <div className="mt-4">
              <GuideLinkButton href="/monthly-paye">
                Open Monthly PAYE
                <ExternalLink aria-hidden className="ml-1 inline h-3.5 w-3.5" />
              </GuideLinkButton>
            </div>
          </SectionCard>

          <SectionCard
            description={ADMIN_GUIDE_SECTIONS[5].summary}
            id="time-clocking"
            title={ADMIN_GUIDE_SECTIONS[5].title}
          >
            <Checklist items={TIME_CLOCKING_POINTS} />
            <div className="mt-4 flex flex-wrap gap-2">
              <GuideLinkButton href="/clock">Clock page</GuideLinkButton>
              <GuideLinkButton href="/time-records">Time Records</GuideLinkButton>
            </div>
          </SectionCard>

          <SectionCard
            description={ADMIN_GUIDE_SECTIONS[6].summary}
            id="recalc-matrix"
            title={ADMIN_GUIDE_SECTIONS[6].title}
          >
            <p className="mb-3 text-sm text-[var(--color-text-muted)]">
              Approved or paid payroll is locked until you unlock or undo paid. Recalculate is
              required after any payroll-affecting change while the period is still editable.
            </p>
            <RecalcMatrixTable />
          </SectionCard>

          <SectionCard
            description={ADMIN_GUIDE_SECTIONS[7].summary}
            id="activate-checklist"
            title={ADMIN_GUIDE_SECTIONS[7].title}
          >
            <Checklist items={ACTIVATE_CHECKLIST} />
          </SectionCard>

          <SectionCard
            description={ADMIN_GUIDE_SECTIONS[8].summary}
            id="common-problems"
            title={ADMIN_GUIDE_SECTIONS[8].title}
          >
            <ProblemsTable />
          </SectionCard>

          <SectionCard
            description={ADMIN_GUIDE_SECTIONS[9].summary}
            id="unsupported"
            title={ADMIN_GUIDE_SECTIONS[9].title}
          >
            <AlertBanner tone="warning">
              Do not assume TimIQ submits returns to HMRC, issues P45/P60, runs statutory pay, or
              performs pension auto-enrolment assessment. There is no HMRC payroll software
              certification and no legal or tax guarantee.
            </AlertBanner>
            <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm">
              {UNSUPPORTED_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </SectionCard>

          <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
            <GuideLinkButton href="/help">Help centre (all roles)</GuideLinkButton>
            <GuideLinkButton href="/overview">Management overview</GuideLinkButton>
          </div>
        </div>
      </div>
    </SheetBody>
  );
}
