import { useApp } from '../AppContext';

/** 名前選択（初回）。選んだ名前はこのスマホに記憶する */
export function NamePicker({ onPicked }: { onPicked?: () => void }) {
  const { boot, staffId, setStaffId } = useApp();
  const staff = boot?.staff ?? [];
  return (
    <div className="name-picker">
      <p className="hint">あなたの名前を選んでください。次からはこのスマホが覚えています。</p>
      {staff.length === 0 && <p className="empty">名簿がまだ登録されていません。管理者に連絡してください。</p>}
      <div className="name-grid">
        {staff.map((s) => (
          <button
            type="button"
            key={s.id}
            className={`name-btn${s.id === staffId ? ' selected' : ''}`}
            onClick={() => {
              setStaffId(s.id);
              onPicked?.();
            }}
          >
            <span className="truncate">{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
