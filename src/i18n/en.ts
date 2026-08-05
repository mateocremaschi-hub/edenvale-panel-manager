const en = {
  nav_dashboard: 'Dashboard',
  nav_map: 'Map',
  nav_search: 'Search',
  nav_reports: 'Reports',
  nav_replacements: 'Replacements',
  nav_records: 'Records',
  nav_sync: 'Sync',
  nav_settings: 'Settings',

  dashboard_total_panels: 'Total panels',
  dashboard_open_issues: 'Open issues',
  dashboard_pending_replacement: 'Pending replacement',
  dashboard_replaced_week: 'Replaced this week',
  dashboard_replaced_month: 'Replaced this month',
  dashboard_replaced_year: 'Replaced this year',
  dashboard_no_sunmanager: 'Replacements not uploaded to SM',

  operator_pick_title: 'Who is working?',
  operator_pick_subtitle: 'Select your name to start. No password needed.',
  operator_add_new: 'Add new operator',
  operator_name_placeholder: 'Full name',

  status_normal: 'Normal',
  status_issue_reported: 'Issue reported',
  status_under_assessment: 'Under assessment',
  status_monitoring: 'Monitoring',
  status_pending_replacement: 'Pending replacement',
  status_replaced: 'Replaced',
  status_closed: 'Closed',
  status_reopened: 'Reopened',

  common_save: 'Save',
  common_cancel: 'Cancel',
  common_search: 'Search',
  common_block: 'Block',
  common_operator: 'Operator',
  common_date: 'Date',
  common_confirm: 'Confirm',
  common_close: 'Close',
} as const;

export default en;
export type TranslationKey = keyof typeof en;
