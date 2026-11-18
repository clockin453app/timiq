export type LinkRow = {
  id: string;
  name: string;
  code?: string | null;
  reference_code?: string | null;
  is_active?: boolean;
  status?: string | null;
  workplace_id?: string | null;
  finance_project_id?: string | null;
  link_status: "LINKED" | "NOT LINKED" | string;
};

export type ProjectLinksPayload = {
  company_id: string;
  finance_projects: LinkRow[];
  workplaces: LinkRow[];
  unlinked_active_workplaces: LinkRow[];
};

export const DEMO_PROJECT_LINKS: ProjectLinksPayload = {
  company_id: "demo-company-001",
  finance_projects: [
    {
      id: "demo-project-nlo",
      name: "New London Office",
      reference_code: "NLO",
      status: "active",
      workplace_id: "demo-workplace-nlo",
      link_status: "LINKED",
    },
    {
      id: "demo-project-manual",
      name: "Manual Finance Job",
      reference_code: null,
      status: "active",
      workplace_id: null,
      link_status: "NOT LINKED",
    },
  ],
  workplaces: [
    {
      id: "demo-workplace-nlo",
      name: "New London Office",
      code: "NLO",
      is_active: true,
      finance_project_id: "demo-project-nlo",
      link_status: "LINKED",
    },
    {
      id: "demo-workplace-riverside",
      name: "Riverside Fit-Out",
      code: "RIV",
      is_active: true,
      finance_project_id: null,
      link_status: "NOT LINKED",
    },
    {
      id: "demo-workplace-old",
      name: "Closed Yard",
      code: "OLD",
      is_active: false,
      finance_project_id: null,
      link_status: "NOT LINKED",
    },
  ],
  unlinked_active_workplaces: [
    {
      id: "demo-workplace-riverside",
      name: "Riverside Fit-Out",
      code: "RIV",
      is_active: true,
      finance_project_id: null,
      link_status: "NOT LINKED",
    },
  ],
};
