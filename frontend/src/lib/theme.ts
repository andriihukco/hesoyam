import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = '1mbot.theme';

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(p: ThemePref) {
  const el = document.documentElement;
  if (p === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', p);
  // Status bar / browser chrome colour must follow the in-app choice, not only the OS setting.
  const colors = { light: '#f2f2f7', dark: '#000000' };
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const scheme = m.dataset.scheme ?? (m.media.includes('dark') ? 'dark' : 'light');
    m.dataset.scheme = scheme;
    if (p === 'system') {
      m.media = `(prefers-color-scheme: ${scheme})`;
      m.content = colors[scheme as 'light' | 'dark'];
    } else {
      m.media = 'all';
      m.content = colors[p];
    }
  });
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(read);
  useEffect(() => {
    applyTheme(pref);
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* private mode */
    }
  }, [pref]);
  return [pref, setPref] as const;
}
