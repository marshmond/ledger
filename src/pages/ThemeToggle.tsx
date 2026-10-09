import { useState } from 'react';
import { THEME_LABEL, applyTheme, loadTheme, nextTheme, saveTheme, type Theme } from '../theme';

const ICON: Record<Theme, string> = { device: '◐', light: '☀', dark: '☾' };

/** One-tap theme switch for the nav bar: cycles Device, Light, Dark. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const change = () => {
    const t = nextTheme(theme);
    saveTheme(t);
    applyTheme(t);
    setTheme(t);
  };
  return (
    <button
      className="themebtn"
      onClick={change}
      title={`Theme: ${THEME_LABEL[theme]}. Click to change (Device, Light, Dark).`}
      aria-label={`Theme: ${THEME_LABEL[theme]}. Activate to switch to ${THEME_LABEL[nextTheme(theme)]}.`}
    >
      <span aria-hidden="true">{ICON[theme]}</span> {THEME_LABEL[theme]}
    </button>
  );
}
