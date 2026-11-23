# Showcase site

`index.html` is the GitHub Pages site (https://mitul-bhatia.github.io/cn_project/). It is generated, so edit the sources and rebuild:

```bash
node site/build.js site/index.html     # looks up every file:line in the real code, fails if one is missing
```

Sources: `build.js` (content), `style.css`, `sim.js` (the "break it yourself" simulator).
Publish: copy `index.html` to the `gh-pages` branch (Settings > Pages serves that branch).
