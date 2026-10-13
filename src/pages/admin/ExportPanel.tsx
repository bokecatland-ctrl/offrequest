import { useMemo } from 'react';
import { useApp } from '../../AppContext';
import { monthLabel } from '../../lib/dates';
import { buildShiftRows, missingShiftNames, toCsv, toTsv } from '../../lib/exportShift';

/** シフト表（Excel）用の書き出し */
export function ExportPanel() {
  const { data, admin, showToast } = useApp();
  const rows = useMemo(
    () =>
      data && admin
        ? buildShiftRows({
            month: data.month,
            staff: admin.staff,
            requests: data.requests,
            longLeaves: data.long_leaves,
            offSymbol: admin.settings.off_symbol,
            paidSymbol: admin.settings.paid_symbol,
          })
        : [],
    [data, admin],
  );
  if (!data || !admin) return null;

  const missing = missingShiftNames(admin.staff);
  const pending = data.requests.filter((r) => r.kind === 'paid' && r.status === 'pending').length;

  const confirmMissing = () =>
    missing.length === 0 ||
    window.confirm(
      `シフト表上の氏名が未設定の人がいます（${missing.map((s) => s.name).join('・')}）。\n` +
        'このまま書き出すと、氏名の列が空になります。続けますか？',
    );

  const copy = async () => {
    if (!confirmMissing()) return;
    const text = toTsv(rows);
    try {
      await navigator.clipboard.writeText(text);
      showToast('コピーしました。Excel に貼り付けてください');
    } catch {
      // クリップボードが使えない環境では、選択して手動でコピーしてもらう
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(ok ? 'コピーしました。Excel に貼り付けてください' : 'コピーできませんでした。CSV を使ってください', ok ? 'ok' : 'error');
    }
  };

  const download = () => {
    if (!confirmMissing()) return;
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `希望休_${data.month}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="stack">
      <section className="card">
        <h2 className="card-title">シフト表用の書き出し（{monthLabel(data.month)}）</h2>
        {missing.length > 0 && (
          <p className="warn-box">
            シフト表上の氏名が未設定の人がいます：{missing.map((s) => s.name).join('・')}。「名簿」で設定してください。
          </p>
        )}
        {pending > 0 && <p className="warn-box">要相談のままの希望有休が {pending} 件あります（書き出しには含まれません）。</p>}
        {!data.is_closed && <p className="info-box">まだ締切前です。締切後に書き出すと確実です。</p>}
        <div className="btn-pair">
          <button type="button" className="btn btn-primary" onClick={copy}>
            シフト表用にコピー
          </button>
          <button type="button" className="btn btn-outline" onClick={download}>
            CSVでダウンロード
          </button>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">貼り付け方</h3>
        <ol className="steps">
          <li>シフト表を開き、最初の社員の行の <strong>D列（氏名）</strong> のセルを選びます。</li>
          <li>
            すでに入力済みのセルを消さないよう、<strong>「形式を選択して貼り付け」→「空白セルを無視する」</strong>
            にチェックを入れて貼り付けます。
          </li>
          <li>貼り付け後、氏名の列が元の氏名と一致していれば、位置が合っています。</li>
        </ol>
        <p className="muted small">
          中身：希望休 →「{admin.settings.off_symbol}」、確認済みの希望有休・長期有休 →「{admin.settings.paid_symbol}」。
          要相談の希望有休、出勤時間希望・予定ありは含みません。行の順番は「名簿」の並び順です。
        </p>
      </section>

      <section className="card">
        <h3 className="card-title">プレビュー</h3>
        <div className="table-wrap">
          <table className="month-table preview-table">
            <thead>
              <tr>
                <th className="sticky-col">D（氏名）</th>
                {Array.from({ length: 31 }, (_, i) => (
                  <th key={i}>{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th className={`sticky-col${r[0] ? '' : ' missing'}`}>{r[0] || '（未設定）'}</th>
                  {r.slice(1).map((v, j) => (
                    <td key={j} className={v ? (v === admin.settings.off_symbol ? 'c-off' : 'c-paid') : ''}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
