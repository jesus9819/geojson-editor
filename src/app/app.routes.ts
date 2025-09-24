import { Routes } from '@angular/router';
import { MapEditorComponent } from './components/map-editor/map-editor.component';

export const routes: Routes = [
    { path: '', component: MapEditorComponent },
    { path: '**', redirectTo: '' }
    
];
