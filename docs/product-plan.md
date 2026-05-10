# TimIQ Product Plan

TimIQ is a professional workforce and payroll app for employees, admins, and administrators.

## Confirmed decisions

- Product name: TimIQ
- System roles: Administrator, Admin, Employee
- Employee job roles: customizable by workplace, such as bricklayer, electrician, labourer, and supervisor
- Database: PostgreSQL is the source of truth
- Google Sheets: not used
- Google Drive: used only for pictures, onboarding documents, selfies, and site progress files
- Deployment target: GitHub and Render
- Data migration: not needed; the new app starts from zero
- Payroll: weekly payroll with workplace-level custom rules

## Workplace customization

Each workplace can control:

- Overtime thresholds
- Rounding rules
- Tax percentage
- Break rules
- Paid or unpaid breaks
- Pay period rules
- Employee job roles and rates
- Manual payroll adjustments
