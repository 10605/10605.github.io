"use strict";
// Shared helpers for the all-reduce visualizations (allreduce-*.html):
// a step player, and "packets" that fly along a path when stepping forward.
const AR = (() => {
const $ = id => document.getElementById(id);
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DUR = 0.8;   // seconds a packet takes to travel at normal speed
const slow = () => +($('speed') ? $('speed').value : 1);   // 1 = normal, larger = slower

// A labelled packet that moves along the SVG path d, then disappears.
function packet(d, label){
  const w = 10 + 7.5 * String(label).length;
  return `<g class="pkt" opacity="0">
    <rect x="${-w / 2}" y="-10" width="${w}" height="20" rx="4"/><text y="4.5">${label}</text>
    <animateMotion begin="indefinite" dur="${DUR * slow()}s" fill="freeze" path="${d}"/>
    <animate attributeName="opacity" begin="indefinite" dur="${DUR * slow()}s" values="1;1;0" keyTimes="0;.85;1"/></g>`;
}

// Wire the player controls. nSteps() gives the number of states; draw(k, animate)
// renders state k, animating the messages that led to it when animate is true.
function player(nSteps, draw){
  let step = 0, timer = null;
  const go = (k, animate = false) => {
    step = Math.max(0, Math.min(nSteps() - 1, k));
    const last = nSteps() - 1;
    $('k').max = last; $('k').value = step; $('kv').textContent = `${step} / ${last}`;
    $('back').disabled = $('reset').disabled = step === 0; $('step').disabled = step === last;
    animate = animate && !still;
    draw(step, animate);
    if (animate) document.querySelectorAll('.pkt animate, .pkt animateMotion').forEach(a => a.beginElement());
  };
  const stop = () => { clearTimeout(timer); timer = null; $('play').textContent = 'Play'; };
  const fwd = () => go(step + 1, true);
  $('step').addEventListener('click', () => { stop(); fwd(); });
  $('back').addEventListener('click', () => { stop(); go(step - 1); });
  $('reset').addEventListener('click', () => { stop(); go(0); });
  $('k').addEventListener('input', e => { stop(); go(+e.target.value); });
  $('play').addEventListener('click', () => {
    if (timer) return stop();
    if (step === nSteps() - 1) go(0);
    $('play').textContent = 'Pause';
    const tick = () => { if (step >= nSteps() - 1) stop(); else { fwd(); timer = setTimeout(tick, 1600 * slow()); } };
    timer = setTimeout(tick, 1600 * slow());
  });
  const setSlow = () => document.documentElement.style.setProperty('--slow', slow());
  if ($('speed')){ $('speed').addEventListener('change', setSlow); setSlow(); }
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'ArrowRight'){ stop(); fwd(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft'){ stop(); go(step - 1); e.preventDefault(); }
    else if (e.key === 'Home'){ stop(); go(0); }
  });
  return {go, stop, get step(){ return step; }};
}

return {$, packet, player};
})();
