import { Injectable, computed, signal } from '@angular/core';
import { PoiFeature, PoiFeatureCollection, ImportSummary } from '../models/geojson';

const LS_KEY = 'poi_editor_state';

@Injectable({ providedIn: 'root' })
export class EditorStore {
  private _features = signal<PoiFeature[]>([]);
  private _selectedIdx = signal<number | null>(null);
  private _importSummary = signal<ImportSummary | null>(null);

  features = computed(() => this._features());
  selected = computed(() => {
    const i = this._selectedIdx();
    return i === null ? null : this._features()[i] ?? null;
  });
  importSummary = computed(() => this._importSummary());

  loadFromLocalStorage(): void {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    try {
      const fc = JSON.parse(raw) as PoiFeatureCollection;
      if (fc?.type === 'FeatureCollection' && Array.isArray(fc.features)) {
        this._features.set(fc.features);
      }
    } catch {}
  }

  saveToLocalStorage(): void {
    const fc: PoiFeatureCollection = { type: 'FeatureCollection', features: this._features() };
    localStorage.setItem(LS_KEY, JSON.stringify(fc));
  }

  clear(): void {
    this._features.set([]);
    this._selectedIdx.set(null);
    this._importSummary.set(null);
    localStorage.removeItem(LS_KEY);
  }

  setFromImport(fc: PoiFeatureCollection, summary: ImportSummary): void {
    this._features.set(fc.features);
    this._importSummary.set(summary);
    this._selectedIdx.set(null);
  }

  addFeature(f: PoiFeature): void {
    this._features.update(arr => [...arr, f]);
  }

  selectByIdx(i: number | null): void {
    this._selectedIdx.set(i);
  }

  updateSelected(partial: Partial<PoiFeature['properties']>): void {
    const i = this._selectedIdx();
    if (i === null) return;
    this._features.update(arr => {
      const next = [...arr];
      next[i] = { ...next[i], properties: { ...next[i].properties, ...partial } };
      return next;
    });
  }

  deleteSelected(): void {
    const i = this._selectedIdx();
    if (i === null) return;
    this._features.update(arr => arr.filter((_, idx) => idx !== i));
    this._selectedIdx.set(null);
  }

  asCollection(): PoiFeatureCollection {
    return { type: 'FeatureCollection', features: this._features() };
  }
}
