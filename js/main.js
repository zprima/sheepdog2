'use strict';
window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game(document.getElementById('game'), document.getElementById('minimap'));
  prebakeGrounds(window.game.mapId);
});
