# Battle Quiz Arena — Netlify-ready package

This package keeps the existing React interface and gameplay flow while replacing the always-on Socket.IO server with a Netlify Function and Netlify Blobs.

## Drag-and-drop publishing

1. Extract `netlify-ready-game.zip`.
2. Open Netlify's manual deploy page and drag the **extracted project folder** into the deploy drop area. Upload the folder contents if the interface asks for files.
3. For a build-based site, set the build command to `npm run build` and publish directory to `client/dist`. These values are already defined in `netlify.toml`.
4. Netlify automatically provisions Blobs credentials for deployed Functions. No API keys, environment variables, GitHub connection, or separate database setup are required.

The frontend calls `/.netlify/functions/game` directly. No `config.path` or `/api/game` redirect is used. The Function lives at `netlify/functions/game.ts`; the question bank/helper is kept outside the Functions folder at `netlify/lib/questions.ts`.

## Important deployment note

Netlify Functions and Netlify Blobs run on Netlify's hosted platform. For a drag-and-drop upload, Netlify must perform a build for the TypeScript frontend and bundle the Function. If your account's manual deploy flow only accepts prebuilt static files, deploy the built `client/dist` output through Netlify's build flow instead; a static-only upload cannot compile a TypeScript Function.

## Multiplayer storage

Room snapshots use a site-wide `battle-quiz-rooms` Blobs store with strong consistency and conditional writes (`onlyIfNew` when creating a room, `onlyIfMatch` when updating a known ETag). Room state is authoritative on the Function. Browser clients poll the Function for state, so no continuously running Node server or WebSocket server is needed.

## Game behavior

- Host creates a six-character room code; up to eight players can join.
- The host starts the match after at least two players join.
- Ten questions are selected from the existing question bank; each has a 15-second answer window.
- Correct answers award 100–1,000 points based on response speed.
- Scores and the final winner are shown on the existing game screens.

For local verification of a real deployed multiplayer match, deploy the package to Netlify and open the same published URL in two separate browser sessions. Netlify Blobs is hosted storage and is not available as a production store during a plain static file preview.
