export type LngLat = [number, number];

export interface PoiProperties {
  name: string;
  category: string;
  [key: string]: any;
}

export interface PoiFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: LngLat };
  properties: PoiProperties;
}

export interface PoiFeatureCollection {
  type: 'FeatureCollection';
  features: PoiFeature[];
}

export interface ImportSummary {
  imported: number;
  discarded: number;
  reasons: Record<string, number>;
}
