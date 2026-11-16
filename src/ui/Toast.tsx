import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

/** R1.3: one optional extra button beside Undo (for example "Log completed visit"). It only runs when pressed; ignoring the toast changes nothing. */
export interface ToastAction { label: string; onClick: () => void }
export type ToastFn = (text: string, undo?: () => void | Promise<void>, action?: ToastAction) => void;

interface ToastItem {
  id: number;
  text: string;
  undo?: () => void | Promise<void>;
  action?: ToastAction;
}

const ToastContext = createContext<ToastFn>(() => undefined);

/** Shows a short confirmation at the bottom of the screen, with an Undo button when the action can be reversed. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);
  const show = useCallback<ToastFn>((text, undo, action) => {
    const id = next.current++;
    setItems((cur) => [...cur.slice(-2), { id, text, undo, action }]);
    // A toast that offers a next step stays a little longer, so the offer can be read and used on a phone.
    setTimeout(() => dismiss(id), action ? 12000 : undo ? 8000 : 4500);
  }, [dismiss]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div className="toast" key={t.id}>
            <span>{t.text}</span>
            {t.action && <button className="link toast-action" onClick={() => { dismiss(t.id); t.action?.onClick(); }}>{t.action.label}</button>}
            {t.undo && <button className="link" onClick={async () => { dismiss(t.id); await t.undo?.(); }}>Undo</button>}
            <button className="link" aria-label="Dismiss" onClick={() => dismiss(t.id)}>✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
