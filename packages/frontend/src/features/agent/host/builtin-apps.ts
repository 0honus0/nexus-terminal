import type { Component } from 'vue';
import { OperationsAppView } from '../apps/operations/public';

const builtinAppViews: Readonly<Record<string, Component>> = {
  'nexus.operations': OperationsAppView,
};

export const builtinAppView = (appId: string): Component | null => builtinAppViews[appId] ?? null;
