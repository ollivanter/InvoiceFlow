// Runs before first paint (loaded synchronously in <head>) to avoid a light/dark flash.
(function () {
  var theme = null;
  try { theme = localStorage.getItem('if:theme'); } catch (e) { /* storage unavailable */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
