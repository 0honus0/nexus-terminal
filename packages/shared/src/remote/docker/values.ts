export const DOCKER_ACTIONS = ['start', 'stop', 'restart', 'remove'] as const;

export type DockerAction = (typeof DOCKER_ACTIONS)[number];

export const DOCKER_MAX_IDENTIFIER_BYTES = 128;

export const DOCKER_MAX_CONTAINERS = 4096;
