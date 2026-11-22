// Respect "reduce motion": show the still poster instead of looping videos.
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.querySelectorAll('video[autoplay]').forEach((v) => {
    v.removeAttribute('autoplay');
    v.pause();
  });
}

// YouTube embeds load only when clicked (faster page, no tracking until play).
document.querySelectorAll('[data-youtube]').forEach((el) => {
  el.addEventListener('click', () => {
    const id = el.dataset.youtube;
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
    iframe.title = el.getAttribute('aria-label') || 'Video';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    el.replaceChildren(iframe);
    el.classList.add('is-playing');
  }, { once: true });
});
