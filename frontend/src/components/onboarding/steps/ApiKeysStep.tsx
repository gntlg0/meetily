import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { KeyRound, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { toast } from 'sonner';

const DEFAULT_SUMMARY_PROVIDER = 'claude';
const DEFAULT_SUMMARY_MODEL = 'claude-sonnet-5';

/**
 * Onboarding step 2: enter API keys.
 *
 * Meetily (this fork) is API-only: summaries run through the Anthropic API,
 * and transcription will use a cloud ASR provider. No models are downloaded
 * to this machine.
 */
export function ApiKeysStep() {
  const { goNext, completeOnboarding } = useOnboarding();
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isMac, setIsMac] = useState(false);

  React.useEffect(() => {
    const checkPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os');
        setIsMac(platform() === 'macos');
      } catch {
        setIsMac(navigator.userAgent.includes('Mac'));
      }
    };
    checkPlatform();
  }, []);

  const finishStep = async () => {
    if (isMac) {
      goNext(); // Permissions step completes onboarding
    } else {
      await completeOnboarding();
      window.location.reload();
    }
  };

  const handleContinue = async () => {
    setSaving(true);
    try {
      if (anthropicKey.trim()) {
        await invoke('api_save_model_config', {
          provider: DEFAULT_SUMMARY_PROVIDER,
          model: DEFAULT_SUMMARY_MODEL,
          whisperModel: '',
          apiKey: anthropicKey.trim(),
          ollamaEndpoint: null,
          authToken: null,
        });
        toast.success('Anthropic API key saved');
      }
      await finishStep();
    } catch (error) {
      console.error('Failed to save API key:', error);
      toast.error('Failed to save API key', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      await finishStep();
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingContainer
      title="Connect your API keys"
      description="Meetily uses cloud APIs — nothing runs locally. Add your Anthropic API key for meeting summaries. You can change keys anytime in Settings."
      step={2}
      totalSteps={isMac ? 3 : 2}
    >
      <div className="flex flex-col items-center space-y-6">
        <div className="w-full max-w-lg bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Anthropic API key</h3>
              <p className="text-sm text-gray-500">Used for AI meeting summaries</p>
            </div>
          </div>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full h-10 px-3 pr-10 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Transcription uses a cloud speech-to-text provider configured in
            Settings → Transcription once available.
          </p>
        </div>

        <div className="w-full max-w-xs space-y-2">
          <Button
            onClick={handleContinue}
            disabled={saving}
            className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white"
          >
            Continue
          </Button>
          <Button
            onClick={handleSkip}
            disabled={saving}
            variant="ghost"
            className="w-full h-9 text-gray-500"
          >
            Skip for now
          </Button>
        </div>
      </div>
    </OnboardingContainer>
  );
}
