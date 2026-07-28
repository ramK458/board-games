import { useEffect, useCallback } from 'react';
import { useUiStore } from '../stores/uiStore';
import { useTabStore } from '../stores/tabStore';

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modKey = isMac ? 'metaKey' : 'ctrlKey';

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  handler: () => void;
  description: string;
}

export function useKeyboardShortcuts() {
  const toggleSidebar = useUiStore(s => s.toggleSidebar);
  const closeTab = useTabStore(s => s.closeTab);
  const tabs = useTabStore(s => s.tabs);
  const activeTabId = useTabStore(s => s.activeTabId);
  const setActiveTab = useTabStore(s => s.setActiveTab);
  const setSearchFocus = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="Search"]');
    input?.focus();
  }, []);

  const shortcuts: Shortcut[] = [
    {
      key: 'k',
      ctrl: true,
      handler: setSearchFocus,
      description: 'Focus search',
    },
    {
      key: '\\',
      ctrl: true,
      handler: toggleSidebar,
      description: 'Toggle sidebar',
    },
    {
      key: 'w',
      ctrl: true,
      handler: () => {
        if (activeTabId) closeTab(activeTabId);
      },
      description: 'Close active tab',
    },
    {
      key: 'Tab',
      ctrl: true,
      handler: () => {
        if (tabs.length === 0) return;
        const idx = tabs.findIndex(t => t.id === activeTabId);
        const next = (idx + 1) % tabs.length;
        setActiveTab(tabs[next].id);
      },
      description: 'Next tab',
    },
  ];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs/textareas
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // Allow Escape to close anyway
        if (e.key === 'Escape') {
          (target as HTMLInputElement).blur();
          return;
        }
        return;
      }

      for (const s of shortcuts) {
        const modMatch = s.ctrl ? e[modKey] : true;
        const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;
        if (modMatch && shiftMatch && e.key.toLowerCase() === s.key.toLowerCase()) {
          e.preventDefault();
          s.handler();
          return;
        }
      }

      // ? shows cheat sheet
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        alert(
          'Keyboard Shortcuts:\n' +
          shortcuts.map(s => `  ${isMac ? '⌘' : 'Ctrl'}+${s.key.toUpperCase()} — ${s.description}`).join('\n') +
          '\n  ? — Show this help'
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId]);
}
