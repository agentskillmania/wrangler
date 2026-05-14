import React from 'react';
import type { AskHumanHandler, ConfirmHandler } from '@agentskillmania/colts';

export interface InteractionCallbacks {
  askHuman: AskHumanHandler;
  confirm: ConfirmHandler;
}

export const InteractionContext = React.createContext<InteractionCallbacks | null>(null);

/**
 * Create interaction callbacks backed by stub promises.
 *
 * The resolve functions are stored externally so the App component
 * can wire them up to the Ink render lifecycle.
 */
export function createInteractionCallbacks(): InteractionCallbacks {
  return {
    askHuman: async () => '',
    confirm: async () => true,
  };
}
