/* nav.js — injects the shared navigation header into .page-header on every page */
(function () {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug');

  function link(href, label, extra) {
    const active = path === href || (href !== '/' && path.startsWith(href.replace('.html', '')));
    const cls = 'nav-link' + (active ? ' nav-link--active' : '') + (extra || '');
    return `<a href="${href}" class="${cls}">${label}</a>`;
  }

  function inject() {
    const el = document.querySelector('.page-header');
    if (!el) return;

    const caseLink = slug
      ? `<span class="nav-sep">&middot;</span><a href="/?slug=${encodeURIComponent(slug)}" class="nav-link nav-link--case">${slug}</a>`
      : '';

    el.innerHTML = `
      <div class="header-inner">
        <div class="header-brand">
          <a href="/dashboard.html" class="header-logo">A&sup2; CONSULTANCY</a>
        </div>
        <nav class="header-nav">
          ${link('/dashboard.html', 'Dashboard')}
          ${link('/new.html', 'New Client')}
          ${caseLink}
        </nav>
      </div>`;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
