import type { ModelRef } from '../../ai/model.types';
import type { RunDefinitionSnapshot, RunModelRouteSnapshot } from './run.types';

export const sameModelRef = (left: ModelRef, right: ModelRef): boolean =>
  left.providerId === right.providerId &&
  left.modelId === right.modelId &&
  left.configurationVersion === right.configurationVersion;

export const runModelRoutes = (definition: RunDefinitionSnapshot): RunModelRouteSnapshot[] => {
  return [
    { model: definition.model, ...(definition.modelCapabilities ? { modelCapabilities: definition.modelCapabilities } : {}) },
    ...(definition.rootModelRoutes ?? []),
  ];
};

export const runModelRouteIndex = (definition: RunDefinitionSnapshot, model: ModelRef): number =>
  runModelRoutes(definition).findIndex((route) => sameModelRef(route.model, model));
