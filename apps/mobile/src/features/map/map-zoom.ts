import { create } from 'zustand';

import { INITIAL_VIEW } from './style';

/** The map's zoom as last settled (clusters depend on it, cluster.ts). */
export const useMapZoom = create<{ zoom: number }>(() => ({ zoom: INITIAL_VIEW.zoom }));
