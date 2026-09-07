export async function disposeWorkspaceRuntime(): Promise<void> {
  try {
    const { workspaceRuntimeRegistry } = await import('@/runtimes/workspace/public');
    workspaceRuntimeRegistry.disposeAll();
  } catch {
    // Logout/auth transitions must continue even if a stale runtime chunk cannot load.
  }
}
