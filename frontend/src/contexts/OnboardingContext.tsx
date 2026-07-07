'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { PermissionStatus, OnboardingPermissions } from '@/types/onboarding';

// API-only onboarding: no local models are downloaded. The summary model is a
// cloud (Anthropic) model configured via API key.
const DEFAULT_SUMMARY_MODEL = 'claude-sonnet-5';

const MAX_STEP = 3; // 1: Welcome, 2: API Keys, 3: Permissions (macOS)

interface OnboardingStatus {
  version: string;
  completed: boolean;
  current_step: number;
  model_status: {
    parakeet: string;
    summary: string;
    selected_summary_model?: string;
  };
  last_updated: string;
}

interface OnboardingContextType {
  currentStep: number;
  databaseExists: boolean;
  // Permissions
  permissions: OnboardingPermissions;
  permissionsSkipped: boolean;
  // Navigation
  goToStep: (step: number) => void;
  goNext: () => void;
  goPrevious: () => void;
  // Setters
  setDatabaseExists: (value: boolean) => void;
  setPermissionStatus: (permission: keyof OnboardingPermissions, status: PermissionStatus) => void;
  setPermissionsSkipped: (skipped: boolean) => void;
  completeOnboarding: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);
  const [databaseExists, setDatabaseExists] = useState(false);

  // Permissions state
  const [permissions, setPermissions] = useState<OnboardingPermissions>({
    microphone: 'not_determined',
    systemAudio: 'not_determined',
    screenRecording: 'not_determined',
  });
  const [permissionsSkipped, setPermissionsSkipped] = useState(false);

  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const isCompletingRef = useRef(false);

  // Load status on mount and initialize database
  useEffect(() => {
    loadOnboardingStatus();
    checkDatabaseStatus();
    initializeDatabaseInBackground();
  }, []);

  // Initialize database silently in background
  const initializeDatabaseInBackground = async () => {
    try {
      console.log('[OnboardingContext] Starting background database initialization');
      const isFirstLaunch = await invoke<boolean>('check_first_launch');

      if (!isFirstLaunch) {
        console.log('[OnboardingContext] Database exists, skipping initialization');
        setDatabaseExists(true);
        return;
      }

      // First launch - attempt auto-detection and import
      await performAutoDetection();
    } catch (error) {
      console.error('[OnboardingContext] Database initialization failed:', error);
      // Don't throw - database init failure shouldn't block onboarding
    }
  };

  const performAutoDetection = async () => {
    // Check Homebrew (macOS only)
    if (typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac')) {
      const homebrewDbPath = '/usr/local/var/meetily/meeting_minutes.db';
      try {
        const homebrewCheck = await invoke<{ exists: boolean; size: number } | null>(
          'check_homebrew_database',
          { path: homebrewDbPath }
        );

        if (homebrewCheck?.exists) {
          console.log('[OnboardingContext] Found Homebrew database, importing');
          await invoke('import_and_initialize_database', { legacyDbPath: homebrewDbPath });
          setDatabaseExists(true);
          return;
        }
      } catch (e) {
        console.log('[OnboardingContext] Homebrew check failed, continuing:', e);
      }
    }

    // Check default legacy database location
    try {
      const legacyPath = await invoke<string | null>('check_default_legacy_database');
      if (legacyPath) {
        console.log('[OnboardingContext] Found legacy database, importing');
        await invoke('import_and_initialize_database', { legacyDbPath: legacyPath });
        setDatabaseExists(true);
        return;
      }
    } catch (e) {
      console.log('[OnboardingContext] Legacy check failed, continuing:', e);
    }

    // No legacy database found - initialize fresh
    console.log('[OnboardingContext] No legacy database found, initializing fresh');
    await invoke('initialize_fresh_database');
    setDatabaseExists(true);
  };

  // Auto-save on state change (debounced)
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    // Don't auto-save if completed (to avoid overwriting completion status)
    // Also don't auto-save if we are currently in the process of completing
    if (completed || isCompletingRef.current) return;

    saveTimeoutRef.current = setTimeout(() => {
      saveOnboardingStatus();
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [currentStep, completed]);

  const checkDatabaseStatus = async () => {
    try {
      const isFirstLaunch = await invoke<boolean>('check_first_launch');
      setDatabaseExists(!isFirstLaunch);
      console.log('[OnboardingContext] Database exists:', !isFirstLaunch);
    } catch (error) {
      console.error('[OnboardingContext] Failed to check database status:', error);
      setDatabaseExists(false);
    }
  };

  const loadOnboardingStatus = async () => {
    try {
      const status = await invoke<OnboardingStatus | null>('get_onboarding_status');
      if (status) {
        console.log('[OnboardingContext] Loaded saved status:', status);
        // Clamp legacy step numbers (older builds had 4+ steps with downloads)
        setCurrentStep(Math.max(1, Math.min(status.current_step, MAX_STEP)));
        setCompleted(status.completed);
      }
    } catch (error) {
      console.error('[OnboardingContext] Failed to load onboarding status:', error);
    }
  };

  const saveOnboardingStatus = async () => {
    if (isCompletingRef.current) {
      console.log('[OnboardingContext] Skipping saveOnboardingStatus because completion is in progress');
      return;
    }

    try {
      await invoke('save_onboarding_status_cmd', {
        status: {
          version: '1.0',
          completed: completed,
          current_step: currentStep,
          // Legacy field shape kept for backwards compatibility with saved
          // status files; no local models exist in this build.
          model_status: {
            parakeet: 'not_applicable',
            summary: 'not_applicable',
            selected_summary_model: undefined,
          },
          last_updated: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('[OnboardingContext] Failed to save onboarding status:', error);
    }
  };

  const completeOnboarding = async () => {
    try {
      // Set completion flag to prevent race conditions with auto-save
      isCompletingRef.current = true;

      // Clear any pending auto-saves
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = undefined;
      }

      await invoke('complete_onboarding', {
        model: DEFAULT_SUMMARY_MODEL,
      });
      setCompleted(true);
      console.log('[OnboardingContext] Onboarding completed');

      isCompletingRef.current = false;
    } catch (error) {
      console.error('[OnboardingContext] Failed to complete onboarding:', error);
      isCompletingRef.current = false;
      throw error; // Re-throw so PermissionsStep can handle it
    }
  };

  const setPermissionStatus = useCallback((permission: keyof OnboardingPermissions, status: PermissionStatus) => {
    setPermissions((prev: OnboardingPermissions) => ({
      ...prev,
      [permission]: status,
    }));
  }, []);

  const goToStep = useCallback((step: number) => {
    setCurrentStep(Math.max(1, Math.min(step, MAX_STEP)));
  }, []);

  const goNext = useCallback(() => {
    setCurrentStep((prev: number) => Math.min(prev + 1, MAX_STEP));
  }, []);

  const goPrevious = useCallback(() => {
    setCurrentStep((prev: number) => Math.max(prev - 1, 1));
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        currentStep,
        databaseExists,
        permissions,
        permissionsSkipped,
        goToStep,
        goNext,
        goPrevious,
        setDatabaseExists,
        setPermissionStatus,
        setPermissionsSkipped,
        completeOnboarding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
