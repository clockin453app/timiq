/** Isolated UI fixture. These rows are not payroll, not bank payments, and must never be posted. */
export const FICTIONAL_WORKER_PREVIEW = {
  label: "FICTIONAL PREVIEW — NOT POSTED",
  cis: [
    { worker: "Test Worker A", period: "Week 40", payable: "£800.00", paid: "£500.00", due: "£300.00", reference: "DEMO-BA-01", status: "Part-paid" },
    { worker: "Test Worker B", period: "Week 40", payable: "£700.00", paid: "£300.00", due: "£400.00", reference: "DEMO-BA-02", status: "Part-paid" },
    { worker: "Test Worker C", period: "Week 40", payable: "£600.00", paid: "£600.00", due: "£0.00", reference: "DEMO-BA-03", status: "Paid · demo" },
  ],
  paye: [
    { worker: "Test Employee D", period: "Sep 2026", payable: "£1,750.00", paid: "£1,000.00", due: "£750.00", reference: "DEMO-BA-04", status: "Part-paid" },
  ],
} as const;
