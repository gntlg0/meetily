import { useState, useEffect, useRef } from 'react';
import { useSidebar } from './Sidebar/SidebarProvider';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfig } from '@/contexts/ConfigContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Lock, Unlock, Eye, EyeOff, RefreshCw, CheckCircle2, ChevronDown, ChevronUp, Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface ModelConfig {
  provider: 'groq' | 'claude' | 'openai' | 'openrouter' | 'custom-openai';
  model: string;
  whisperModel: string;
  apiKey?: string | null;
  /** @deprecated Local Ollama support has been removed; kept for backward compatibility with stored configs. */
  ollamaEndpoint?: string | null;
  // Custom OpenAI fields
  customOpenAIEndpoint?: string | null;
  customOpenAIModel?: string | null;
  customOpenAIApiKey?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
}

interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  prompt_price?: string;
  completion_price?: string;
}

interface OpenAIModel {
  id: string;
}

interface AnthropicModel {
  id: string;
  display_name?: string;
}

interface GroqModel {
  id: string;
  owned_by?: string;
}

// Fallback models for when API fetch fails or no API key provided
const OPENAI_FALLBACK_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
  'o1',
  'o1-mini',
  'o3',
  'o3-mini',
];

const CLAUDE_FALLBACK_MODELS = [
  'claude-sonnet-5',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-5-20251101',
  'claude-3-5-sonnet-latest',
];

const GROQ_FALLBACK_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];

interface ModelSettingsModalProps {
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSave: (config: ModelConfig) => void;
  skipInitialFetch?: boolean; // Optional: skip fetching config from backend if parent manages it
  layout?: 'inline' | 'dialog';
}

export function ModelSettingsModal({
  modelConfig: propsModelConfig,
  setModelConfig: propsSetModelConfig,
  onSave,
  skipInitialFetch = false,
  layout = 'inline',
}: ModelSettingsModalProps) {
  // Use ConfigContext if available, fallback to props for backward compatibility
  const configContext = useConfig();
  const modelConfig = configContext?.modelConfig || propsModelConfig;
  const setModelConfig = configContext?.setModelConfig || propsSetModelConfig;
  const providerApiKeys = configContext?.providerApiKeys;
  const updateProviderApiKey = configContext?.updateProviderApiKey;

  const [error, setError] = useState<string>('');
  const [apiKey, setApiKey] = useState<string | null>(modelConfig.apiKey || null);
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(!!modelConfig.apiKey?.trim());
  const [isLockButtonVibrating, setIsLockButtonVibrating] = useState<boolean>(false);
  const { serverAddress } = useSidebar();
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModel[]>([]);
  const [openRouterError, setOpenRouterError] = useState<string>('');
  const [isLoadingOpenRouter, setIsLoadingOpenRouter] = useState<boolean>(false);
  const hasLoadedInitialConfig = useRef<boolean>(false);
  const [autoGenerateEnabled, setAutoGenerateEnabled] = useState<boolean>(true); // Default to true

  // Custom OpenAI state
  const [customOpenAIEndpoint, setCustomOpenAIEndpoint] = useState<string>(modelConfig.customOpenAIEndpoint || '');
  const [customOpenAIModel, setCustomOpenAIModel] = useState<string>(modelConfig.customOpenAIModel || '');
  const [customOpenAIApiKey, setCustomOpenAIApiKey] = useState<string>(modelConfig.customOpenAIApiKey || '');
  const [customMaxTokens, setCustomMaxTokens] = useState<string>(modelConfig.maxTokens?.toString() || '');
  const [customTemperature, setCustomTemperature] = useState<string>(modelConfig.temperature?.toString() || '');
  const [customTopP, setCustomTopP] = useState<string>(modelConfig.topP?.toString() || '');
  const [isCustomOpenAIAdvancedOpen, setIsCustomOpenAIAdvancedOpen] = useState<boolean>(false);
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);

  // Combobox state
  const [modelComboboxOpen, setModelComboboxOpen] = useState<boolean>(false);

  // Dynamic model fetching state for OpenAI, Claude, and Groq
  const [openaiModels, setOpenaiModels] = useState<string[]>([]);
  const [claudeModels, setClaudeModels] = useState<string[]>([]);
  const [groqModels, setGroqModels] = useState<string[]>([]);
  const [isLoadingOpenAI, setIsLoadingOpenAI] = useState<boolean>(false);
  const [isLoadingClaude, setIsLoadingClaude] = useState<boolean>(false);
  const [isLoadingGroq, setIsLoadingGroq] = useState<boolean>(false);

  const fetchApiKey = async (provider: string) => {
    try {
      const data = (await invoke('api_get_api_key', {
        provider,
      })) as string;
      setApiKey(data || '');
    } catch (err) {
      console.error('Error fetching API key:', err);
      setApiKey(null);
    }
  };

  // Auto-unlock when API key becomes empty, 
  useEffect(() => {
    const hasContent = !!apiKey?.trim();
    if (!hasContent) {
      setIsApiKeyLocked(false);
    }
  }, [apiKey]);

  const modelOptions: Record<string, string[]> = {
    claude: claudeModels.length > 0 ? claudeModels : CLAUDE_FALLBACK_MODELS,
    groq: groqModels.length > 0 ? groqModels : GROQ_FALLBACK_MODELS,
    openai: openaiModels.length > 0 ? openaiModels : OPENAI_FALLBACK_MODELS,
    openrouter: openRouterModels.map((m) => m.id),
    'custom-openai': customOpenAIModel ? [customOpenAIModel] : [], // User specifies model manually
  };

  const requiresApiKey =
    modelConfig.provider === 'claude' ||
    modelConfig.provider === 'groq' ||
    modelConfig.provider === 'openai' ||
    modelConfig.provider === 'openrouter';

  // Custom OpenAI validation
  const isCustomOpenAIInvalid = modelConfig.provider === 'custom-openai' && (
    !customOpenAIEndpoint.trim() ||
    !customOpenAIModel.trim()
  );

  const isDoneDisabled =
    (requiresApiKey && (!apiKey || (typeof apiKey === 'string' && !apiKey.trim()))) ||
    isCustomOpenAIInvalid;

  useEffect(() => {
    const fetchModelConfig = async () => {
      // If parent component manages config, skip fetch and just mark as loaded
      if (skipInitialFetch) {
        hasLoadedInitialConfig.current = true;
        return;
      }

      try {
        const data = (await invoke('api_get_model_config')) as any;
        if (data && data.provider !== null) {
          setModelConfig(data);

          // Fetch API key if not included in response
          if (!data.apiKey) {
            try {
              const apiKeyData = await invoke('api_get_api_key', {
                provider: data.provider
              }) as string;
              data.apiKey = apiKeyData;
              setApiKey(apiKeyData);
            } catch (err) {
              console.error('Failed to fetch API key:', err);
            }
          }

          hasLoadedInitialConfig.current = true; // Mark that initial config is loaded

          // Fetch Custom OpenAI config if that's the active provider
          if (data.provider === 'custom-openai') {
            try {
              const customConfig = (await invoke('api_get_custom_openai_config')) as any;
              if (customConfig) {
                setCustomOpenAIEndpoint(customConfig.endpoint || '');
                setCustomOpenAIModel(customConfig.model || '');
                setCustomOpenAIApiKey(customConfig.apiKey || '');
                setCustomMaxTokens(customConfig.maxTokens?.toString() || '');
                setCustomTemperature(customConfig.temperature?.toString() || '');
                setCustomTopP(customConfig.topP?.toString() || '');
              }
            } catch (err) {
              console.error('Failed to fetch custom OpenAI config:', err);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch model config:', error);
        hasLoadedInitialConfig.current = true; // Mark as loaded even on error
      }
    };

    fetchModelConfig();
  }, [skipInitialFetch]);

  // Fetch auto-generate setting on mount
  useEffect(() => {
    const fetchAutoGenerateSetting = async () => {
      try {
        const enabled = (await invoke('api_get_auto_generate_setting')) as boolean;
        setAutoGenerateEnabled(enabled);
        console.log('Auto-generate setting loaded:', enabled);
      } catch (err) {
        console.error('Failed to fetch auto-generate setting:', err);
        // Keep default value (true) on error
      }
    };

    fetchAutoGenerateSetting();
  }, []);

  // Sync custom OpenAI state from modelConfig (context or props)
  useEffect(() => {
    if (modelConfig.provider === 'custom-openai') {
      console.log('Syncing custom OpenAI fields from ConfigContext:', {
        endpoint: modelConfig.customOpenAIEndpoint,
        model: modelConfig.customOpenAIModel,
        hasApiKey: !!modelConfig.customOpenAIApiKey,
      });

      // Always sync from modelConfig (which comes from context if available)
      setCustomOpenAIEndpoint(modelConfig.customOpenAIEndpoint || '');
      setCustomOpenAIModel(modelConfig.customOpenAIModel || '');
      setCustomOpenAIApiKey(modelConfig.customOpenAIApiKey || '');
      setCustomMaxTokens(modelConfig.maxTokens?.toString() || '');
      setCustomTemperature(modelConfig.temperature?.toString() || '');
      setCustomTopP(modelConfig.topP?.toString() || '');
    }
  }, [
    modelConfig.provider,
    modelConfig.customOpenAIEndpoint,
    modelConfig.customOpenAIModel,
    modelConfig.customOpenAIApiKey,
    modelConfig.maxTokens,
    modelConfig.temperature,
    modelConfig.topP
  ]);

  // Sync local apiKey state when provider changes
  useEffect(() => {
    if (providerApiKeys && requiresApiKey && modelConfig.provider !== 'custom-openai') {
      const correctKey = providerApiKeys[modelConfig.provider as keyof typeof providerApiKeys];
      if (correctKey !== apiKey) {
        setApiKey(correctKey || '');
        setIsApiKeyLocked(!!correctKey?.trim());
      }
    }
  }, [modelConfig.provider, providerApiKeys, requiresApiKey]);

  const loadOpenRouterModels = async () => {
    if (openRouterModels.length > 0) return; // Already loaded

    try {
      setIsLoadingOpenRouter(true);
      setOpenRouterError('');
      const data = (await invoke('get_openrouter_models')) as OpenRouterModel[];
      setOpenRouterModels(data);
    } catch (err) {
      console.error('Error loading OpenRouter models:', err);
      setOpenRouterError(
        err instanceof Error ? err.message : 'Failed to load OpenRouter models'
      );
    } finally {
      setIsLoadingOpenRouter(false);
    }
  };

  // Fetch OpenAI models from API
  const loadOpenAIModels = async (key: string | null) => {
    if (!key?.trim()) {
      setOpenaiModels([]); // Will use fallback via modelOptions
      return;
    }
    setIsLoadingOpenAI(true);
    try {
      const data = (await invoke('get_openai_models', { apiKey: key })) as OpenAIModel[];
      setOpenaiModels(data.map((m) => m.id));
    } catch (err) {
      console.error('Error loading OpenAI models:', err);
      setOpenaiModels([]); // Will use fallback via modelOptions
    } finally {
      setIsLoadingOpenAI(false);
    }
  };

  // Fetch Anthropic (Claude) models from API
  const loadClaudeModels = async (key: string | null) => {
    if (!key?.trim()) {
      setClaudeModels([]); // Will use fallback via modelOptions
      return;
    }
    setIsLoadingClaude(true);
    try {
      const data = (await invoke('get_anthropic_models', { apiKey: key })) as AnthropicModel[];
      setClaudeModels(data.map((m) => m.id));
    } catch (err) {
      console.error('Error loading Claude models:', err);
      setClaudeModels([]); // Will use fallback via modelOptions
    } finally {
      setIsLoadingClaude(false);
    }
  };

  // Fetch Groq models from API
  const loadGroqModels = async (key: string | null) => {
    if (!key?.trim()) {
      setGroqModels([]); // Will use fallback via modelOptions
      return;
    }
    setIsLoadingGroq(true);
    try {
      const data = (await invoke('get_groq_models', { apiKey: key })) as GroqModel[];
      setGroqModels(data.map((m) => m.id));
    } catch (err) {
      console.error('Error loading Groq models:', err);
      setGroqModels([]); // Will use fallback via modelOptions
    } finally {
      setIsLoadingGroq(false);
    }
  };

  // Auto-fetch OpenAI models when provider is openai and we have an API key
  useEffect(() => {
    if (modelConfig.provider === 'openai' && apiKey?.trim()) {
      loadOpenAIModels(apiKey);
    }
  }, [modelConfig.provider, apiKey]);

  // Auto-fetch Claude models when provider is claude and we have an API key
  useEffect(() => {
    if (modelConfig.provider === 'claude' && apiKey?.trim()) {
      loadClaudeModels(apiKey);
    }
  }, [modelConfig.provider, apiKey]);

  // Auto-fetch Groq models when provider is groq and we have an API key
  useEffect(() => {
    if (modelConfig.provider === 'groq' && apiKey?.trim()) {
      loadGroqModels(apiKey);
    }
  }, [modelConfig.provider, apiKey]);

  // Restore cached model when async model lists become available
  useEffect(() => {
    const providerModels = modelOptions[modelConfig.provider];
    if (!providerModels || providerModels.length === 0) return;

    // If current model is already valid, nothing to do
    if (modelConfig.model && providerModels.includes(modelConfig.model)) return;

    // Try to restore from localStorage cache
    const map = JSON.parse(localStorage.getItem('providerModelMap') || '{}');
    const cachedModel = map[modelConfig.provider];
    if (cachedModel && providerModels.includes(cachedModel)) {
      setModelConfig((prev: ModelConfig) => ({ ...prev, model: cachedModel }));
    }
  }, [openRouterModels, openaiModels, claudeModels, groqModels, modelConfig.provider]);

  const handleSave = async () => {
    // For custom-openai provider, save the custom config first
    if (modelConfig.provider === 'custom-openai') {
      try {
        await invoke('api_save_custom_openai_config', {
          endpoint: customOpenAIEndpoint.trim(),
          apiKey: customOpenAIApiKey.trim() || null,
          model: customOpenAIModel.trim(),
          maxTokens: customMaxTokens ? parseInt(customMaxTokens, 10) : null,
          temperature: customTemperature ? parseFloat(customTemperature) : null,
          topP: customTopP ? parseFloat(customTopP) : null,
        });
        console.log('Custom OpenAI config saved successfully');
      } catch (err) {
        console.error('Failed to save custom OpenAI config:', err);
        toast.error('Failed to save custom OpenAI configuration');
        return;
      }
    }

    const updatedConfig = {
      ...modelConfig,
      apiKey: typeof apiKey === 'string' ? apiKey.trim() || null : null,
      ollamaEndpoint: null,
      // Include custom OpenAI fields
      customOpenAIEndpoint: modelConfig.provider === 'custom-openai' ? customOpenAIEndpoint.trim() : null,
      customOpenAIModel: modelConfig.provider === 'custom-openai' ? customOpenAIModel.trim() : null,
      customOpenAIApiKey: modelConfig.provider === 'custom-openai' && customOpenAIApiKey.trim() ? customOpenAIApiKey.trim() : null,
      maxTokens: modelConfig.provider === 'custom-openai' && customMaxTokens ? parseInt(customMaxTokens, 10) : null,
      temperature: modelConfig.provider === 'custom-openai' && customTemperature ? parseFloat(customTemperature) : null,
      topP: modelConfig.provider === 'custom-openai' && customTopP ? parseFloat(customTopP) : null,
      // For custom-openai, use the customOpenAIModel as the model field
      model: modelConfig.provider === 'custom-openai' ? customOpenAIModel.trim() : modelConfig.model,
    };
    setModelConfig(updatedConfig);
    console.log('ModelSettingsModal - handleSave - Updated ModelConfig:', updatedConfig);

    // Persist confirmed model choice to per-provider cache
    if (updatedConfig.model) {
      const map = JSON.parse(localStorage.getItem('providerModelMap') || '{}');
      map[updatedConfig.provider] = updatedConfig.model;
      localStorage.setItem('providerModelMap', JSON.stringify(map));
    }

    // Update provider-specific key in context
    if (updateProviderApiKey && updatedConfig.apiKey && updatedConfig.provider !== 'custom-openai') {
      updateProviderApiKey(updatedConfig.provider, updatedConfig.apiKey);
    }

    onSave(updatedConfig);
  };

  // Test custom OpenAI connection
  const testCustomOpenAIConnection = async () => {
    if (!customOpenAIEndpoint.trim() || !customOpenAIModel.trim()) {
      toast.error('Please enter endpoint URL and model name first');
      return;
    }

    setIsTestingConnection(true);
    try {
      const result = await invoke<{ status: string; message: string }>('api_test_custom_openai_connection', {
        endpoint: customOpenAIEndpoint.trim(),
        apiKey: customOpenAIApiKey.trim() || null,
        model: customOpenAIModel.trim(),
      });
      toast.success(result.message || 'Connection successful!');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      toast.error(errorMsg);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleInputClick = () => {
    if (isApiKeyLocked) {
      setIsLockButtonVibrating(true);
      setTimeout(() => setIsLockButtonVibrating(false), 500);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Model Settings</h3>
      </div>

      <div className="space-y-4">
        <div>
          <Label>Summarization Model</Label>
          <div className="flex space-x-2 mt-1">
            <Select
              value={modelConfig.provider}
              onValueChange={(value) => {
                const provider = value as ModelConfig['provider'];

                // Clear error state when switching providers
                setError('');

                // Save current provider's model to localStorage before switching
                const map = JSON.parse(localStorage.getItem('providerModelMap') || '{}');
                if (modelConfig.model) {
                  map[modelConfig.provider] = modelConfig.model;
                  localStorage.setItem('providerModelMap', JSON.stringify(map));
                }

                // Try to restore cached model for the new provider
                const savedModel = map[provider];
                const providerModels = modelOptions[provider];
                const defaultModel = providerModels && providerModels.length > 0
                  ? providerModels[0]
                  : '';
                const model = (savedModel && providerModels?.includes(savedModel))
                  ? savedModel
                  : defaultModel;

                setModelConfig({
                  ...modelConfig,
                  provider,
                  model,
                });
                // API key is now synced automatically via useEffect watching providerApiKeys

                // Load OpenRouter models only when OpenRouter is selected
                if (provider === 'openrouter') {
                  loadOpenRouterModels();
                }

                // Load custom OpenAI config when selected
                if (provider === 'custom-openai') {
                  invoke<any>('api_get_custom_openai_config').then((config) => {
                    if (config) {
                      setCustomOpenAIEndpoint(config.endpoint || '');
                      setCustomOpenAIModel(config.model || '');
                      setCustomOpenAIApiKey(config.apiKey || '');
                      setCustomMaxTokens(config.maxTokens?.toString() || '');
                      setCustomTemperature(config.temperature?.toString() || '');
                      setCustomTopP(config.topP?.toString() || '');
                    }
                  }).catch((err) => {
                    console.error('Failed to load custom OpenAI config:', err);
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent className="max-h-64 overflow-y-auto">
                <SelectItem value="claude">Claude</SelectItem>
                <SelectItem value="custom-openai">Custom Server (OpenAI)</SelectItem>
                <SelectItem value="groq">Groq</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
              </SelectContent>
            </Select>

            {modelConfig.provider !== 'custom-openai' && (
              <Popover open={modelComboboxOpen} onOpenChange={setModelComboboxOpen} modal={true}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={modelComboboxOpen}
                    className="flex-1 max-w-[200px] justify-between font-normal"
                  >
                    <span className="truncate">
                      {modelConfig.model || "Select model..."}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[250px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search models..." />
                    <CommandList className="max-h-[300px]">
                      {(modelConfig.provider === 'openrouter' && isLoadingOpenRouter) ||
                       (modelConfig.provider === 'openai' && isLoadingOpenAI) ||
                       (modelConfig.provider === 'claude' && isLoadingClaude) ||
                       (modelConfig.provider === 'groq' && isLoadingGroq) ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          <RefreshCw className="mx-auto h-4 w-4 animate-spin mb-2" />
                          Loading models...
                        </div>
                      ) : (
                        <>
                          <CommandEmpty>No models found.</CommandEmpty>
                          <CommandGroup>
                            {modelOptions[modelConfig.provider]?.map((model) => (
                              <CommandItem
                                key={model}
                                value={model}
                                onSelect={(currentValue) => {
                                  setModelConfig((prev: ModelConfig) => ({ ...prev, model: currentValue }));
                                  setModelComboboxOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    modelConfig.model === model ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <span className="truncate">{model}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>

        {/* Custom OpenAI Configuration Section */}
        {modelConfig.provider === 'custom-openai' && (
          <div className="space-y-4 border-t pt-4">
            <div>
              <Label htmlFor="custom-endpoint">Endpoint URL *</Label>
              <Input
                id="custom-endpoint"
                value={customOpenAIEndpoint}
                onChange={(e) => setCustomOpenAIEndpoint(e.target.value)}
                placeholder="http://localhost:8000/v1"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Base URL of the OpenAI-compatible API
              </p>
            </div>

            <div>
              <Label htmlFor="custom-model">Model Name *</Label>
              <Input
                id="custom-model"
                value={customOpenAIModel}
                onChange={(e) => setCustomOpenAIModel(e.target.value)}
                placeholder="gpt-4, llama-3-70b, etc."
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Model identifier to use for requests
              </p>
            </div>

            <div>
              <Label htmlFor="custom-api-key">API Key (optional)</Label>
              <Input
                id="custom-api-key"
                type="password"
                value={customOpenAIApiKey}
                onChange={(e) => setCustomOpenAIApiKey(e.target.value)}
                placeholder="Leave empty if not required"
                className="mt-1"
              />
            </div>

            {/* Advanced Options (Collapsible) */}
            <div>
              <div
                className="flex items-center justify-between cursor-pointer py-2"
                onClick={() => setIsCustomOpenAIAdvancedOpen(!isCustomOpenAIAdvancedOpen)}
              >
                <Label className="cursor-pointer">Advanced Options</Label>
                {isCustomOpenAIAdvancedOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {isCustomOpenAIAdvancedOpen && (
                <div className="space-y-3 pl-2 border-l-2 border-muted mt-2">
                  <div>
                    <Label htmlFor="custom-max-tokens">Max Tokens</Label>
                    <Input
                      id="custom-max-tokens"
                      type="number"
                      value={customMaxTokens}
                      onChange={(e) => setCustomMaxTokens(e.target.value)}
                      placeholder="e.g., 4096"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="custom-temperature">Temperature (0.0-2.0)</Label>
                    <Input
                      id="custom-temperature"
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={customTemperature}
                      onChange={(e) => setCustomTemperature(e.target.value)}
                      placeholder="e.g., 0.7"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="custom-top-p">Top P (0.0-1.0)</Label>
                    <Input
                      id="custom-top-p"
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={customTopP}
                      onChange={(e) => setCustomTopP(e.target.value)}
                      placeholder="e.g., 0.9"
                      className="mt-1"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Test Connection Button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={testCustomOpenAIConnection}
              disabled={isTestingConnection || !customOpenAIEndpoint.trim() || !customOpenAIModel.trim()}
              className="w-full"
            >
              {isTestingConnection ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Testing Connection...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Test Connection
                </>
              )}
            </Button>
          </div>
        )}

        {requiresApiKey && (
          <div>
            <Label>API Key</Label>
            <div className="relative mt-1">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey || ''}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={isApiKeyLocked}
                placeholder="Enter your API key"
                className="pr-24"
              />
              {isApiKeyLocked && apiKey?.trim() && (
                <div
                  onClick={handleInputClick}
                  className="absolute inset-0 flex items-center justify-center bg-muted/50 rounded-md cursor-not-allowed"
                />
              )}
              <div className="absolute inset-y-0 right-0 pr-1 flex items-center space-x-1">
                {apiKey?.trim() && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
                    className={isLockButtonVibrating ? 'animate-vibrate text-red-500' : ''}
                    title={isApiKeyLocked ? 'Unlock to edit' : 'Lock to prevent editing'}
                  >
                    {isApiKeyLocked ? <Lock /> : <Unlock />}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Auto-generate summaries toggle */}
      {/* <div className="mt-6 pt-6 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <Label htmlFor="auto-generate" className="text-base font-medium">
              Auto-generate summaries
            </Label>
            <p className="text-sm text-muted-foreground mt-1">
              Automatically generate summary when opening meetings without one
            </p>
          </div>
          <Switch
            id="auto-generate"
            checked={autoGenerateEnabled}
            onCheckedChange={setAutoGenerateEnabled}
          />
        </div>
      </div> */}

      <div className="mt-6 flex justify-end">
        <Button
          className={cn(
            'px-4 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500',
            isDoneDisabled ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
          )}
          onClick={handleSave}
          disabled={isDoneDisabled}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
