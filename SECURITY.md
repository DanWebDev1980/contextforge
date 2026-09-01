# Security policy

## Supported versions

The latest published release on npm is the only supported version.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting:
[Report a vulnerability](https://github.com/DanWebDev1980/browser-command-center/security/advisories/new).

Please include what you were doing, what happened, and the affected version
(`npx browser-command-center --version`). You will get an acknowledgement, and
a fix or an explanation of why it is not one, as fast as a volunteer project
can manage.

## Threat model

BCC is a script you paste into your own browser session. That is the whole
design, and it shapes what counts as a vulnerability.

**In scope**

- The bundle sending captured data anywhere other than your clipboard, a file
  you chose to download, or a loopback hub you started yourself.
- A redaction failing: credential-looking storage keys, `authorization` and
  `cookie` headers, and password inputs leaking into an export that claimed to
  withhold them.
- The hub serving files from outside the package directory, accepting
  connections from outside `127.0.0.1`, or letting a web page read a namespace
  it should not.
- Any path where loading BCC lets a page escalate against *you* — for example
  the overlay leaking page-supplied markup into a privileged context.

**Out of scope**

- The page you inject into being able to observe or tamper with BCC. Once you
  paste a script into a page's context, that page's JavaScript is your peer.
  BCC is a developer tool, not a sandbox.
- Captured content ending up somewhere you sent it. Everything BCC produces is
  meant to be pasted into an AI prompt or a ticket. **Read what you paste** —
  that is your responsibility, not the tool's.
- A site's Content-Security-Policy blocking the hub or the bookmarklet. Run
  **Diagnose** to see what a given site allows; DevTools Snippets are the
  supported install path precisely because CSP cannot block them.
