import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Eye, EyeOff, Lock, Unlock, CloudCog } from 'lucide-react';
import { toast } from 'sonner';

// API-only build: transcription always goes through a cloud ASR provider.
// Local Whisper / Parakeet have been removed.
export interface TranscriptModelProps {
    provider: 'deepgram' | 'elevenLabs' | 'groq' | 'openai';
    model: string;
    apiKey?: string | null;
}

export interface TranscriptSettingsProps {
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onModelSelect?: () => void;
}

const MODEL_OPTIONS: Record<TranscriptModelProps['provider'], string[]> = {
    deepgram: ['nova-2-phonecall'],
    elevenLabs: ['scribe_v1'],
    groq: ['whisper-large-v3'],
    openai: ['gpt-4o-transcribe', 'whisper-1'],
};

export function TranscriptSettings({ transcriptModelConfig, setTranscriptModelConfig, onModelSelect }: TranscriptSettingsProps) {
    const [apiKey, setApiKey] = useState<string | null>(transcriptModelConfig.apiKey || null);
    const [showApiKey, setShowApiKey] = useState<boolean>(false);
    const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(true);
    const [isLockButtonVibrating, setIsLockButtonVibrating] = useState<boolean>(false);
    const [uiProvider, setUiProvider] = useState<TranscriptModelProps['provider']>(transcriptModelConfig.provider);
    const [saving, setSaving] = useState(false);

    // Sync uiProvider when backend config changes (e.g., after initial load)
    useEffect(() => {
        setUiProvider(transcriptModelConfig.provider);
    }, [transcriptModelConfig.provider]);

    const fetchApiKey = async (provider: string) => {
        try {
            const data = await invoke('api_get_transcript_api_key', { provider }) as string;
            setApiKey(data || '');
        } catch (err) {
            console.error('Error fetching API key:', err);
            setApiKey(null);
        }
    };

    const handleInputClick = () => {
        if (isApiKeyLocked) {
            setIsLockButtonVibrating(true);
            setTimeout(() => setIsLockButtonVibrating(false), 500);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const model = transcriptModelConfig.provider === uiProvider && transcriptModelConfig.model
                ? transcriptModelConfig.model
                : MODEL_OPTIONS[uiProvider][0];
            await invoke('api_save_transcript_config', {
                provider: uiProvider,
                model,
                apiKey: apiKey || null,
                authToken: null,
            });
            setTranscriptModelConfig({ provider: uiProvider, model, apiKey });
            toast.success('Transcription settings saved');
            onModelSelect?.();
        } catch (err) {
            console.error('Failed to save transcript settings:', err);
            toast.error('Failed to save transcription settings', {
                description: err instanceof Error ? err.message : String(err),
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div>
                <div className="space-y-4 pb-6">
                    <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                        <CloudCog className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <p>
                            Transcription runs through the cloud speech-to-text provider
                            selected below. An API key for the selected provider is
                            required — audio is sent to that provider during recording
                            and import.
                        </p>
                    </div>

                    <div>
                        <Label className="block text-sm font-medium text-gray-700 mb-1">
                            Transcription Provider
                        </Label>
                        <div className="flex space-x-2 mx-1">
                            <Select
                                value={uiProvider}
                                onValueChange={(value) => {
                                    const provider = value as TranscriptModelProps['provider'];
                                    setUiProvider(provider);
                                    fetchApiKey(provider);
                                }}
                            >
                                <SelectTrigger className='focus:ring-1 focus:ring-blue-500 focus:border-blue-500'>
                                    <SelectValue placeholder="Select provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="elevenLabs">☁️ ElevenLabs (Scribe)</SelectItem>
                                    <SelectItem value="deepgram">☁️ Deepgram</SelectItem>
                                    <SelectItem value="groq">☁️ Groq (Whisper API)</SelectItem>
                                    <SelectItem value="openai">☁️ OpenAI</SelectItem>
                                </SelectContent>
                            </Select>

                            <Select
                                value={transcriptModelConfig.provider === uiProvider ? transcriptModelConfig.model : MODEL_OPTIONS[uiProvider][0]}
                                onValueChange={(value) => {
                                    setTranscriptModelConfig({ ...transcriptModelConfig, provider: uiProvider, model: value });
                                }}
                            >
                                <SelectTrigger className='focus:ring-1 focus:ring-blue-500 focus:border-blue-500'>
                                    <SelectValue placeholder="Select model" />
                                </SelectTrigger>
                                <SelectContent>
                                    {MODEL_OPTIONS[uiProvider].map((model) => (
                                        <SelectItem key={model} value={model}>{model}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div>
                        <Label className="block text-sm font-medium text-gray-700 mb-1">
                            API Key
                        </Label>
                        <div className="relative mx-1">
                            <Input
                                type={showApiKey ? "text" : "password"}
                                className={`pr-24 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${isApiKeyLocked ? 'bg-gray-100 cursor-not-allowed' : ''
                                    }`}
                                value={apiKey || ''}
                                onChange={(e) => setApiKey(e.target.value)}
                                disabled={isApiKeyLocked}
                                onClick={handleInputClick}
                                placeholder="Enter your API key"
                            />
                            {isApiKeyLocked && (
                                <div
                                    onClick={handleInputClick}
                                    className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-50 rounded-md cursor-not-allowed"
                                />
                            )}
                            <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
                                    className={`transition-colors duration-200 ${isLockButtonVibrating ? 'animate-vibrate text-red-500' : ''
                                        }`}
                                    title={isApiKeyLocked ? "Unlock to edit" : "Lock to prevent editing"}
                                >
                                    {isApiKeyLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                >
                                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end mx-1">
                        <Button onClick={handleSave} disabled={saving} className="bg-gray-900 hover:bg-gray-800 text-white">
                            {saving ? 'Saving…' : 'Save'}
                        </Button>
                    </div>
                </div>
            </div>
        </div >
    )
}
