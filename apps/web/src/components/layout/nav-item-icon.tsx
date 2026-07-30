import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Building,
  Calculator,
  Calendar,
  CalendarClock,
  CalendarRange,
  Camera,
  ChartNoAxesCombined,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Coins,
  Construction,
  CircleHelp,
  Factory,
  FileChartColumn,
  FileDown,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderKanban,
  FolderOpen,
  HardHat,
  HeartPulse,
  Image,
  KeyRound,
  LayoutDashboard,
  LineChart,
  ListChecks,
  LogIn,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Presentation,
  Radio,
  ScrollText,
  ServerCog,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  User,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import { cn } from "../../lib/cn";

const NAV_ICON_BY_LABEL_KEY: Record<string, LucideIcon> = {
  "nav.dashboard": LayoutDashboard,
  "nav.messages": MessageSquare,
  "nav.clock": LogIn,
  "nav.time_records": ListChecks,
  "nav.timesheets": CalendarClock,
  "nav.week_report": FileChartColumn,
  "nav.pay_history": Wallet,
  "nav.cis_pay_history": Wallet,
  "nav.paye_pay_history": Wallet,
  "nav.site_progress": Construction,
  "nav.starter_form": FileText,
  "nav.profile": User,
  "nav.settings": Settings,
  "nav.help": CircleHelp,
  "nav.privacy": Shield,
  "nav.overview": LineChart,
  "nav.employees": Users,
  "nav.privacy_requests": ShieldCheck,
  "nav.onboarding_review": UserPlus,
  "nav.clock_selfies": Camera,
  "nav.companies": Building,
  "nav.workplaces": Factory,
  "nav.cis_workplaces": Factory,
  "nav.locations": MapPin,
  "nav.site_access": KeyRound,
  "nav.live_attendance": Radio,
  "nav.payroll_report": FileSpreadsheet,
  "nav.cis_payroll_report": FileSpreadsheet,
  "nav.monthly_paye_report": CalendarClock,
  "nav.site_payroll_rules": SlidersHorizontal,
  "nav.budget_calculator": Calculator,
  "nav.accounting_exports": FileDown,
  "nav.work_progress_review": Image,
  "nav.toolbox_talks": ClipboardList,
  "nav.toolbox_talks_manage": Presentation,
  "nav.forms": ClipboardList,
  "nav.forms_manage": ClipboardList,
  "nav.forms_review": ClipboardCheck,
  "nav.leave": Calendar,
  "nav.leave_manage": CalendarRange,
  "nav.rams": ShieldCheck,
  "nav.rams_manage": ShieldCheck,
  "nav.audit_log": ScrollText,
  "nav.live_logs": Terminal,
  "nav.system_health": HeartPulse,
  "nav.admin_guide": BookOpen,
  "nav.my_forms": ClipboardList,
  "nav.my_toolbox_talks": ClipboardList,
  "nav.my_rams": ShieldCheck,
  "nav.my_leave": Calendar,
};

type IconTone = "blue" | "cyan" | "green" | "yellow" | "gold" | "orange" | "grey";
type IconSurface = "navy" | "light" | "neutral";

const NAV_ICON_TONE_BY_LABEL_KEY: Record<string, IconTone> = {
  "nav.dashboard": "blue",
  "nav.messages": "cyan",
  "nav.clock": "blue",
  "nav.time_records": "blue",
  "nav.timesheets": "blue",
  "nav.week_report": "blue",
  "nav.pay_history": "gold",
  "nav.cis_pay_history": "gold",
  "nav.paye_pay_history": "gold",
  "nav.site_progress": "orange",
  "nav.starter_form": "green",
  "nav.profile": "cyan",
  "nav.settings": "grey",
  "nav.help": "cyan",
  "nav.privacy": "green",
  "nav.overview": "blue",
  "nav.employees": "green",
  "nav.privacy_requests": "green",
  "nav.onboarding_review": "green",
  "nav.clock_selfies": "cyan",
  "nav.companies": "yellow",
  "nav.workplaces": "yellow",
  "nav.cis_workplaces": "yellow",
  "nav.locations": "yellow",
  "nav.site_access": "yellow",
  "nav.live_attendance": "cyan",
  "nav.payroll_report": "gold",
  "nav.cis_payroll_report": "gold",
  "nav.monthly_paye_report": "gold",
  "nav.site_payroll_rules": "gold",
  "nav.budget_calculator": "gold",
  "nav.accounting_exports": "gold",
  "nav.work_progress_review": "orange",
  "nav.toolbox_talks": "orange",
  "nav.toolbox_talks_manage": "orange",
  "nav.forms": "orange",
  "nav.forms_manage": "orange",
  "nav.forms_review": "orange",
  "nav.leave": "green",
  "nav.leave_manage": "green",
  "nav.rams": "orange",
  "nav.rams_manage": "orange",
  "nav.audit_log": "grey",
  "nav.live_logs": "cyan",
  "nav.system_health": "green",
  "nav.admin_guide": "grey",
  "nav.my_forms": "orange",
  "nav.my_toolbox_talks": "orange",
  "nav.my_rams": "orange",
  "nav.my_leave": "green",
};

const ICON_COLOR_BY_TONE: Record<IconTone, Record<IconSurface, string>> = {
  blue: { navy: "text-[#9cc8ff]", light: "text-[#326da8]", neutral: "text-current" },
  cyan: { navy: "text-[#86d9e5]", light: "text-[#287f91]", neutral: "text-current" },
  green: { navy: "text-[#8fd2b7]", light: "text-[#2f7b66]", neutral: "text-current" },
  yellow: { navy: "text-[#e4c56a]", light: "text-[#806619]", neutral: "text-current" },
  gold: { navy: "text-[#e5b955]", light: "text-[#806018]", neutral: "text-current" },
  orange: { navy: "text-[#eca866]", light: "text-[#96551f]", neutral: "text-current" },
  grey: { navy: "text-[#c3cfdd]", light: "text-[#53657a]", neutral: "text-current" },
};

const NAV_GROUP_ICON_BY_ID: Record<string, LucideIcon> = {
  "desk-dashboard": LayoutDashboard,
  "desk-overview": ChartNoAxesCombined,
  "desk-clock": Clock,
  "desk-timesheets": Calendar,
  "desk-pay-history": Wallet,
  "desk-people": Users,
  "desk-sites": MapPin,
  "desk-attendance": Clock,
  "desk-payroll": Coins,
  "desk-work": HardHat,
  "desk-system": ServerCog,
  "desk-more": MoreHorizontal,
  overview: LineChart,
  "mgmt-overview": ChartNoAxesCombined,
  "mgmt-people": Users,
  "mgmt-people-employees": Folder,
  "mgmt-people-leave": Folder,
  "mgmt-people-privacy": Folder,
  "mgmt-attendance": Clock,
  "mgmt-attendance-clocking": Folder,
  "mgmt-attendance-reports": FolderOpen,
  "mgmt-sites": MapPin,
  "mgmt-sites-management": FolderKanban,
  "mgmt-sites-progress": FolderOpen,
  "mgmt-payroll": Coins,
  "mgmt-payroll-cis": Folder,
  "mgmt-payroll-paye": Folder,
  "mgmt-payroll-finance": Folder,
  "mgmt-work": HardHat,
  "mgmt-work-forms": Folder,
  "mgmt-system": ServerCog,
  "mgmt-system-org": Folder,
  "mgmt-system-monitoring": Folder,
  "mgmt-system-support": Folder,
  "mgmt-workspace": User,
  "emp-home": LayoutDashboard,
  "emp-time": Clock,
  "emp-pay": Coins,
  "emp-work": HardHat,
  "emp-profile": User,
  "emp-account": User,
  "limited-records": FileText,
  "limited-profile": User,
  "mobile-emp-general": LayoutDashboard,
};

const NAV_GROUP_TONE_BY_ID: Record<string, IconTone> = {
  "desk-dashboard": "blue",
  "desk-overview": "blue",
  "desk-clock": "blue",
  "desk-timesheets": "blue",
  "desk-pay-history": "gold",
  "desk-people": "green",
  "desk-sites": "yellow",
  "desk-attendance": "blue",
  "desk-payroll": "gold",
  "desk-work": "orange",
  "desk-system": "cyan",
  "desk-more": "grey",
  overview: "blue",
  "mgmt-overview": "blue",
  "mgmt-people": "green",
  "mgmt-people-employees": "green",
  "mgmt-people-leave": "green",
  "mgmt-people-privacy": "green",
  "mgmt-attendance": "blue",
  "mgmt-attendance-clocking": "blue",
  "mgmt-attendance-reports": "blue",
  "mgmt-sites": "yellow",
  "mgmt-sites-management": "yellow",
  "mgmt-sites-progress": "orange",
  "mgmt-payroll": "gold",
  "mgmt-payroll-cis": "gold",
  "mgmt-payroll-paye": "gold",
  "mgmt-payroll-finance": "gold",
  "mgmt-work": "orange",
  "mgmt-work-forms": "orange",
  "mgmt-system": "cyan",
  "mgmt-system-org": "cyan",
  "mgmt-system-monitoring": "cyan",
  "mgmt-system-support": "grey",
  "mgmt-workspace": "cyan",
  "emp-home": "blue",
  "emp-time": "blue",
  "emp-pay": "gold",
  "emp-work": "orange",
  "emp-profile": "cyan",
  "emp-account": "cyan",
  "limited-records": "blue",
  "limited-profile": "cyan",
  "mobile-emp-general": "blue",
};

type NavItemIconProps = {
  labelKey: string;
  className?: string;
  surface?: IconSurface;
  "aria-hidden"?: boolean;
};

type NavGroupIconProps = {
  groupId: string;
  className?: string;
  surface?: IconSurface;
  "aria-hidden"?: boolean;
};

/** Small Lucide icon mapped from navigation `labelKey`; defaults to layout grid. */
export function NavItemIcon({
  labelKey,
  className = "h-[18px] w-[18px] shrink-0 text-current",
  surface = "neutral",
  "aria-hidden": ariaHidden = true,
}: NavItemIconProps) {
  const Icon = NAV_ICON_BY_LABEL_KEY[labelKey] ?? LayoutDashboard;
  const tone = NAV_ICON_TONE_BY_LABEL_KEY[labelKey] ?? "grey";
  return (
    <Icon
      aria-hidden={ariaHidden}
      className={cn(className, ICON_COLOR_BY_TONE[tone][surface])}
      strokeWidth={1.8}
    />
  );
}

/** Lucide icon for tree folders and desktop top-bar dropdown group triggers. */
export function NavGroupIcon({
  groupId,
  className = "h-[18px] w-[18px] shrink-0 text-current",
  surface = "neutral",
  "aria-hidden": ariaHidden = true,
}: NavGroupIconProps) {
  const Icon = NAV_GROUP_ICON_BY_ID[groupId] ?? Folder;
  const tone = NAV_GROUP_TONE_BY_ID[groupId] ?? "grey";
  return (
    <Icon
      aria-hidden={ariaHidden}
      className={cn(className, ICON_COLOR_BY_TONE[tone][surface])}
      strokeWidth={1.8}
    />
  );
}

export type { NavGroupIconProps, NavItemIconProps };
