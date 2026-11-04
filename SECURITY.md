# Hextech Ledger — Security & Privacy

**In one line:** Hextech Ledger never asks for or touches anyone's login. It
collects no personal data beyond the player names you import or type in, and
those stay on the shop's computer. It installs nothing, and it can't be reached
from any other device on the shop's network.

This page covers the **portable Windows package** and the macOS version run from
the same files. It describes how the code actually behaves, and every claim has
a way to check it yourself under [How to check this yourself](#how-to-check-this-yourself).

---

## What it is

A scoreboard, round timer and pairing tool that runs in a web browser on the
shop's own computer. Double-clicking the launcher starts a small program
(Node.js on Windows, Perl on a Mac) that shows the app to that computer's
browser, and to nothing else. Closing the black console window stops it
completely.

## Logins and passwords

- **The app never asks for a login, password, Riot account or payment details.**
  It has no password fields, and nothing in it handles credentials.
- **It never reads or sends cookies.** When it fetches a Riot event page it does
  so anonymously, exactly as a logged-out visitor would. Nobody's Riot session
  is used, even if they're logged in to Riot in the same browser.
- **It never writes anything to Riot.** It only *reads* a public event page.
  Results are still entered on playriftbound.com by staff, in Riot's own site.

## What leaves the computer

Exactly two kinds of request, and nothing else:

| When | Goes to | What is sent | What comes back |
|---|---|---|---|
| Staff press **Import signups** | `playriftbound.com` | The event number typed in, nothing else | The same public event page anyone can view |
| A player's Legend is picked | `cmsassets.rgpub.io` (Riot's image server) | A request for that card's picture | The card picture |

There is **no analytics, no tracking, no advertising, no crash reporting,
no "phone home" and no automatic updates**. The app loads no outside scripts,
fonts or libraries; everything it runs is in the package folder.

Like any website visit, those two requests show Riot the shop's internet address.

## What is stored, and where

Everything the app remembers lives in **that computer's web browser storage**
(the same place any website keeps its settings), on that computer only:

- player and team names for the current event, and an archive of past events
- scores, pairings and standings
- the shop's name, logo and display settings

It's never uploaded anywhere. Staff can save or restore it by hand with the
backup buttons, which write and read a file they choose. Clearing the browser's
site data deletes it.

By design, it does **not** keep which Legend or deck anyone played once an event
is finished. Riot's developer terms forbid collecting that kind of play-rate
data, so the app deletes it.

## The local server

- **Visible to this computer only.** It listens on the "loopback" address
  (`127.0.0.1`), which by definition can't be reached from other computers,
  phones or the shop wifi.
- **Read-only.** It only hands out the app's own files. It can't change or delete
  anything on the computer.
- **Locked to its own folder.** Requests for files outside the app folder are
  refused.
- **Not an open relay.** The one thing it fetches from the internet is the event
  page `playriftbound.com/en-US/events/<number>`, and the event number must be
  digits only. It can't be used to reach any other site.
- **Refuses to run on an outdated Node.js.** If the computer's Node.js lacks the
  October 2026 security fixes (including the "Node2Shell" flaw, CVE-2026-111497),
  the app won't start and says why. The portable package already includes a
  patched version.

## No installation

- Nothing is installed, and nothing needs administrator rights.
- Nothing is added to the Windows registry, startup programs or services, and
  nothing keeps running after the window is closed.
- To remove it, delete the folder (and clear the browser's data for
  `localhost:8080` if you want the saved events gone too).

**The bundled `node\node.exe`** is the official, unmodified Node.js
**v26.13.0 (LTS)** runtime from nodejs.org. The build checks it against the
SHA-256 checksums Node.js publishes, and confirms its digital signature is valid,
before packaging. Its licence is included as `node\LICENSE`.

## Honest limits

- **Not encrypted.** Player names stored in the browser are protected the same way
  as anything else on that computer: by who can use it. Treat it like a
  spreadsheet of names on the shop laptop.
- **Not an independent audit.** This is a review of the app's source code, done
  while it was being built. The code is plain readable text and nothing is
  hidden or scrambled, so anyone technical can confirm it.
- **Riot can change their site.** If they do, signup import may stop working until
  the app is updated. That makes it fail safely, but it doesn't add risk.

---

## How to check this yourself

1. **See every connection it makes.** In the app, press `F12` and open the
   **Network** tab, then use the app as normal. Every request appears there:
   `localhost` (the app itself), plus the two in the table above when they
   happen.
2. **Confirm nothing else can reach it.** While it's running, open Command Prompt
   and run `netstat -an | findstr 8080`. The address shown is `127.0.0.1:8080`,
   never `0.0.0.0:8080`.
3. **Check the bundled Node.js.** Right-click `node\node.exe` →
   **Properties** → **Digital Signatures**: it's signed by *OpenJS Foundation*.
4. **Read the code.** `app.js`, `sw.js`, `index.html` and `tools\serve.js` open
   in Notepad. Search them for `fetch(` and `https://`. The only internet
   address in the code is the `playriftbound.com` event page in `tools\serve.js`.
   Every `fetch(` in the browser code goes to the app's own `localhost` server.
   The card-picture addresses come from the bundled `data\legends.json`.
