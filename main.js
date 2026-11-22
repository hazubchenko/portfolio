document.documentElement.classList.add('js');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Respect "reduce motion": show the still poster instead of looping videos.
if (reduceMotion) {
  document.querySelectorAll('video[autoplay]').forEach((v) => {
    v.removeAttribute('autoplay');
    v.pause();
  });
}

// YouTube embeds: load the player only when needed (faster page, no tracking until then).
// - Click: plays with sound.
// - Scrolled into view: starts muted (browsers only allow muted autoplay),
//   pauses when scrolled away and resumes when it comes back.
function loadYouTube(el, { muted }) {
  if (el.classList.contains('is-playing')) return el.querySelector('iframe');
  const params = new URLSearchParams({
    autoplay: '1',
    mute: muted ? '1' : '0',
    playsinline: '1',
    rel: '0',
    enablejsapi: '1',
  });
  if (el.dataset.start) params.set('start', el.dataset.start);
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${el.dataset.youtube}?${params}`;
  iframe.title = el.getAttribute('aria-label') || 'Video';
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  el.replaceChildren(iframe);
  el.classList.add('is-playing');
  return iframe;
}

function command(iframe, func) {
  iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
}

document.querySelectorAll('[data-youtube]').forEach((el) => {
  el.addEventListener('click', () => loadYouTube(el, { muted: false }), { once: true });

  if (reduceMotion || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const iframe = el.querySelector('iframe');
      if (entry.isIntersecting) {
        if (iframe) command(iframe, 'playVideo');
        else loadYouTube(el, { muted: true });
      } else if (iframe) {
        command(iframe, 'pauseVideo');
      }
    });
  }, { threshold: 0.5 });

  observer.observe(el);
});

// Card -> case page: carry the video's playback position across, so the
// morphing frame shows one continuous shot instead of restarting.
const featureTile = document.querySelector('.tile--feature');
if (featureTile) {
  featureTile.addEventListener('click', () => {
    const v = featureTile.querySelector('video');
    try { if (v) sessionStorage.setItem('advisorVideoTime', String(v.currentTime)); } catch (e) {}
  });
}
const heroVideo = document.querySelector('.cs__hero video');
if (heroVideo) {
  let t = null;
  try { t = sessionStorage.getItem('advisorVideoTime'); sessionStorage.removeItem('advisorVideoTime'); } catch (e) {}
  if (t !== null) {
    const seek = () => { heroVideo.currentTime = parseFloat(t) || 0; };
    if (heroVideo.readyState >= 1) seek(); else heroVideo.addEventListener('loadedmetadata', seek, { once: true });
  }
}


// Case page: wipe-reveal each image as it scrolls into view (once).
// We watch the frame's parent: a fully clipped element doesn't count as visible.
const revealEls = document.querySelectorAll('.cs__body .cs__frame');
if (revealEls.length && 'IntersectionObserver' in window && !reduceMotion) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.__revealTargets.forEach((el) => el.classList.add('is-in'));
      io.unobserve(e.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -12% 0px' });
  revealEls.forEach((el) => {
    el.classList.add('reveal');
    const watch = el.closest('figure') || el.parentElement;
    (watch.__revealTargets ||= []).push(el);
    io.observe(watch);
  });
}


// Theme switch: Light / Dark / System (follows the device). Saved per browser.
// Re-checked whenever a page is shown, so pages restored by Back/Forward
// (which skip reloading) and other open tabs always match the saved choice.
function savedTheme() {
  try { return localStorage.getItem('theme') || 'system'; } catch (e) { return 'system'; }
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('[data-theme-set]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)));
}
document.querySelectorAll('[data-theme-set]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.themeSet;
    try { localStorage.setItem('theme', t); } catch (e) {}
    applyTheme(t);
  });
});
applyTheme(savedTheme());
window.addEventListener('pageshow', () => applyTheme(savedTheme()));
window.addEventListener('storage', (e) => { if (e.key === 'theme') applyTheme(savedTheme()); });


// Micro-motion: [data-roll] groups roll their children in, in order, once visible.
const rollEls = document.querySelectorAll('[data-roll]');
if (rollEls.length && 'IntersectionObserver' in window && !reduceMotion) {
  const rio = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      rio.unobserve(e.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -10% 0px' });
  rollEls.forEach((el) => {
    [...el.children].forEach((c, i) => c.style.setProperty('--i', i));
    if (el.dataset.rollDelay) el.style.setProperty('--roll-delay', el.dataset.rollDelay + 'ms');
    rio.observe(el);
  });
} else {
  rollEls.forEach((el) => el.classList.add('is-in'));
}


// Story scrolling (case page): after you stop scrolling, if a chapter is close
// to the centre, the page eases it into place slowly (no fast browser snap).
// Any wheel, touch, key or click during the glide hands control straight back.
(() => {
  if (!document.body.classList.contains('is-case') || reduceMotion) return;
  const desktop = window.matchMedia('(min-width: 801px) and (min-height: 600px) and (hover: hover) and (pointer: fine)');
  const rect = (sel) => {
    const els = [...document.querySelectorAll(sel)];
    if (!els.length) return null;
    const rs = els.map((e) => e.getBoundingClientRect());
    return { top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) };
  };
  // Each stop returns the scrollY that centres that chapter's content.
  const centre = (r) => r && scrollY + (r.top + r.bottom) / 2 - innerHeight / 2;
  const stops = () => [
    0, // the page as it opens
    centre((() => { const a = rect('.cs__facts'), b = rect('.cs__statement--hmw .cs__big'); return a && b && { top: a.top, bottom: b.bottom }; })()),
    ...[...document.querySelectorAll('.chapter')].map((c) => {
      const r = [...c.querySelectorAll('.cs__frame')].map((e) => e.getBoundingClientRect());
      return centre({ top: Math.min(...r.map((x) => x.top)), bottom: Math.max(...r.map((x) => x.bottom)) });
    }),
    centre(rect('.cs__learnings')),
    centre(rect('.cs__body > .cs__shot .cs__frame')),
  ].filter((y) => y !== null && y !== undefined);

  let idle, anim, gliding = false;
  const ease = (t) => 1 - Math.pow(1 - t, 3); // soft ease-out, like the rest of the site
  const stopGlide = () => { if (anim) cancelAnimationFrame(anim); anim = null; gliding = false; };

  function glideTo(target) {
    const from = scrollY, dist = target - from;
    const dur = Math.min(900, 450 + Math.abs(dist) * 1.2); // slower for longer moves
    const t0 = performance.now();
    gliding = true;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      window.scrollTo(0, from + dist * ease(t));
      if (t < 1) anim = requestAnimationFrame(step); else stopGlide();
    };
    anim = requestAnimationFrame(step);
  }

  function settle() {
    if (!desktop.matches) return;
    const y = scrollY;
    let best = null;
    for (const s of stops()) if (best === null || Math.abs(s - y) < Math.abs(best - y)) best = s;
    const d = Math.abs(best - y);
    // only help when you're already close (within a fifth of the screen), never yank
    if (d > 3 && d < innerHeight * 0.2) glideTo(Math.max(0, best));
  }

  window.addEventListener('scroll', () => {
    if (gliding) return;
    clearTimeout(idle);
    idle = setTimeout(settle, 220); // wait until trackpad momentum has fully ended
  }, { passive: true });
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((ev) =>
    window.addEventListener(ev, () => { if (gliding) stopGlide(); clearTimeout(idle); }, { passive: true }));
})();
