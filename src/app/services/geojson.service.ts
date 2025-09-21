// src/app/services/geojson.service.ts
import { Injectable } from '@angular/core';
import { PoiFeature, PoiFeatureCollection, ImportSummary, LngLat } from '../models/geojson';

export interface ParseImportResult {
  fc: PoiFeatureCollection;          // SOLO válidos (los que sí se pintan)
  invalidFc: PoiFeatureCollection;   // inválidos con coords (para reporte si quisieras)
  summary: ImportSummary;            // conteo importadas/descartadas + razones
}

@Injectable({ providedIn: 'root' })
export class GeoJsonService {
  // --- utils ---
  private isLon(v: any): v is number { return typeof v === 'number' && v >= -180 && v <= 180; }
  private isLat(v: any): v is number { return typeof v === 'number' && v >= -90 && v <= 90; }
  private isNum(v: any): v is number { return typeof v === 'number' && isFinite(v); }
  private isString(v: unknown): v is string { return typeof v === 'string' && v.trim().length > 0; }

  /** Intenta extraer coords en [lon,lat] SIN validar rangos */
  private tryGetCoords(raw: any): LngLat | null {
    if (!Array.isArray(raw) || raw.length < 2) return null;
    const [a, b] = raw;
    if (!this.isNum(a) || !this.isNum(b)) return null;
    // heurística: si a parece lon y b lat, respétalo; si no, invierte
    if ((this.isLon(a) && this.isLat(b)) || (!this.isLat(a) && !this.isLon(b))) {
      return [a, b];
    }
    return [b, a];
  }

  /** Coords válidas en rango y formato */
  private normalizeCoordsStrict(raw: any): LngLat | null {
    const c = this.tryGetCoords(raw);
    if (!c) return null;
    const [lon, lat] = c;
    return this.isLon(lon) && this.isLat(lat) ? c : null;
  }

  /**
   * Valida un feature de forma ESTRICTA:
   * - Debe ser Feature con geometry Point
   * - Debe tener coordinates válidas en rango
   * - Debe tener properties con name y category como strings no vacíos
   */
  private validateFeatureStrict(raw: any):
    | PoiFeature
    | { reason: string } {
    if (!raw || raw.type !== 'Feature') return { reason: 'not_feature' };

    const g = raw.geometry;
    if (!g || g.type !== 'Point') return { reason: 'not_point' };

    const coords = this.normalizeCoordsStrict(g.coordinates);
    if (!coords) return { reason: 'invalid_coords' };

    const props = raw.properties;
    if (!props || typeof props !== 'object') return { reason: 'missing_properties' };

    if (!this.isString(props.name)) return { reason: 'missing_name' };
    if (!this.isString(props.category)) return { reason: 'missing_category' };

    // si además quieres validar tipos extra, hazlo aquí

    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: { name: props.name.trim(), category: props.category.trim(), ...props },
    };
  }

  /**
   * Parsea el texto:
   *  - `fc.features` contiene SOLO válidos (lo que se pinta).
   *  - `invalidFc.features` contiene inválidos "dibujables" para un posible reporte (NO se pintan).
   *  - `summary` trae importadas/descartadas y conteo por razón.
   */
  parseImport(text: string): ParseImportResult {
    let json: any;
    try { json = JSON.parse(text); }
    catch { throw new Error('El archivo no es un JSON válido'); }

    if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
      throw new Error('Se espera un FeatureCollection con un arreglo "features"');
    }

    const reasons: Record<string, number> = {};
    const valids: PoiFeature[] = [];
    const invalidDrawables: PoiFeature[] = [];

    for (const f of json.features) {
      const res = this.validateFeatureStrict(f);

      if ((res as any).type === 'Feature') {
        valids.push(res as PoiFeature);
      } else {
        const reason = (res as any).reason ?? 'unknown';
        reasons[reason] = (reasons[reason] ?? 0) + 1;

        // para visual/reportes si alguna vez quisieras marcarlos en una tabla
        const coords =
          this.tryGetCoords(f?.geometry?.coordinates) ??
          this.tryGetCoords(f?.coordinates) ??
          null;

        if (coords) {
          const props = (f?.properties && typeof f.properties === 'object') ? f.properties : {};
          invalidDrawables.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords as LngLat },
            properties: { ...props, reason },
          });
        }
      }
    }

    const fc: PoiFeatureCollection = { type: 'FeatureCollection', features: valids };
    const invalidFc: PoiFeatureCollection = { type: 'FeatureCollection', features: invalidDrawables };

    const summary: ImportSummary = {
      imported: valids.length,
      discarded: json.features.length - valids.length,
      reasons,
    };

    return { fc, invalidFc, summary };
  }

  toBlob(fc: PoiFeatureCollection): Blob {
    return new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json;charset=utf-8' });
  }
}
