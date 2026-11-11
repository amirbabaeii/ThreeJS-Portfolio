// Styles are linked from index.html so they apply before this bundle loads.
import { CareerOdysseyApp } from './app/CareerOdysseyApp.js';

const app = new CareerOdysseyApp(document);
void app.init();

if (new URLSearchParams(window.location.search).has('debug')) {
  window.__careerOdyssey = app;
}
