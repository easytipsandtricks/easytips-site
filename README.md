# easytips-site

The EasyTipsAndTricks homepage and the privacy policy of EasyTips Studio (the Google OAuth app behind the channel), served by GitHub Pages at **https://easytips.capsai.net/**.

- `index.html`: a scroll-driven 3D story (three.js, one WebGL canvas) over the page: our car with an x-ray engine, a Snow Hero drawing itself, paper snowflakes, the logo mark. Then the latest videos, the fan drawings wall and About. Works without WebGL, without JS and with reduced motion (stills of the same 3D scenes).
- `privacy.html`: the privacy policy (plain HTML and CSS, no JS).
- `site.css`, `site.js`, `js/`: styles, boot module and the 3D story. `vendor/`: pinned three.js 0.187.0 and helpers with their licences (see `vendor/README.md`). Nothing is loaded from other sites: no CDNs, fonts, embeds, analytics or cookies.
- `data/videos.json`, `assets/videos/` and the Latest videos grid in `index.html` are generated from the channel catalog by EasyTips Studio (`node engine/site-build.mjs` in github.com/easytipsandtricks/easytips-studio), which lists public videos only. The studio's `/upload` and `/daily` commit and push those files here automatically.
- `CNAME` holds the custom domain (`easytips.capsai.net`). Keep it: without it the site falls back to the default Pages address.

Local preview: `python3 -m http.server 8765` in this folder, then open http://127.0.0.1:8765/. Details: `docs/website.md` in the studio repo.
