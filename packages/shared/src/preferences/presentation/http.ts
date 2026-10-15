import type {
	PresentationPreferences,
	PresentationLayout,
	PresentationFocus,
	PresentationSidebar,
	PresentationView,
} from './model.js';
import type { PresentationErrorCode } from './values.js';

export interface PreferencesUpdateRequest {
	expectedVersion: number;
	preferences: PresentationPreferences;
}

export interface LayoutUpdateRequest {
	expectedVersion: number;
	layout: PresentationLayout;
}

export interface FocusUpdateRequest {
	expectedVersion: number;
	focus: PresentationFocus;
}

export interface SidebarUpdateRequest {
	expectedVersion: number;
	sidebar: PresentationSidebar;
}

export interface WorkspaceLayoutUpdateRequest {
	expectedVersion: number;
	layout: PresentationLayout;
	sidebar: PresentationSidebar;
}

export interface PreferencesResponse {
	version: number;
	preferences: PresentationPreferences;
}

export interface LayoutResponse {
	version: number;
	layout: PresentationLayout;
}

export interface FocusResponse {
	version: number;
	focus: PresentationFocus;
}

export interface SidebarResponse {
	version: number;
	sidebar: PresentationSidebar;
}

export type PresentationUpdateResponse = PresentationView;

export interface PresentationErrorResponse {
	code: PresentationErrorCode;
}
