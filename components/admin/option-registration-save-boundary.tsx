'use client';

import {
  createContext,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui';
import { OptionRegistrationUiEnhancer } from '@/components/admin/option-registration-ui-enhancer';
import { OptionRegistrationFinalUiEnhancer } from '@/components/admin/option-registration-final-ui-enhancer';

type SaveHandler = () => Promise<boolean>;

type OptionRegistrationSaveContextValue = {
  registerSaveHandler: (handler: SaveHandler) => () => void;
  markDirty: () => void;
  markClean: () => void;
  saveIfDirty: () => Promise<boolean>;
  saving: boolean;
};

const OptionRegistrationSaveContext = createContext<OptionRegistrationSaveContextValue>({
  registerSaveHandler: () => () => undefined,
  markDirty: () => undefined,
  markClean: () => undefined,
  saveIfDirty: async () => true,
  saving: false,
});

export function useOptionRegistrationSave() {
  return useContext(OptionRegistrationSaveContext);
}

export function OptionRegistrationSaveBoundary({ children }: { children: ReactNode }) {
  const router = useRouter();
  const saveHandlersRef = useRef(new Set<SaveHandler>());
  const dirtyRef = useRef(false);
  const bypassFormRef = useRef<HTMLFormElement | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hasSaveHandler, setHasSaveHandler] = useState(false);

  const registerSaveHandler = useCallback((handler: SaveHandler) => {
    saveHandlersRef.current.add(handler);
    setHasSaveHandler(saveHandlersRef.current.size > 0);
    return () => {
      saveHandlersRef.current.delete(handler);
      setHasSaveHandler(saveHandlersRef.current.size > 0);
    };
  }, []);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  const markClean = useCallback(() => {
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  const saveIfDirty = useCallback(async () => {
    if (!dirtyRef.current) return true;
    const handlers = [...saveHandlersRef.current];
    if (handlers.length === 0) return false;
    if (savePromiseRef.current) return savePromiseRef.current;

    setSaving(true);
    const promise = (async () => {
      for (const handler of handlers) {
        const ok = await handler();
        if (!ok) return false;
      }
      return true;
    })()
      .then((ok) => {
        if (ok) {
          dirtyRef.current = false;
          setDirty(false);
        }
        return ok;
      })
      .finally(() => {
        savePromiseRef.current = null;
        setSaving(false);
      });
    savePromiseRef.current = promise;
    return promise;
  }, []);

  const handleSubmitCapture = useCallback(
    (event: FormEvent<HTMLDivElement>) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.id === 'option-main-form' || form.dataset.skipOptionAutosave === 'true') return;
      if (bypassFormRef.current === form) {
        bypassFormRef.current = null;
        return;
      }
      if (!dirtyRef.current) return;

      event.preventDefault();
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      void saveIfDirty().then((ok) => {
        if (!ok) return;
        bypassFormRef.current = form;
        if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) {
          form.requestSubmit(submitter);
        } else {
          form.requestSubmit();
        }
      });
    },
    [saveIfDirty]
  );

  const handleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download') || anchor.dataset.skipOptionAutosave === 'true') return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (/^https?:\/\//i.test(href)) return;

      event.preventDefault();
      event.stopPropagation();
      void saveIfDirty().then((ok) => {
        if (ok) router.push(href);
      });
    },
    [router, saveIfDirty]
  );

  return (
    <OptionRegistrationSaveContext.Provider
      value={{ registerSaveHandler, markDirty, markClean, saveIfDirty, saving }}
    >
      <OptionRegistrationUiEnhancer scrollAfterCreate />
      <OptionRegistrationFinalUiEnhancer />
      {hasSaveHandler && (
        <div
          data-testid="option-registration-save-status"
          className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-sm ${
            saving
              ? 'border-line bg-white text-ink-soft'
              : dirty
                ? 'border-[#d9a441] bg-[#fff8e8] text-[#7c5a18]'
                : 'border-[#b7d1c2] bg-[#f0f7f3] text-[#245a48]'
          }`}
          aria-live="polite"
        >
          {saving && <Spinner />}
          {saving ? '保存中…' : dirty ? '未保存の変更があります' : '✓ 保存済み'}
        </div>
      )}
      <div onClickCapture={handleClickCapture} onSubmitCapture={handleSubmitCapture}>{children}</div>
    </OptionRegistrationSaveContext.Provider>
  );
}

export function OptionRegistrationPreviewButton({
  href,
  className,
  children,
  ariaCurrent,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  ariaCurrent?: 'step';
}) {
  const router = useRouter();
  const { saveIfDirty, saving } = useOptionRegistrationSave();

  return (
    <button
      type="button"
      className={className}
      aria-current={ariaCurrent}
      disabled={saving}
      onClick={() => {
        const form = document.getElementById('option-main-form');
        if (form instanceof HTMLFormElement && !form.reportValidity()) return;
        void saveIfDirty().then((ok) => {
          if (ok) router.push(href);
        });
      }}
    >
      {saving && <Spinner />}
      {children}
    </button>
  );
}
