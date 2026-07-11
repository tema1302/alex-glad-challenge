'use client';

// Digital rain (canvas 2D) — декоративный фон. position: fixed, z-index 0,
// pointer-events-none, aria-hidden. Контент layout обёрнут в relative z-10.
// 0 server/core импортов — чисто client-presentation.
//
// Guards: prefers-reduced-motion → нет дождя; localStorage['mx-rain']==='off' → нет дождя
// (слушатель 'mx-rain-change' переключает); visibilitychange → пауза в скрытой вкладке.
// rAF throttle ~30fps, trail rgba(4,8,6,0.06), лидер #ccffcc / тело #00ff66, shadowBlur=8.
import { useEffect, useRef, useState } from 'react';

// Катакана 0x30A0–0x30FF + латиница/цифры/пунктуация 0x21–0x7E.
const CHARSET: string = (() => {
  let s = '';
  for (let c = 0x30a0; c <= 0x30ff; c++) s += String.fromCharCode(c);
  for (let c = 0x21; c <= 0x7e; c++) s += String.fromCharCode(c);
  return s;
})();

const FONT_SIZE = 14;
const FPS_INTERVAL = 1000 / 30;

export default function MatrixRain({ opacity = 0.14 }: { opacity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // enabled управляется localStorage + событием 'mx-rain-change' от RainToggle.
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(localStorage.getItem('mx-rain') !== 'off');
    const onToggle = () => setEnabled(localStorage.getItem('mx-rain') !== 'off');
    window.addEventListener('mx-rain-change', onToggle);
    return () => window.removeEventListener('mx-rain-change', onToggle);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cols = 0;
    let drops: Int32Array = new Int32Array(0);

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      cols = Math.floor(canvas.width / FONT_SIZE);
      drops = new Int32Array(cols);
      for (let i = 0; i < cols; i++) drops[i] = Math.floor((Math.random() * -50));
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    let last = 0;

    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw);
      if (ts - last < FPS_INTERVAL) return;
      last = ts;

      // trail: полупрозрачный void затухание过去的 глифов.
      ctx.fillStyle = 'rgba(4,8,6,0.06)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${FONT_SIZE}px ui-monospace, monospace`;
      ctx.shadowColor = '#00ff66';
      ctx.shadowBlur = 8;

      for (let i = 0; i < cols; i++) {
        const ch = CHARSET[(Math.random() * CHARSET.length) | 0];
        const x = i * FONT_SIZE;
        const y = drops[i] * FONT_SIZE;
        // ~2.5% — ведущий глиф (bright), остальное — фосфор-green тело.
        ctx.fillStyle = Math.random() > 0.975 ? '#ccffcc' : '#00ff66';
        ctx.fillText(ch, x, y);
        if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    };
    raf = requestAnimationFrame(draw);

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = 0;
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none"
      style={{ position: 'fixed', inset: 0, zIndex: 0, opacity: enabled ? opacity : 0 }}
    />
  );
}
