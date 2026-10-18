# Landing page: to do

- [ ] **Docs page.** Build it once the MCP server work is done. Until then the Docs links in the
  header, footer and phone menu, and "Explore the docs" in the closing section, all point at `#`
  (see `docs` in `lib/site.ts`). Once it exists, set `site.docs`, and add it to `lib/markdown.ts`
  so the agent-readable markdown links to it too.
- [ ] Demo recording for the "See it work" slot (16:9, GIF or MP4).
- [ ] Real destination for "Start building" in the closing section (`site.start`), or remove it.
- [ ] Rename the GitHub repo to match Aperture, then update `site.github`.
- [ ] Re-render the share card (`app/opengraph-image.jpg`) if the headline changes.
