import './styles.css';
import { CONFIG } from './game/config.js';
import { Game } from './game/Game.js';
import { registerSW } from 'virtual:pwa-register';
import { PwaUI } from './pwa/PwaUI.js';

document.title = CONFIG.title;
document.querySelector('#title').textContent = CONFIG.title;
document.querySelector('#game').setAttribute('aria-label', `${CONFIG.title}, rotating tower game`);

try {
  const game = new Game(document.querySelector('#game'));
  game.pwa = new PwaUI({ game, registerSW, production: import.meta.env.PROD,
    devEnabled: __PWA_DEV__, base: import.meta.env.BASE_URL, version: __APP_VERSION__, build: __APP_BUILD__ });
  // The debug adapter is absent in a normal session. It is deliberately useful
  // for deterministic acceptance checks as well as inspecting live gameplay.
  if (new URLSearchParams(location.search).get('debug') === '1') window.__SCREW_FALL__ = game;
  if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
} catch (error) {
  console.error(error);
  document.querySelector('#error-detail').textContent = 'The 3D view could not start. Try a current browser with WebGL enabled, then reload.';
  document.querySelector('#error').hidden = false;
}
