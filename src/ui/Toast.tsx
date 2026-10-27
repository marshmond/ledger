import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  text: string;
  undo?: () => void | Promise<void>;
}

const ToastContext = createContext<(text: string, undo?: () => void | Promise<void>) => void>(() => undefined);

/** Shows a short confirmation at the bottom of the screen, with an Undo button when the action can be reversed. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);
  const show = useCallback((text: string, undo?: () => void | Promise<void>) => {
    const id = next.current++;
    setItems((cur) => [...cur.slice(-2), { id, text, undo }]);
    setTimeout(() => dismiss(id), undo ? 8000 : 4500);
  }, [dismiss]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div className="toast" key={t.id}>
            <span>{t.text}</span>
            {t.undo && <button className="link" onClick={async () => { dismiss(t.id); await t.undo?.(); }}>Undo</button>}
            <button className="link" aria-label="Dismiss" onClick={() => dismiss(t.id)}>✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
