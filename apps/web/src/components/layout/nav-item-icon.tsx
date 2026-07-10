import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  Building,
  Building2,
  Calculator,
  Calendar,
  CalendarCheck,
  CalendarRange,
  Camera,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Download,
  Factory,
  FileSpreadsheet,
  FileText,
  HardHat,
  HeartPulse,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LineChart,
  List,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  ScrollText,
  Settings,
  Shield,
  SlidersHorizontal,
  User,
  Users,
  Wallet,
} from "lucide-react";

const NAV_ICON_BY_LABEL_KEY: Record<string, LucideIcon> = {
  "nav.dashboard": LayoutDashboard,
  "nav.messages": MessageSquare,
  "nav.clock": Clock,
  "nav.time_records": List,
  "nav.timesheets": Calendar,
  "nav.week_report": CalendarRange,
  "nav.pay_history": Wallet,
  "nav.cis_pay_history": Wallet,
  "nav.paye_pay_history": Wallet,
  "nav.site_progress": Building2,
  "nav.starter_form": FileText,
  "nav.profile": User,
  "nav.settings": Settings,
  "nav.help": BookOpen,
  "nav.privacy": Shield,
  "nav.overview": LineChart,
  "nav.employees": Users,
  "nav.privacy_requests": Inbox,
  "nav.onboarding_review": ClipboardCheck,
  "nav.clock_selfies": Camera,
  "nav.companies": Building,
  "nav.workplaces": Factory,
  "nav.cis_workplaces": Factory,
  "nav.locations": MapPin,
  "nav.site_access": KeyRound,
  "nav.live_attendance": Activity,
  "nav.payroll_report": FileSpreadsheet,
  "nav.cis_payroll_report": FileSpreadsheet,
  "nav.monthly_paye_report": Calculator,
  "nav.site_payroll_rules": SlidersHorizontal,
  "nav.budget_calculator": Calculator,
  "nav.accounting_exports": Download,
  "nav.work_progress_review": HardHat,
  "nav.toolbox_talks": ClipboardList,
  "nav.toolbox_talks_manage": ClipboardList,
  "nav.forms": ClipboardList,
  "nav.forms_manage": ClipboardList,
  "nav.forms_review": ClipboardCheck,
  "nav.leave": Calendar,
  "nav.leave_manage": CalendarRange,
  "nav.rams": Shield,
  "nav.rams_manage": HardHat,
  "nav.audit_log": ScrollText,
  "nav.live_logs": ScrollText,
  "nav.system_health": HeartPulse,
};

/** Desktop top-bar dropdown trigger icons keyed by navigation group id. */
const NAV_GROUP_ICON_BY_ID: Record<string, LucideIcon> = {
  "desk-dashboard": LayoutDashboard,
  "desk-overview": LineChart,
  "desk-clock": Clock,
  "desk-timesheets": Calendar,
  "desk-pay-history": Wallet,
  "desk-people": Users,
  "desk-sites": Building2,
  "desk-attendance": CalendarCheck,
  "desk-payroll": Wallet,
  "desk-work": HardHat,
  "desk-system": Settings,
  "desk-more": MoreHorizontal,
};

type NavItemIconProps = {
  labelKey: string;
  className?: string;
  "aria-hidden"?: boolean;
};

type NavGroupIconProps = {
  groupId: string;
  className?: string;
  "aria-hidden"?: boolean;
};

/** Small Lucide icon mapped from navigation `labelKey`; defaults to layout grid. */
export function NavItemIcon({
  labelKey,
  className = "h-[18px] w-[18px] shrink-0 text-current",
  "aria-hidden": ariaHidden = true,
}: NavItemIconProps) {
  const Icon = NAV_ICON_BY_LABEL_KEY[labelKey] ?? LayoutDashboard;
  return <Icon aria-hidden={ariaHidden} className={className} strokeWidth={2.25} />;
}

/** Lucide icon for desktop top-bar dropdown group triggers. */
export function NavGroupIcon({
  groupId,
  className = "h-[18px] w-[18px] shrink-0 text-current",
  "aria-hidden": ariaHidden = true,
}: NavGroupIconProps) {
  const Icon = NAV_GROUP_ICON_BY_ID[groupId] ?? LayoutDashboard;
  return <Icon aria-hidden={ariaHidden} className={className} strokeWidth={2.25} />;
}

export type { NavGroupIconProps, NavItemIconProps };
