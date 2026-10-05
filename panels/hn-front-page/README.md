# HN Front Page

Hacker News in a panel: Top, New, Best, Show and Ask, with the stories you already opened dimmed.

![Dark](../../docs/screenshots/deska/hn-front-page-dark.png)
![Light](../../docs/screenshots/deska/hn-front-page-light.png)

## What it teaches

- Fetching under the panel's CSP: the API host is declared in `panel.json` `network`, every request has a timeout, and offline, failed and partial loads each get a state with a way to retry. See `getJson`, `pool` and `load` in `app.js`.
- Limited concurrency with progressive rendering: 30 stories load 6 at a time into skeleton rows that fill as each answer arrives. See `pool`, `renderSlots`, `fillSlot` and `finishSlots`.
- `deska.openUrl` and its consent model: it is called straight from the click handler, the first link to a new host makes Deska ask, `declined` is taken quietly and `not_focused` is explained. See `open`.
- `deska.storage` for small UI memory (the chosen tab and the last 500 opened stories) and `deska.on('visibility')` to refresh a list older than five minutes when the panel comes back into view. See `markOpened`, `start` and the visibility listener.

## Permissions and hosts

- `open-url`: titles open the article and the comment count opens the discussion, in your browser.
- `hacker-news.firebaseio.com`: the official Hacker News API. It answers CORS for any origin, which a panel's opaque origin needs.

## Try it

```sh
npm run preview -- panels/hn-front-page
```

Then in Deska: Panel Library, Build a panel, Load a folder, and pick `panels/hn-front-page`.

## Notes

- Data comes from the [Hacker News API](https://github.com/HackerNews/API), which is public and needs no key. Hacker News is run by Y Combinator; this panel is not affiliated with it.
- `deska.openUrl` accepts https links only. An article posted with an http link is opened over https; a site that serves only http will not load.
- Each refresh makes 31 requests (the list plus 30 items). The panel refreshes on its own only when it becomes visible again after more than five minutes.
