# Repository Guidelines

## Project Structure & Module Organization

This is an Astro site. Route files live in `src/pages/`; reusable UI is in `src/components/`, the post layout is in `src/layouts/`, and shared styles are in `src/styles/global.css`. Blog posts and recommendation entries live in `src/content/blog/` and `src/content/recommendations/`; their frontmatter schemas are defined in `src/content.config.ts`. Keep post-specific images in `src/content/blog/images/` and static assets such as favicons and social previews in `public/`. `dist/` and `.astro/` are generated output.

## Build, Test, and Development Commands

- `npm ci` installs the locked dependencies.
- `npm run dev` starts the local Astro development server (`npm start` is an alias).
- `npm run build` runs `astro check` and produces the static site in `dist/`.
- `npm run preview` serves the built site locally for a final review.

## Coding Style & Naming Conventions

Use the repository's `.prettierrc`: 4-space indentation, single quotes in JavaScript and TypeScript, semicolons, an 80-character print width, and LF line endings. Follow nearby Astro and CSS conventions when editing existing files. Name route and content files with lowercase, hyphenated slugs, for example `src/content/blog/type-vs-interface.md`. Use descriptive PascalCase names for Astro components. Blog posts require `title`, `description`, and `pubDate`; add `heroImage` when a preview image exists. The README specifies 960 × 480 pixels for post images.

## Testing Guidelines

There is no configured test framework or `npm test` script. Run `npm run build` before submitting changes; it checks Astro and content types as well as the production build. For visual or content edits, inspect affected pages with `npm run dev` or `npm run preview`, including mobile layouts where relevant. If you add automated tests, document their command and naming convention in this guide.

## Commit & Pull Request Guidelines

Recent commits use short, descriptive Russian messages in sentence case, such as `Улучшил адаптивность`. Keep each commit focused on one change. In pull requests, describe the changed pages or content, include the result of `npm run build`, link a related issue when one exists, and add screenshots for visible layout changes. Changes merged to `main` are deployed to GitHub Pages by the workflow in `.github/workflows/deploy.yml`.
