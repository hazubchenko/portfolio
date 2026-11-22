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
