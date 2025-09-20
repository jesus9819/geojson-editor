import { Injectable } from '@angular/core';
import { PoiFeature, PoiFeatureCollection, ImportSummary, LngLat } from '../models/geojson';

@Injectable({ providedIn: 'root' })
export class GeoJsonService {
  private inRange([lon, lat]: LngLat): boolean {
    return lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
  }
  private isString(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0;
  }

  validateFeature(raw: any): PoiFeature | { reason: string } {
    if (!raw || raw.type !== 'Feature') return { reason: 'not_feature' };
    if (!raw.geometry || raw.geometry.type !== 'Point') return { reason: 'not_point' };
    if (!Array.isArray(raw.geometry.coordinates)) return { reason: 'missing_coords' };

    const coords = raw.geometry.coordinates as LngLat;
    if (!this.inRange(coords)) return { reason: 'invalid_coords' };

    const props = raw.properties;
    if (!props) return { reason: 'missing_properties' };
    if (!this.isString(props.name)) return { reason: 'missing_name' };
    if (!this.isString(props.category)) return { reason: 'missing_category' };

    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: { ...props },
    };
  }

  parseImport(text: string): { fc: PoiFeatureCollection; summary: ImportSummary } {
    const json = JSON.parse(text);
    if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
      throw new Error('Input must be a FeatureCollection with Point features.');
    }

    const reasons: Record<string, number> = {};
    const valids: PoiFeature[] = [];

    for (const f of json.features) {
      const res = this.validateFeature(f);
      if ('type' in (res as any)) {
        valids.push(res as PoiFeature);
      } else {
        const r = (res as any).reason ?? 'unknown';
        reasons[r] = (reasons[r] ?? 0) + 1;
      }
    }

    return {
      fc: { type: 'FeatureCollection', features: valids },
      summary: { imported: valids.length, discarded: json.features.length - valids.length, reasons },
    };
  }

  toBlob(fc: PoiFeatureCollection): Blob {
    return new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
  }
}
