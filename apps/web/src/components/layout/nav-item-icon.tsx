import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Building,
  Building2,
  Calculator,
  Calendar,
  CalendarRange,
  Camera,
  ClipboardCheck,
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
  "nav.site_progress": Building2,
  "nav.starter_form": FileText,
  "nav.profile": User,
  "nav.settings": Settings,
  "nav.privacy": Shield,
  "nav.overview": LineChart,
  "nav.employees": Users,
  "nav.privacy_requests": Inbox,
  "nav.onboarding_review": ClipboardCheck,
  "nav.clock_selfies": Camera,
  "nav.companies": Building,
  "nav.workplaces": Factory,
  "nav.locations": MapPin,
  "nav.site_access": KeyRound,
  "nav.live_attendance": Activity,
  "nav.payroll_report": FileSpreadsheet,
  "nav.site_payroll_rules": SlidersHorizontal,
  "nav.budget_calculator": Calculator,
  "nav.accounting_exports": Download,
  "nav.work_progress_review": HardHat,
  "nav.audit_log": ScrollText,
  "nav.system_health": HeartPulse,
};

type NavItemIconProps = {
  labelKey: string;
  className?: string;
  "aria-hidden"?: boolean;
};

/** Small Lucide icon mapped from navigation `labelKey`; defaults to layout grid. */
export function NavItemIcon({
  labelKey,
  className = "h-4 w-4 shrink-0",
  "aria-hidden": ariaHidden = true,
}: NavItemIconProps) {
  const Icon = NAV_ICON_BY_LABEL_KEY[labelKey] ?? LayoutDashboard;
  return <Icon aria-hidden={ariaHidden} className={className} />;
}
