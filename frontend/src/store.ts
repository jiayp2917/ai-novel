import { create } from 'zustand';
import {
  createAnnotationSlice,
  createArtifactSlice,
  createDocumentSlice,
  createNavigationSlice,
  createTaskFeedbackSlice,
  createUiSlice,
} from './storeSlices';
import type { WorkbenchState } from './storeTypes';

export const useWorkbenchStore = create<WorkbenchState>()((...args) => ({
  ...createNavigationSlice(...args),
  ...createDocumentSlice(...args),
  ...createAnnotationSlice(...args),
  ...createArtifactSlice(...args),
  ...createUiSlice(...args),
  ...createTaskFeedbackSlice(...args),
} as WorkbenchState));
