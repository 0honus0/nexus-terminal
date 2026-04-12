import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import FileEditorOverlay from './FileEditorOverlay.vue';

const mockShowConfirmDialog = vi.fn();
const mockReloadGlobalTab = vi.fn();
const mockReloadTabInSession = vi.fn();

const popupTrigger = ref(0);
const popupFileInfo = ref<{ filePath: string; sessionId: string } | null>(null);
const activeTabId = ref('session-1:/tmp/demo.txt');

const showPopupFileEditorBoolean = ref(true);
const shareFileEditorTabsBoolean = ref(true);
const currentEditorFontSize = ref(14);
const currentEditorFontFamily = ref('monospace');

const tabState = {
  id: 'session-1:/tmp/demo.txt',
  sessionId: 'session-1',
  filePath: '/tmp/demo.txt',
  filename: 'demo.txt',
  content: 'old content',
  originalContent: 'old content',
  rawContentBase64: null,
  language: 'plaintext',
  selectedEncoding: 'utf-8',
  isLoading: false,
  loadingError: null as string | null,
  isSaving: false,
  saveStatus: 'idle',
  saveError: null as string | null,
  isModified: true,
  scrollTop: 0,
  scrollLeft: 0,
};

const fileEditorTabsMap = new Map([[tabState.id, tabState]]);

const mockFileEditorStore = {
  popupTrigger,
  popupFileInfo,
  activeTabId,
  tabs: fileEditorTabsMap,
  saveFile: vi.fn(),
  closeTab: vi.fn(),
  setActiveTab: vi.fn(),
  updateFileContent: vi.fn(),
  closeOtherTabs: vi.fn(),
  closeTabsToTheRight: vi.fn(),
  closeTabsToTheLeft: vi.fn(),
  changeEncoding: vi.fn(),
  reloadTab: mockReloadGlobalTab,
  updateTabScrollPosition: vi.fn(),
};

const mockSettingsStore = {
  showPopupFileEditorBoolean,
  shareFileEditorTabsBoolean,
};

const mockSessionStore = {
  sessions: new Map([['session-1', { connectionName: 'demo-conn' }]]),
  saveFileInSession: vi.fn(),
  closeEditorTabInSession: vi.fn(),
  setActiveEditorTabInSession: vi.fn(),
  updateFileContentInSession: vi.fn(),
  closeOtherTabsInSession: vi.fn(),
  closeTabsToTheRightInSession: vi.fn(),
  closeTabsToTheLeftInSession: vi.fn(),
  reloadTabInSession: mockReloadTabInSession,
  changeEncodingInSession: vi.fn(),
  updateTabScrollPositionInSession: vi.fn(),
};

const mockAppearanceStore = {
  currentEditorFontSize,
  currentEditorFontFamily,
  setEditorFontSize: vi.fn(),
};

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, args?: { filename?: string }) => {
      if (key === 'editor.unsavedChanges.message' && args?.filename) {
        return `文件 "${args.filename}" 有未保存的更改。确定要丢弃这些更改吗？`;
      }
      return key;
    },
  }),
}));

vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia');
  return {
    ...actual,
    storeToRefs: <T extends object>(store: T) => store,
  };
});

vi.mock('../stores/fileEditor.store', () => ({
  useFileEditorStore: () => mockFileEditorStore,
}));

vi.mock('../stores/settings.store', () => ({
  useSettingsStore: () => mockSettingsStore,
}));

vi.mock('../stores/session.store', () => ({
  useSessionStore: () => mockSessionStore,
}));

vi.mock('../stores/appearance.store', () => ({
  useAppearanceStore: () => mockAppearanceStore,
}));

vi.mock('../composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    showConfirmDialog: mockShowConfirmDialog,
  }),
}));

vi.mock('./MonacoEditor.vue', () => ({
  default: {
    name: 'MonacoEditor',
    template: '<div class="mock-monaco-editor"></div>',
    props: ['modelValue', 'language'],
  },
}));

vi.mock('./CodeMirrorMobileEditor.vue', () => ({
  default: {
    name: 'CodeMirrorMobileEditor',
    template: '<div class="mock-codemirror-editor"></div>',
    emits: ['request-save'],
  },
}));

vi.mock('./FileEditorTabs.vue', () => ({
  default: {
    name: 'FileEditorTabs',
    template: '<div class="mock-file-editor-tabs"></div>',
    props: ['tabs', 'activeTabId'],
  },
}));

const makeVisible = async () => {
  popupFileInfo.value = { filePath: '/tmp/demo.txt', sessionId: 'session-1' };
  popupTrigger.value += 1;
  await nextTick();
  await nextTick();
};

describe('FileEditorOverlay.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    showPopupFileEditorBoolean.value = true;
    shareFileEditorTabsBoolean.value = true;
    popupFileInfo.value = null;
    popupTrigger.value = 0;

    tabState.isModified = true;
    tabState.isLoading = false;
    tabState.isSaving = false;
    tabState.loadingError = null;
  });

  it('有未保存改动且用户取消时不应执行刷新', async () => {
    mockShowConfirmDialog.mockResolvedValue(false);
    const wrapper = mount(FileEditorOverlay);
    await makeVisible();

    await wrapper.find('.refresh-btn').trigger('click');

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    expect(mockReloadGlobalTab).not.toHaveBeenCalled();
  });

  it('有未保存改动且用户确认时应执行刷新', async () => {
    mockShowConfirmDialog.mockResolvedValue(true);
    const wrapper = mount(FileEditorOverlay);
    await makeVisible();

    await wrapper.find('.refresh-btn').trigger('click');
    await nextTick();

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    expect(mockReloadGlobalTab).toHaveBeenCalledWith(tabState.id);
  });
});
