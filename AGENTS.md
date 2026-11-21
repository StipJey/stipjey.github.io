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

Run `npm test` for unit tests in `tests/*.test.js`. Run `npx playwright install chromium` once, then `npm run test:e2e` for browser tests in `e2e/*.spec.js`. Run `npm run build` before submitting changes; it checks Astro and content types as well as the production build. For visual or content edits, inspect affected pages with `npm run dev` or `npm run preview`, including mobile layouts where relevant.

## Commit & Pull Request Guidelines

Recent commits use short, descriptive Russian messages in sentence case, such as `Улучшил адаптивность`. Keep each commit focused on one change. In pull requests, describe the changed pages or content, include the result of `npm run build`, link a related issue when one exists, and add screenshots for visible layout changes. Changes merged to `main` are deployed to GitHub Pages by the workflow in `.github/workflows/deploy.yml`.

## Скриншоты старых проектов для портфолио

Это согласованные требования пользователя. Применять сразу, без повторных уточнений.

- Снимать реально запущенный интерфейс. Сначала использовать сохранившуюся статическую сборку, HTML-демо или Storybook; при необходимости подготовить локальные моки. Не дорисовывать интерфейс или текст с помощью AI.
- Архивные исходники сохранять: исправления путей, локальные зависимости и оформление для съёмки делать в отдельном демослое или копии. Изменения демо должны воспроизводиться после перезагрузки страницы.
- Заменять шуточные тестовые имена на «Демо-пользователь». Скрывать персональные данные, тестовые заглушки, повторяющиеся тексты и блоки, которые портят кадр. Например, в «Консилиуме» скрыть строку «Рекомендация» с повторами. Сохранять смысл и характер настоящего интерфейса.
- Делать фон белым и оставлять аккуратные поля. Убирать тёмные полосы и служебные блоки, возникающие из-за сломанного старого макета. Логотип, навигация и выбранный основной блок должны помещаться целиком; не обрезать контент вплотную к краям или посередине строки/карточки. Высоту кадра выбирать по содержимому.
- Снимать с двойной плотностью относительно размера показа: например, для показа шириной 1440 px нужен исходник около 2880 px. Предпочитать настоящий захват с высокой плотностью; если доступен только захват в CSS-пикселях, использовать двойной масштаб рендеринга с соответствующим viewport и проверить сетку. Простое увеличение ширины viewport не повышает детализацию интерфейса. Не растягивать уже размытый файл.
- Сохранять мастер в PNG и веб-версию в WebP без дополнительной потери качества текста. PNG из размытого JPEG не восстанавливает детали: при плохом исходнике переснимать, а не менять расширение или повышать резкость. Не жертвовать читаемостью ради маленького размера файла.
- Проверять именно сохранённый файл: читаемость мелкого текста в размере показа, поля, отсутствие повторов, обрезок и заглушек. После этого показывать превью пользователю. Размытый или неаккуратный кадр не считать готовым.
- Готовые материалы хранить в `public/projects/` с названием проекта; временные настройки браузера после съёмки сбрасывать. Не добавлять скриншот на страницу и не публиковать изменения автоматически, если запрос касается только подготовки изображения.
