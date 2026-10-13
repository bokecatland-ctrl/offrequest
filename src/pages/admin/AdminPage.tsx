import { AuditPanel } from './AuditPanel';
import { ExportPanel } from './ExportPanel';
import { LongLeaveAdmin } from './LongLeaveAdmin';
import { MonthsPanel } from './MonthsPanel';
import { Overview } from './Overview';
import { SettingsPanel } from './SettingsPanel';
import { StaffPanel } from './StaffPanel';

export type AdminSection = 'overview' | 'export' | 'longleave' | 'months' | 'staff' | 'settings' | 'audit';

export const ADMIN_SECTIONS: { id: AdminSection; label: string }[] = [
  { id: 'overview', label: '月間一覧' },
  { id: 'export', label: 'シフト表用の書き出し' },
  { id: 'longleave', label: '長期有休の登録' },
  { id: 'months', label: '月の設定' },
  { id: 'staff', label: '名簿' },
  { id: 'settings', label: 'URL・設定' },
  { id: 'audit', label: '操作履歴' },
];

export function AdminPage({ section }: { section: AdminSection }) {
  switch (section) {
    case 'overview':
      return <Overview />;
    case 'export':
      return <ExportPanel />;
    case 'longleave':
      return <LongLeaveAdmin />;
    case 'months':
      return <MonthsPanel />;
    case 'staff':
      return <StaffPanel />;
    case 'settings':
      return <SettingsPanel />;
    case 'audit':
      return <AuditPanel />;
  }
}
