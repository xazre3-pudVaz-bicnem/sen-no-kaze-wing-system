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
  const saveHandlerRef = useRef<SaveHandler | null>(null);
  const dirtyRef = useRef(false);
  const bypassFormRef = useRef<HTMLFormElement | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const [saving, setSaving] = useState(false);

  const registerSaveHandler = useCallback((handler: SaveHandler) => {
    saveHandlerRef.current = handler;
    return () => {
      if (saveHandlerRef.current === handler) saveHandlerRef.current = null;
    };
  }, []);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const markClean = useCallback(() => {
    dirtyRef.current = false;
  }, []);

  const saveIfDirty = useCallback(async () => {
    if (!dirtyRef.current) return true;
    if (!saveHandlerRef.current) return false;
    if (savePromiseRef.current) return savePromiseRef.current;

    setSaving(true);
    const promise = saveHandlerRef.current()
      .then((ok) => {
        if (ok) dirtyRef.current = false;
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
