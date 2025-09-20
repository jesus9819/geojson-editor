import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { MapEditorComponent } from './app/components/map-editor/map-editor.component';

bootstrapApplication(MapEditorComponent)
  .catch((err) => console.error(err));
