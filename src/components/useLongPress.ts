import { useRef } from 'react';

/** 長押し（既定 0.7 秒）で呼ぶ。指が動いたら取り消す */
export function useLongPress(callback: () => void, ms = 700) {
  const timer = useRef<number>();
  const start = useRef<{ x: number; y: number } | null>(null);

  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        start.current = null;
        callback();
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}
