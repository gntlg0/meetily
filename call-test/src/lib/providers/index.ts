import 'server-only';

import type { Provider, ProviderName } from '@/lib/types';
import { chimegeProvider } from './chimege';
import { customProvider } from './custom';
import { scribeProvider } from './scribe';

const REGISTRY: Record<ProviderName, Provider> = {
  scribe: scribeProvider,
  chimege: chimegeProvider,
  custom: customProvider,
};

export function getProvider(name: string): Provider {
  const p = REGISTRY[name as ProviderName];
  if (!p) throw new Error(`Unknown transcription provider: ${name}`);
  return p;
}

export function isProviderName(name: string): name is ProviderName {
  return name in REGISTRY;
}
