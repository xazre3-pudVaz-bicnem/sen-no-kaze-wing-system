'use client';

import { useEffect } from 'react';

const TARGET_SELECTOR =
  '.registration-step1-sections #customer-selection [data-testid="variant-quick-add"]';
const ROOT_SELECTOR = ':scope > [data-combined-create-root="true"]';
const OPEN_BUTTON_SELECTOR = ':scope > button[aria-expanded="true"]';

export function ProductRegistrationFormPlacementFix() {
  useEffect(() => {
    let resizeObserver: ResizeObserver | null = null;
    let activeTarget: HTMLElement | null = null;
    let activeForm: HTMLElement | null = null;

    const clearPlacement = () => {
      resizeObserver?.disconnect();
      resizeObserver = null;

      if (activeTarget) {
        activeTarget.style.removeProperty('position');
        activeTarget.style.removeProperty('margin-bottom');
      }
      if (activeForm) {
        activeForm.style.removeProperty('position');
        activeForm.style.removeProperty('top');
        activeForm.style.removeProperty('left');
        activeForm.style.removeProperty('right');
        activeForm.style.removeProperty('z-index');
      }

      activeTarget = null;
      activeForm = null;
    };

    const reserveSpace = () => {
      if (!activeTarget || !activeForm) return;
      const height = activeForm.getBoundingClientRect().height;
      activeTarget.style.marginBottom = `${Math.ceil(height) + 12}px`;
    };

    const placeFormBelowCard = () => {
      const target = document.querySelector<HTMLElement>(TARGET_SELECTOR);
      const root = target?.querySelector<HTMLElement>(ROOT_SELECTOR);
      const openButton = root?.querySelector<HTMLButtonElement>(OPEN_BUTTON_SELECTOR);
      const form = openButton?.nextElementSibling;

      if (!target || !root || !openButton || !(form instanceof HTMLElement)) {
        clearPlacement();
        return;
      }

      if (target === activeTarget && form === activeForm) {
        reserveSpace();
        return;
      }

      clearPlacement();
      activeTarget = target;
      activeForm = form;

      target.style.position = 'relative';
      form.style.position = 'absolute';
      form.style.top = 'calc(100% + 12px)';
      form.style.left = '0';
      form.style.right = '0';
      form.style.zIndex = '1';

      reserveSpace();
      resizeObserver = new ResizeObserver(reserveSpace);
      resizeObserver.observe(form);
    };

    const observer = new MutationObserver(placeFormBelowCard);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded'],
    });
    window.addEventListener('resize', placeFormBelowCard);
    placeFormBelowCard();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', placeFormBelowCard);
      clearPlacement();
    };
  }, []);

  return null;
}
