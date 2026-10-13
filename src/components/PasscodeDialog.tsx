import { useState } from 'react';
import { useApp } from '../AppContext';
import { api, ApiError } from '../lib/api';
import { Sheet } from './Sheet';

export function PasscodeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token, enterAdmin, showToast } = useApp();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setCode('');
    setMessage('');
    onClose();
  };

  const submit = async () => {
    if (!code || busy) return;
    setBusy(true);
    try {
      const r = await api.adminLogin(token, code);
      if (r.ok && r.session && r.expires_at) {
        enterAdmin(r.session, r.expires_at);
        showToast('管理者モードになりました');
        close();
      } else {
        setMessage(r.message ?? 'パスコードが違います。');
        setCode('');
      }
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : '通信に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close} title="パスコード">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          className="input"
          type="password"
          inputMode="text"
          autoComplete="current-password"
          aria-label="パスコード"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
        {message && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={!code || busy}>
          {busy ? '確認中…' : 'OK'}
        </button>
      </form>
    </Sheet>
  );
}
