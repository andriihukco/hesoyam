import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface ConfirmOpts { title: string; body?: ReactNode; confirm: string; danger?: boolean }
type Ask = (o: ConfirmOpts) => Promise<boolean>;

const Ctx = createContext<Ask>(async () => false);

/** One styled confirm for the whole app: bottom sheet on phones, dialog on desktop. Escape or backdrop = cancel. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback<Ask>((o) => new Promise((resolve) => setReq({ ...o, resolve })), []);
  const done = (v: boolean) => {
    req?.resolve(v);
    setReq(null);
  };
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!req) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && done(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Ctx.Provider value={ask}>
      {children}
      {req && (
        <div className="fixed inset-0 z-50" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
          <button type="button" aria-label="Cancel" className="absolute inset-0 bg-black/40" onClick={() => done(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-bg p-4 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-2xl
            sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(420px,92vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-4">
            <h2 id="confirm-title" className="text-[17px] font-semibold">{req.title}</h2>
            {req.body && <div className="mt-1.5 text-[14px] leading-snug text-label-2">{req.body}</div>}
            <div className="mt-4 flex gap-2">
              <button type="button" className="btn btn-tinted flex-1" onClick={() => done(false)}>Cancel</button>
              <button type="button" ref={okRef} className={`btn flex-1 ${req.danger ? 'btn-danger' : 'btn-filled'}`} onClick={() => done(true)}>
                {req.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
